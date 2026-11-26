<script setup lang="ts">
// Maintenance mode and repository repairs of a destination (ADR 0026). While
// the destination is in maintenance no job can claim it: backups, retention
// sweeps and checks wait and start once it ends. A repair runs one restic
// command on the destination's maintenance agent; its output streams live on
// the job page. Changes that cannot be undone need a successful preview of
// the same request first, then the destination's name typed to confirm.
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useField, useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { AlertTriangle, Loader2, Play, Wrench } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import type { ApiResponse, Destination, Job, RepairAction, RepairParams, RepairRequest, RepairResponse } from '@/types'
import { formatDate, statusClass, statusLabel, statusVariant } from '@/lib/jobUtils'
import {
    actionInfo,
    buildRequest,
    changeSummary,
    emptyRepairForm,
    isDestructive,
    previewKey,
    repairActions,
    repairFormSchema,
    type RepairForm,
} from '@/lib/repair'

const { t } = useI18n()

const props = defineProps<{ destination: Destination }>()
const emit = defineEmits<{ changed: [] }>()

const error = ref<string | null>(null)
const maintenanceLoading = ref(false)
const submitting = ref(false)

// The section holds two forms (the repair request and the name that confirms
// a destructive one): each field names the form it belongs to, since
// useField would otherwise attach to the last form created in the component.
const repairForm = useForm({
    validationSchema: toTypedSchema(repairFormSchema),
    initialValues: emptyRepairForm(),
})
const { value: action } = useField<RepairAction>('action', undefined, { form: repairForm })
const { value: readAllPacks } = useField<boolean>('readAllPacks', undefined, { form: repairForm })
const { value: readData } = useField<boolean>('readData', undefined, { form: repairForm })
const { value: forget } = useField<boolean>('forget', undefined, { form: repairForm })
const { value: hosts, errorMessage: hostsError } = useField<string>('hosts', undefined, { form: repairForm })
const { value: tags, errorMessage: tagsError } = useField<string>('tags', undefined, { form: repairForm })
const { value: snapshotIds, errorMessage: snapshotIdsError } = useField<string>('snapshotIds', undefined, { form: repairForm })
const { value: packIds, errorMessage: packIdsError } = useField<string>('packIds', undefined, { form: repairForm })

// form is the current request as the helpers of lib/repair read it.
const form = computed(() => repairForm.values as RepairForm)

// The confirmation of a destructive request: the destination's name, which
// the server checks again.
const confirmForm = useForm({
    validationSchema: computed(() => toTypedSchema(z.object({
        name: z.string().refine((v) => v === props.destination.name, t('repair.confirmNameMismatch')),
    }))),
    initialValues: { name: '' },
})
const { value: confirmName, errorMessage: confirmNameError } = useField<string>('name', undefined, { form: confirmForm })

// The repair job this section started last, followed until it ends. preview
// is set for a read-only preview, with the request it previewed.
interface TrackedJob {
    id: string
    status: string
    preview: string | null
}
const lastJob = ref<TrackedJob | null>(null)
let pollTimer: ReturnType<typeof setInterval> | undefined

const confirmOpen = ref(false)

const info = computed(() => actionInfo(action.value))
const maintenance = computed(() => props.destination.maintenance)
const jobRunning = computed(() => !!lastJob.value && !isTerminal(lastJob.value.status))

// Why no repair can start now, or null when one can.
const blocked = computed<string | null>(() => {
    if (!props.destination.retention_agent_id) return t('repair.blocked.noAgent')
    if (!props.destination.repair_available) {
        return t('repair.blocked.agentUnsupported', { name: props.destination.retention_agent_name || '' })
    }
    if (maintenance.value && !maintenance.value.effective) {
        return t('repair.blocked.effectivePending')
    }
    if (jobRunning.value) return t('repair.blocked.jobRunning')
    return null
})

// previewed: the current request had a successful preview, so applying it is
// offered.
const previewed = computed(() =>
    !!lastJob.value && lastJob.value.preview === previewKey(form.value) && lastJob.value.status === 'succeeded')

const applyRequest = computed<RepairParams>(() => buildRequest(form.value, true))
const needsName = computed(() => isDestructive(applyRequest.value))

// manualMaintenance: an admin put the destination in maintenance, which only
// an admin ends. The maintenance a repair starts ends with its job, also when
// the job is marked interrupted while restic still runs on the agent.
const manualMaintenance = computed(() => !!maintenance.value && !maintenance.value.repair_job_id)

function isTerminal(status: string): boolean {
    return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status)
}

async function setMaintenance(enabled: boolean) {
    maintenanceLoading.value = true
    error.value = null
    try {
        await api(`/api/v1/destinations/${props.destination.id}/maintenance`, {
            method: 'PUT',
            body: { enabled },
        })
        emit('changed')
    } catch (e: unknown) {
        error.value = apiErrorMessage(e, enabled ? t('repair.maintenance.startFailed') : t('repair.maintenance.endFailed'))
    } finally {
        maintenanceLoading.value = false
    }
}

async function startRepair(request: RepairRequest, preview: string | null) {
    submitting.value = true
    error.value = null
    try {
        const res = await api<ApiResponse<RepairResponse>>(`/api/v1/destinations/${props.destination.id}/repair`, {
            method: 'POST',
            body: request,
        })
        lastJob.value = { id: res.data.job_id, status: 'pending', preview }
        followJob()
        emit('changed')
    } catch (e: unknown) {
        error.value = apiErrorMessage(e, t('repair.startFailed'))
    } finally {
        submitting.value = false
    }
}

// followJob polls the tracked job until it ends, then refreshes the
// destination: a maintenance the repair started ends with it.
function followJob() {
    stopFollowing()
    pollTimer = setInterval(async () => {
        const job = lastJob.value
        if (!job) return stopFollowing()
        try {
            const res = await api<ApiResponse<Job>>(`/api/v1/jobs/${job.id}`)
            job.status = res.data.status
            if (isTerminal(job.status)) {
                stopFollowing()
                emit('changed')
            }
        } catch {
            // Keep polling: a transient error says nothing about the job.
        }
    }, 2000)
}

function stopFollowing() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
}

onBeforeUnmount(stopFollowing)

const run = repairForm.handleSubmit(async (values) => {
    const f = values as RepairForm
    if (info.value?.previewFirst) {
        await startRepair(buildRequest(f, false), previewKey(f))
    } else {
        await startRepair(buildRequest(f, true), null)
    }
})

// openConfirm checks the request again (the preview ran on the same one)
// before asking for the confirmation.
const openConfirm = repairForm.handleSubmit(() => {
    confirmForm.resetForm()
    confirmOpen.value = true
})

async function applyConfirmed(name: string | null) {
    const request: RepairRequest = { ...applyRequest.value }
    if (name !== null) request.confirm = name
    confirmOpen.value = false
    await startRepair(request, null)
}

const confirmDestructive = confirmForm.handleSubmit((values) => applyConfirmed(values.name))

function confirmApply() {
    if (needsName.value) return confirmDestructive()
    return applyConfirmed(null)
}

function selectAction(value: unknown) {
    repairForm.resetForm({ values: emptyRepairForm(value as RepairAction) })
}
</script>

<template>
    <div class="border rounded-md p-4 flex flex-col gap-4" data-testid="repair-section">
        <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">{{ t('repair.title') }}</h2>
            <Badge v-if="maintenance" variant="outline" class="border-amber-500/40 text-amber-600 dark:text-amber-400">
                {{ maintenance.effective ? t('repair.badge.inMaintenance') : t('repair.badge.entering') }}
            </Badge>
        </div>

        <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Maintenance mode -->
        <div class="flex flex-col gap-2">
            <template v-if="maintenance">
                <p class="text-sm text-muted-foreground" data-testid="maintenance-status">
                    {{ maintenance.by ? t('repair.maintenance.sinceWithBy', { since: formatDate(maintenance.since), by: maintenance.by }) : t('repair.maintenance.since', { since: formatDate(maintenance.since) }) }}
                    {{ t('repair.maintenance.blockedHelp') }}
                    <template v-if="!maintenance.effective"> {{ t('repair.maintenance.effectiveLater') }}</template>
                    <template v-if="maintenance.repair_job_id">
                        {{ t('repair.maintenance.startedByRepairBefore') }}
                        <RouterLink :to="{ name: 'job-detail', params: { id: maintenance.repair_job_id } }"
                            class="underline underline-offset-4 hover:text-foreground">{{ t('repair.maintenance.repairLink') }}</RouterLink>
                        {{ t('repair.maintenance.startedByRepairAfter') }}
                    </template>
                </p>
                <!-- A repair's maintenance ends with it; an admin can keep it on afterwards. -->
                <Button v-if="maintenance.repair_job_id" variant="outline" size="sm" class="self-start"
                    data-testid="keep-maintenance" :disabled="maintenanceLoading" @click="setMaintenance(true)">
                    <Loader2 v-if="maintenanceLoading" class="w-4 h-4 mr-1.5 animate-spin" />
                    {{ t('repair.maintenance.keep') }}
                </Button>
                <Button v-else variant="outline" size="sm" class="self-start" data-testid="end-maintenance"
                    :disabled="maintenanceLoading || jobRunning" @click="setMaintenance(false)">
                    <Loader2 v-if="maintenanceLoading" class="w-4 h-4 mr-1.5 animate-spin" />
                    {{ t('repair.maintenance.end') }}
                </Button>
            </template>
            <template v-else>
                <p class="text-sm text-muted-foreground">
                    {{ t('repair.maintenance.idleHelp') }}
                </p>
                <Button variant="outline" size="sm" class="self-start" data-testid="start-maintenance"
                    :disabled="maintenanceLoading" @click="setMaintenance(true)">
                    <Loader2 v-if="maintenanceLoading" class="w-4 h-4 mr-1.5 animate-spin" />
                    {{ t('repair.maintenance.start') }}
                </Button>
            </template>
        </div>

        <!-- Repair -->
        <div class="flex flex-col gap-3 border-t pt-4">
            <Alert v-if="blocked" data-testid="repair-blocked">
                <AlertDescription class="text-sm">{{ blocked }}</AlertDescription>
            </Alert>

            <Field>
                <FieldLabel for="repair-action">{{ t('repair.actionLabel') }}</FieldLabel>
                <Select :model-value="action" @update:model-value="selectAction">
                    <SelectTrigger id="repair-action" class="w-64" data-testid="repair-action">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="a in repairActions" :key="a.action" :value="a.action">{{ t(a.labelKey) }}</SelectItem>
                    </SelectContent>
                </Select>
            </Field>
            <p v-if="info" class="text-sm text-muted-foreground">{{ t(info.descriptionKey) }}</p>

            <div v-if="action === 'check'" class="flex items-center gap-2">
                <Switch :model-value="readData" @update:model-value="readData = $event" />
                <span class="text-sm">{{ t('repair.readAllData') }}</span>
            </div>
            <div v-if="action === 'repair-index'" class="flex items-center gap-2">
                <Switch :model-value="readAllPacks" @update:model-value="readAllPacks = $event" />
                <span class="text-sm">{{ t('repair.readAllPacks') }}</span>
            </div>
            <template v-if="action === 'repair-snapshots'">
                <div class="grid gap-3 sm:grid-cols-3">
                    <Field>
                        <FieldLabel for="repair-hosts">{{ t('repair.hosts') }} <span class="text-muted-foreground font-normal">{{ t('notificationProviders.optional') }}</span></FieldLabel>
                        <Input id="repair-hosts" v-model="hosts" placeholder="helios selene"
                            :class="hostsError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="hostsError">{{ hostsError }}</FieldError>
                    </Field>
                    <Field>
                        <FieldLabel for="repair-tags">{{ t('repair.tags') }} <span class="text-muted-foreground font-normal">{{ t('notificationProviders.optional') }}</span></FieldLabel>
                        <Input id="repair-tags" v-model="tags" placeholder="policy:…"
                            :class="tagsError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="tagsError">{{ tagsError }}</FieldError>
                    </Field>
                    <Field>
                        <FieldLabel for="repair-snapshot-ids">{{ t('repair.snapshotIds') }} <span class="text-muted-foreground font-normal">{{ t('notificationProviders.optional') }}</span></FieldLabel>
                        <Input id="repair-snapshot-ids" v-model="snapshotIds" placeholder="fea2c19e"
                            :class="snapshotIdsError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="snapshotIdsError">{{ snapshotIdsError }}</FieldError>
                    </Field>
                </div>
                <p class="text-xs text-muted-foreground">{{ t('repair.noFilter') }}</p>
                <div class="flex items-center gap-2">
                    <Switch :model-value="forget" @update:model-value="forget = $event" />
                    <span class="text-sm">{{ t('repair.forget') }}</span>
                </div>
            </template>
            <Field v-if="action === 'repair-packs'">
                <FieldLabel for="repair-pack-ids">{{ t('repair.packIds') }}</FieldLabel>
                <textarea id="repair-pack-ids" v-model="packIds" rows="3" data-testid="repair-pack-ids"
                    :placeholder="t('repair.packIdsPlaceholder')"
                    class="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] resize-none font-mono"
                    :class="packIdsError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                <FieldError v-if="packIdsError">{{ packIdsError }}</FieldError>
            </Field>

            <div class="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" data-testid="repair-run" :disabled="!!blocked || submitting" @click="run()">
                    <Loader2 v-if="submitting" class="w-4 h-4 mr-1.5 animate-spin" />
                    <Play v-else class="w-4 h-4 mr-1.5" />
                    {{ info?.previewFirst ? t('repair.runPreview') : t('repair.run') }}
                </Button>
                <Button v-if="info?.previewFirst" size="sm" data-testid="repair-apply"
                    :class="needsName ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
                    :disabled="!!blocked || submitting || !previewed" @click="openConfirm()">
                    <Wrench class="w-4 h-4 mr-1.5" />
                    {{ t('repair.applyEllipsis') }}
                </Button>
                <span v-if="info?.previewFirst && !previewed" class="text-xs text-muted-foreground">
                    {{ t('repair.previewHint') }}
                </span>
            </div>

            <div v-if="lastJob" class="flex items-center gap-2 text-sm" data-testid="repair-job">
                <span class="text-xs text-muted-foreground">{{ lastJob.preview ? t('repair.preview') : t('repair.repairLabel') }}:</span>
                <Badge :variant="statusVariant(lastJob.status)" :class="statusClass(lastJob.status)">
                    {{ statusLabel(lastJob.status) }}
                </Badge>
                <RouterLink :to="{ name: 'job-detail', params: { id: lastJob.id } }"
                    class="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground">
                    {{ isTerminal(lastJob.status) ? t('repair.viewOutput') : t('repair.followLive') }}
                </RouterLink>
            </div>
        </div>
    </div>

    <!-- Apply confirmation -->
    <AlertDialog :open="confirmOpen" @update:open="confirmOpen = $event">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle class="flex items-center gap-2">
                    <AlertTriangle v-if="needsName" class="w-4 h-4 text-destructive" />
                    {{ t('repair.confirm.title', { action: t(info?.labelKey ?? '').toLowerCase() }) }}
                </AlertDialogTitle>
                <AlertDialogDescription>
                    {{ changeSummary(applyRequest) }}
                    <template v-if="needsName"> {{ t('repair.cannotBeUndone') }}</template>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <Alert v-if="needsName && !manualMaintenance" data-testid="repair-maintenance-advice">
                <AlertDescription class="text-sm">
                    {{ t('repair.maintenanceAdvice') }}
                </AlertDescription>
            </Alert>
            <Field v-if="needsName">
                <FieldLabel for="repair-confirm-name">
                    {{ t('repair.confirmNameBefore') }}<strong>{{ destination.name }}</strong>{{ t('repair.confirmNameAfter') }}
                </FieldLabel>
                <Input id="repair-confirm-name" v-model="confirmName" data-testid="repair-confirm-name" autocomplete="off"
                    :class="confirmNameError ? 'border-destructive focus-visible:ring-destructive/30' : ''" @keydown.enter.prevent="confirmApply()" />
                <FieldError v-if="confirmNameError">{{ confirmNameError }}</FieldError>
            </Field>
            <AlertDialogFooter>
                <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                <Button data-testid="repair-confirm"
                    :class="needsName ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
                    :disabled="submitting" @click="confirmApply()">
                    {{ t('repair.apply') }}
                </Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>
