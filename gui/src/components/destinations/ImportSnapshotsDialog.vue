<script setup lang="ts">
// Imports the snapshots of an existing Restic repository into a destination
// that already exists. The create form offers the same thing for a brand-new
// destination; this covers repointing or re-scanning an existing one — the last
// step when migrating a repository between storage providers.
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, useField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { api, apiErrorMessage } from '@/services/api'
import { summariseImport } from '@/lib/importSummary'
import type { ApiResponse, Destination, ImportDestinationRequest, ImportDestinationResponse } from '@/types'
import { AsyncCombobox } from '@/components/ui/async-combobox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { AlertCircle, CheckCircle2, Loader2 } from '@lucide/vue'

const props = defineProps<{
    open: boolean
    destination: Destination | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    imported: []
}>()

// The password is the one of an existing repository, so it has no minimum
// length: only its presence is checked.
const { t } = useI18n()

const { handleSubmit, resetForm, isSubmitting: submitting } = useForm({
    validationSchema: computed(() => toTypedSchema(z.object({
        agent_id: z.string().min(1, t('importSnapshots.agentRequired')),
        repo_password: z.string().min(1, t('importSnapshots.repoPasswordRequired')),
    }))),
    initialValues: { agent_id: '', repo_password: '' },
})

const { value: agentId, errorMessage: agentError } = useField<string>('agent_id')
const { value: repoPassword, errorMessage: passwordError } = useField<string>('repo_password')

const submitError = ref<string | null>(null)
const result = ref<ImportDestinationResponse | null>(null)

const summary = computed(() => (result.value ? summariseImport(result.value) : null))

function reset() {
    resetForm()
    submitError.value = null
    result.value = null
}

watch(() => props.open, (open) => {
    if (open) reset()
})

function onOpenChange(value: boolean) {
    emit('update:open', value)
}

const onSubmit = handleSubmit(async (values) => {
    if (!props.destination) return

    submitError.value = null
    try {
        const body: ImportDestinationRequest = {
            agent_id: values.agent_id,
            repo_password: values.repo_password,
        }
        const res = await api<ApiResponse<ImportDestinationResponse>>(
            `/api/v1/destinations/${props.destination.id}/import`,
            { method: 'POST', body },
        )
        result.value = res.data
        emit('imported')
    } catch (e: any) {
        submitError.value = apiErrorMessage(e, t('importSnapshots.importFailed'))
    }
})
</script>

<template>
    <Dialog :open="props.open" @update:open="onOpenChange">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>{{ t('importSnapshots.dialogTitle') }}</DialogTitle>
                <DialogDescription>
                    {{ t('importSnapshots.dialogDescription', { name: props.destination?.name ?? '' }) }}
                </DialogDescription>
            </DialogHeader>

            <!-- Outcome, shown once the import has run -->
            <div v-if="summary" class="flex items-center gap-3 py-2">
                <AlertCircle v-if="summary.tone === 'error'" class="size-5 shrink-0 text-destructive" />
                <CheckCircle2
                    v-else
                    class="size-5 shrink-0"
                    :class="summary.tone === 'success' ? 'text-green-500' : 'text-muted-foreground'"
                />
                <div>
                    <p class="text-sm font-medium">{{ summary.headline }}</p>
                    <p class="text-xs text-muted-foreground">{{ summary.detail }}</p>
                </div>
            </div>

            <form v-else class="space-y-4" novalidate @submit="onSubmit">
                <Field>
                    <FieldLabel for="import-dialog-agent">{{ t('importSnapshots.agent') }}</FieldLabel>
                    <AsyncCombobox
                        endpoint="/api/v1/agents"
                        :model-value="agentId"
                        :placeholder="t('importSnapshots.selectAgent')"
                        :class="agentError ? '[&_button]:border-destructive [&_button]:focus-visible:ring-destructive/30' : ''"
                        @update:model-value="agentId = $event"
                    />
                    <FieldError v-if="agentError">{{ agentError }}</FieldError>
                </Field>
                <Field>
                    <FieldLabel for="import-dialog-password">{{ t('importSnapshots.repoPassword') }}</FieldLabel>
                    <Input
                        id="import-dialog-password"
                        v-model="repoPassword"
                        type="password"
                        autocomplete="off"
                        :placeholder="t('importSnapshots.repoPasswordPlaceholder')"
                        :class="passwordError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
                    />
                    <FieldError v-if="passwordError">{{ passwordError }}</FieldError>
                    <p class="text-muted-foreground text-xs">
                        {{ t('importSnapshots.passwordNote') }}
                    </p>
                </Field>
                <p v-if="submitError" class="text-xs text-destructive flex items-start gap-1.5">
                    <AlertCircle class="size-3.5 mt-0.5 shrink-0" />
                    {{ submitError }}
                </p>
            </form>

            <DialogFooter>
                <Button v-if="summary" @click="onOpenChange(false)">{{ t('importSnapshots.done') }}</Button>
                <template v-else>
                    <Button variant="outline" :disabled="submitting" @click="onOpenChange(false)">{{ t('common.cancel') }}</Button>
                    <Button :disabled="submitting" @click="onSubmit()">
                        <Loader2 v-if="submitting" class="mr-2 size-4 animate-spin" />
                        {{ submitting ? t('importSnapshots.importing') : t('importSnapshots.import') }}
                    </Button>
                </template>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
