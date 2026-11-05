<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, useField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { integerInRange, MAX_RETENTION_KEEP } from '@/lib/validation'
import { api, apiErrorMessage } from '@/services/api'
import { summariseImport } from '@/lib/importSummary'
import type { ApiResponse, CheckMode, CreateDestinationResponse, Destination, ImportDestinationResponse } from '@/types'
import { AsyncCombobox } from '@/components/ui/async-combobox'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from '@/components/ui/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertCircle, AlertTriangle, Archive, CheckCircle2, Loader2 } from '@lucide/vue'

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
    open: boolean
    destination: Destination | null
    // cloneFrom pre-fills the form from an existing destination but submits as
    // a create (POST). Credentials are never copied.
    cloneFrom?: Destination | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    saved: []
}>()

const { t } = useI18n()

const isEdit = computed(() => !!props.destination)
// Clone mode: pre-filled from an existing destination but created anew. isEdit
// stays false so the form validates and submits exactly like a create.
const isClone = computed(() => !props.destination && !!props.cloneFrom)

// ---------------------------------------------------------------------------
// Destination types
// ---------------------------------------------------------------------------

type DestType = 'local' | 's3' | 'sftp' | 'rest' | 'rclone'

const DEST_TYPES = computed<{ value: DestType; label: string }[]>(() => [
    { value: 'local', label: t('destinationSheet.types.local') },
    { value: 's3', label: t('destinationSheet.types.s3') },
    { value: 'sftp', label: t('destinationSheet.types.sftp') },
    { value: 'rest', label: t('destinationSheet.types.rest') },
    { value: 'rclone', label: t('destinationSheet.types.rclone') },
])

// ---------------------------------------------------------------------------
// Per-type Zod schemas
// ---------------------------------------------------------------------------

// Config schemas (stored unencrypted)
const configSchemas: Record<DestType, z.ZodObject<any>> = {
    local: z.object({
        path: z.string().min(1, { error: () => t('destinationSheet.validation.pathRequired') }),
    }),
    s3: z.object({
        bucket: z.string().min(1, { error: () => t('destinationSheet.validation.bucketRequired') }),
        // No implicit default — a blank endpoint used to silently resolve to
        // AWS (server/internal/destutil/destutil.go), which is wrong for
        // Backblaze B2 and other S3-compatible providers.
        endpoint: z.string().min(1, { error: () => t('destinationSheet.validation.endpointRequired') }),
        region: z.string().optional(),
        prefix: z.string().optional(),
    }),
    sftp: z.object({
        host: z.string().min(1, { error: () => t('destinationSheet.validation.hostRequired') }),
        port: z.string().regex(/^\s*(\d{1,5})?\s*$/, { error: () => t('destinationSheet.validation.portNumber') })
            .refine((p) => !p.trim() || (Number(p) >= 1 && Number(p) <= 65535), { error: () => t('destinationSheet.validation.portRange') })
            .optional(),
        user: z.string().min(1, { error: () => t('destinationSheet.validation.usernameRequired') }),
        path: z.string().min(1, { error: () => t('destinationSheet.validation.pathRequired') }),
        // Checked by the server (ssh-keyscan lines or bare public keys).
        host_key: z.string().optional(),
    }),
    rest: z.object({
        url: z.string().url({ error: () => t('destinationSheet.validation.urlInvalid') })
            .refine((u) => /^https?:\/\//i.test(u), { error: () => t('destinationSheet.validation.urlHttp') }),
    }),
    rclone: z.object({
        remote: z.string().min(1, { error: () => t('destinationSheet.validation.remoteRequired') }),
        path: z.string().min(1, { error: () => t('destinationSheet.validation.pathRequired') }),
    }),
}

// Credentials schemas (stored encrypted)
const credSchemas: Record<DestType, z.ZodObject<any>> = {
    local: z.object({}),
    s3: z.object({
        access_key: z.string().min(1, { error: () => t('destinationSheet.validation.accessKeyRequired') }),
        secret_key: z.string().min(1, { error: () => t('destinationSheet.validation.secretKeyRequired') }),
    }),
    // rclone needs one of the two: the agent has no ssh-agent to fall back on.
    sftp: z.object({
        password: z.string().optional(),
        private_key: z.string().optional(),
    }).refine((c) => !!c.password?.trim() || !!c.private_key?.trim(), {
        path: ['password'],
        error: () => t('destinationSheet.validation.passwordOrKey'),
    }),
    rest: z.object({
        user: z.string().optional(),
        password: z.string().optional(),
    }),
    rclone: z.object({}),
}

// ---------------------------------------------------------------------------
// Retention (issue #130) — one configuration per destination, applied
// uniformly to every policy's own snapshot-tag pool here, on its own
// schedule fully detached from any backup job.
// ---------------------------------------------------------------------------

const RETENTION_SCHEDULE_PRESETS = computed(() => [
    { label: t('policySheet.schedulePresets.everyHour'), value: '0 * * * *' },
    { label: t('policySheet.schedulePresets.dailyAt'), value: '0 2 * * *' },
    { label: t('policySheet.schedulePresets.dailyAtMidnight'), value: '0 0 * * *' },
    { label: t('policySheet.schedulePresets.weeklySunday'), value: '0 2 * * 0' },
    { label: t('policySheet.schedulePresets.weeklyMonday'), value: '0 2 * * 1' },
    { label: t('policySheet.schedulePresets.monthly'), value: '0 2 1 * *' },
])

// ---------------------------------------------------------------------------
// Integrity check (issue #307) — restic check on its own schedule, run by the
// same agent as retention (the destination's maintenance agent). On by
// default for new destinations: restic never re-reads stored data, so damage
// would otherwise only surface during a restore.
// ---------------------------------------------------------------------------

const DEFAULT_CHECK_SCHEDULE = '0 3 * * 0'
const CHECK_SCHEDULE_PRESETS = computed(() => [
    { label: t('policySheet.schedulePresets.dailyAt', { time: '03:00' }), value: '0 3 * * *' },
    { label: t('policySheet.schedulePresets.weeklySunday'), value: DEFAULT_CHECK_SCHEDULE },
    { label: t('policySheet.schedulePresets.monthly'), value: '0 3 1 * *' },
])

const CHECK_MODES = computed<{ value: CheckMode; label: string; description: string }[]>(() => [
    { value: 'structure', label: t('destinationSheet.checkStructure'), description: t('destinationSheet.checkStructureDescription') },
    { value: 'subset', label: t('destinationSheet.checkSubset'), description: t('destinationSheet.checkSubsetDescription') },
    { value: 'full', label: t('destinationSheet.checkFull'), description: t('destinationSheet.checkFullDescription') },
])

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

// Config and credential fields are named "<type>_<key>" (e.g. s3_bucket,
// sftp_password): the per-type schemas above are checked against the fields
// of the selected type only.
function defaultValues() {
    return {
        name: '',
        enabled: true,
        type: 'local' as DestType,
        local_path: '',
        s3_bucket: '', s3_endpoint: '', s3_region: '', s3_prefix: '', s3_access_key: '', s3_secret_key: '',
        sftp_host: '', sftp_port: '', sftp_user: '', sftp_path: '', sftp_password: '', sftp_private_key: '',
        sftp_host_key: '',
        rest_url: '', rest_user: '', rest_password: '',
        rclone_remote: '', rclone_path: '',
        import_enabled: false,
        import_agent_id: '',
        import_repo_password: '',
        append_only: false,
        retention_enabled: false,
        retention_agent_id: '',
        retention_schedule: '0 2 * * *',
        retention_last: 0 as number | string,
        retention_hourly: 0 as number | string,
        retention_daily: 7 as number | string,
        retention_weekly: 4 as number | string,
        retention_monthly: 6 as number | string,
        retention_yearly: 1 as number | string,
        check_enabled: true,
        check_schedule: DEFAULT_CHECK_SCHEDULE,
        check_mode: 'subset' as CheckMode,
        check_subset_percent: 5 as number | string,
    }
}

type FormValues = ReturnType<typeof defaultValues>

const RETENTION_KEEP_FIELDS = [
    'retention_last', 'retention_hourly', 'retention_daily',
    'retention_weekly', 'retention_monthly', 'retention_yearly',
] as const

// configAndCreds builds the config and credentials of the selected type from
// the form values.
function configAndCreds(v: FormValues): { config: Record<string, string>; creds: Record<string, string> } {
    switch (v.type) {
        case 'local':
            return { config: { path: v.local_path }, creds: {} }
        case 's3':
            return {
                config: {
                    // Strip the slashes the server joins these with - an
                    // endpoint saved as "https://host/" used to produce an
                    // empty bucket name in the restic repository URL.
                    bucket: v.s3_bucket.trim().replace(/^\/+|\/+$/g, ''),
                    endpoint: v.s3_endpoint.trim().replace(/\/+$/, ''),
                    region: v.s3_region,
                    prefix: v.s3_prefix,
                },
                creds: { access_key: v.s3_access_key, secret_key: v.s3_secret_key },
            }
        case 'sftp':
            return {
                config: { host: v.sftp_host, port: v.sftp_port, user: v.sftp_user, path: v.sftp_path, host_key: v.sftp_host_key.trim() },
                creds: { password: v.sftp_password, private_key: v.sftp_private_key },
            }
        case 'rest':
            return {
                config: { url: v.rest_url },
                creds: { user: v.rest_user, password: v.rest_password },
            }
        case 'rclone':
            return { config: { remote: v.rclone_remote, path: v.rclone_path }, creds: {} }
    }
}

// hasEnteredCredentials reports whether the user typed any credential value.
// Empty in edit mode means "keep the existing credentials" — they are
// write-only and never echoed back into the form.
function hasEnteredCredentials(creds: Record<string, string>): boolean {
    return Object.values(creds).some(v => v != null && String(v).trim() !== '')
}

const retentionKeep = integerInRange(0, MAX_RETENTION_KEEP)
const subsetPercent = integerInRange(1, 100)

const schema = toTypedSchema(
    z.object({
        name: z.string().trim().min(1, { error: () => t('validation.nameRequired') }),
        enabled: z.boolean(),
        type: z.enum(['local', 's3', 'sftp', 'rest', 'rclone']),
        local_path: z.string(),
        s3_bucket: z.string(), s3_endpoint: z.string(), s3_region: z.string(), s3_prefix: z.string(),
        s3_access_key: z.string(), s3_secret_key: z.string(),
        sftp_host: z.string(), sftp_port: z.string(), sftp_user: z.string(), sftp_path: z.string(),
        sftp_password: z.string(), sftp_private_key: z.string(), sftp_host_key: z.string(),
        rest_url: z.string(), rest_user: z.string(), rest_password: z.string(),
        rclone_remote: z.string(), rclone_path: z.string(),
        import_enabled: z.boolean(),
        import_agent_id: z.string(),
        import_repo_password: z.string(),
        append_only: z.boolean(),
        retention_enabled: z.boolean(),
        retention_agent_id: z.string(),
        retention_schedule: z.string(),
        retention_last: retentionKeep,
        retention_hourly: retentionKeep,
        retention_daily: retentionKeep,
        retention_weekly: retentionKeep,
        retention_monthly: retentionKeep,
        retention_yearly: retentionKeep,
        check_enabled: z.boolean(),
        check_schedule: z.string(),
        check_mode: z.enum(['structure', 'subset', 'full']),
        // Checked in superRefine, only for a subset check. Not a z.union:
        // @vee-validate/zod reads zod 3 union errors and fails on zod 4 ones.
        check_subset_percent: z.unknown(),
    }).superRefine((v, ctx) => {
        const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

        // Config and credentials of the selected type. In edit mode, blank
        // credentials are valid and mean "keep current", so they are only
        // checked when the user entered something.
        const { config, creds } = configAndCreds(v as FormValues)
        const configResult = configSchemas[v.type].safeParse(config)
        if (!configResult.success) {
            for (const i of configResult.error.issues) issue(`${v.type}_${String(i.path[0])}`, i.message)
        }
        if (!isEdit.value || hasEnteredCredentials(creds)) {
            const credsResult = credSchemas[v.type].safeParse(creds)
            if (!credsResult.success) {
                for (const i of credsResult.error.issues) issue(`${v.type}_${String(i.path[0])}`, i.message)
            }
        }

        // Retention is hidden, and never enabled, on an append-only destination.
        const retentionOn = v.retention_enabled && !v.append_only
        if (retentionOn) {
            if (!v.retention_schedule.trim()) issue('retention_schedule', t('destinationSheet.validation.scheduleRequired'))
            // With no keep rule restic forget removes nothing.
            if (RETENTION_KEEP_FIELDS.every((f) => Number(v[f]) === 0)) {
                issue('retention_keep', t('destinationSheet.validation.keepRequired'))
            }
        }

        if (v.check_enabled) {
            if (!v.check_schedule.trim()) issue('check_schedule', t('destinationSheet.validation.scheduleRequired'))
            if (v.check_mode === 'subset') {
                const result = subsetPercent.safeParse(v.check_subset_percent)
                if (!result.success) issue('check_subset_percent', result.error.issues[0]!.message)
            }
        }

        // The maintenance agent runs both retention sweeps and integrity checks.
        if ((retentionOn || v.check_enabled) && !v.retention_agent_id) {
            issue('retention_agent_id', t('destinationSheet.validation.agentRequired'))
        }

        // Importing an existing repository needs an agent to read it and its
        // password; offered on create only.
        if (!isEdit.value && v.import_enabled) {
            if (!v.import_agent_id) issue('import_agent_id', t('destinationSheet.validation.importAgentRequired'))
            if (!v.import_repo_password) issue('import_repo_password', t('destinationSheet.validation.importPasswordRequired'))
        }
    }),
)

const { handleSubmit, resetForm, setErrors, isSubmitting: submitting } = useForm({
    validationSchema: schema,
    initialValues: defaultValues(),
})

// Base fields
const { value: name, errorMessage: nameError } = useField<string>('name')
const { value: enabled } = useField<boolean>('enabled')
const { value: selectedType } = useField<DestType>('type')

// Config and credential fields
const { value: localPath, errorMessage: localPathError } = useField<string>('local_path')
const { value: s3Bucket, errorMessage: s3BucketError } = useField<string>('s3_bucket')
const { value: s3Endpoint, errorMessage: s3EndpointError } = useField<string>('s3_endpoint')
const { value: s3Region } = useField<string>('s3_region')
const { value: s3Prefix } = useField<string>('s3_prefix')
const { value: s3AccessKey, errorMessage: s3AccessKeyError } = useField<string>('s3_access_key')
const { value: s3SecretKey, errorMessage: s3SecretKeyError } = useField<string>('s3_secret_key')
const { value: sftpHost, errorMessage: sftpHostError } = useField<string>('sftp_host')
const { value: sftpPort, errorMessage: sftpPortError } = useField<string>('sftp_port')
const { value: sftpUser, errorMessage: sftpUserError } = useField<string>('sftp_user')
const { value: sftpPath, errorMessage: sftpPathError } = useField<string>('sftp_path')
const { value: sftpPassword, errorMessage: sftpPasswordError } = useField<string>('sftp_password')
const { value: sftpPrivateKey } = useField<string>('sftp_private_key')
const { value: sftpHostKey, errorMessage: sftpHostKeyError } = useField<string>('sftp_host_key')
const { value: restUrl, errorMessage: restUrlError } = useField<string>('rest_url')
const { value: restUser } = useField<string>('rest_user')
const { value: restPassword } = useField<string>('rest_password')
const { value: rcloneRemote, errorMessage: rcloneRemoteError } = useField<string>('rclone_remote')
const { value: rclonePath, errorMessage: rclonePathError } = useField<string>('rclone_path')

// Import — only used during creation, not edit
const { value: importEnabled } = useField<boolean>('import_enabled')
const { value: importAgentId, errorMessage: importAgentError } = useField<string>('import_agent_id')
const { value: importRepoPassword, errorMessage: importPasswordError } = useField<string>('import_repo_password')

// Retention and integrity check
const { value: appendOnly } = useField<boolean>('append_only')
const { value: retentionEnabled } = useField<boolean>('retention_enabled')
const { value: retentionAgentId, errorMessage: retentionAgentError } = useField<string>('retention_agent_id')
const { value: retentionSchedule, errorMessage: retentionScheduleError } = useField<string>('retention_schedule')
const { value: retentionLast, errorMessage: retentionLastError } = useField<number | string>('retention_last')
const { value: retentionHourly, errorMessage: retentionHourlyError } = useField<number | string>('retention_hourly')
const { value: retentionDaily, errorMessage: retentionDailyError } = useField<number | string>('retention_daily')
const { value: retentionWeekly, errorMessage: retentionWeeklyError } = useField<number | string>('retention_weekly')
const { value: retentionMonthly, errorMessage: retentionMonthlyError } = useField<number | string>('retention_monthly')
const { value: retentionYearly, errorMessage: retentionYearlyError } = useField<number | string>('retention_yearly')
// retention_keep holds no value: it carries the "no keep rule" error, which
// belongs to the six keep fields together.
const { errorMessage: retentionKeepError } = useField<null>('retention_keep')
const { value: checkEnabled } = useField<boolean>('check_enabled')
const { value: checkSchedule, errorMessage: checkScheduleError } = useField<string>('check_schedule')
const { value: checkMode } = useField<CheckMode>('check_mode')
const { value: checkSubsetPercent, errorMessage: checkSubsetPercentError } = useField<number | string>('check_subset_percent')

const retentionNeedsReview = ref(false)
const submitError = ref<string | null>(null)
const importError = ref<string | null>(null)
const importResult = ref<ImportDestinationResponse | null>(null)
const creationDone = ref(false)

const importSummary = computed(() =>
    importResult.value ? summariseImport(importResult.value) : null,
)

// The maintenance agent runs both retention sweeps and integrity checks, so
// it is needed as soon as either is on.
const needsMaintenanceAgent = computed(() => (retentionEnabled.value && !appendOnly.value) || checkEnabled.value)

// ---------------------------------------------------------------------------
// Reset / populate
// ---------------------------------------------------------------------------

function resetFields(values: FormValues = defaultValues()) {
    resetForm({ values })
    submitError.value = null
    importError.value = null
    importResult.value = null
    creationDone.value = false
    retentionNeedsReview.value = false
}

// valuesFromDestination returns the form values of dest. Credentials are
// write-only and never populated.
function valuesFromDestination(dest: Destination, asClone: boolean): FormValues {
    let config: Record<string, string> = {}
    try { config = JSON.parse(dest.config || '{}') } catch { /* ignore */ }

    const values: FormValues = {
        ...defaultValues(),
        type: dest.type as DestType,
        // Clone starts from a suggested "Copy of …" name; credentials are never
        // copied (the form never echoes secrets), so the user must re-enter them.
        name: asClone ? t('destinationSheet.cloneName', { name: dest.name }) : dest.name,
        enabled: dest.enabled,
        append_only: dest.append_only,
        retention_enabled: dest.retention_enabled,
        retention_agent_id: dest.retention_agent_id,
        retention_schedule: dest.retention_schedule || '0 2 * * *',
        retention_last: dest.retention_last,
        retention_hourly: dest.retention_hourly,
        retention_daily: dest.retention_daily,
        retention_weekly: dest.retention_weekly,
        retention_monthly: dest.retention_monthly,
        retention_yearly: dest.retention_yearly,
        check_enabled: dest.check_enabled,
        check_schedule: dest.check_schedule || DEFAULT_CHECK_SCHEDULE,
        check_mode: dest.check_mode,
        check_subset_percent: dest.check_subset_percent,
    }

    switch (dest.type as DestType) {
        case 'local':
            values.local_path = config.path ?? ''
            break
        case 's3':
            values.s3_bucket = config.bucket ?? ''
            // Legacy destinations saved before Endpoint was required silently
            // resolved to AWS server-side (destutil.BuildRepoURL) — surface
            // that real value explicitly instead of leaving the field blank
            // and failing the now-required validation.
            values.s3_endpoint = config.endpoint || 's3.amazonaws.com'
            values.s3_region = config.region ?? ''
            values.s3_prefix = config.prefix ?? ''
            break
        case 'sftp':
            values.sftp_host = config.host ?? ''
            values.sftp_port = config.port ?? ''
            values.sftp_user = config.user ?? ''
            values.sftp_path = config.path ?? ''
            values.sftp_host_key = config.host_key ?? ''
            break
        case 'rest':
            values.rest_url = config.url ?? ''
            break
        case 'rclone':
            values.rclone_remote = config.remote ?? ''
            values.rclone_path = config.path ?? ''
            break
    }
    return values
}

// Prefill or reset when the sheet opens.
watch(
    () => props.open,
    (open) => {
        if (!open) return
        const source = props.destination ?? props.cloneFrom ?? null
        resetFields(source ? valuesFromDestination(source, !props.destination) : defaultValues())
        // Cloning starts a fresh destination — any "needs review" flag belongs
        // to the original row, not the copy.
        retentionNeedsReview.value = !!props.destination?.retention_needs_review
    },
    { immediate: true }
)

// Clear errors when the type changes: they belong to the previous type's fields.
watch(selectedType, () => {
    setErrors({})
    submitError.value = null
})

// Clear import error when toggle is turned off
watch(importEnabled, () => {
    importError.value = null
})

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

const onSubmit = handleSubmit(async (formValues) => {
    const values = formValues as FormValues
    submitError.value = null
    importError.value = null

    const { config, creds } = configAndCreds(values)
    const settings = {
        append_only: values.append_only,
        retention_enabled: values.retention_enabled,
        retention_agent_id: values.retention_agent_id,
        retention_schedule: values.retention_schedule,
        retention_last: Number(values.retention_last),
        retention_hourly: Number(values.retention_hourly),
        retention_daily: Number(values.retention_daily),
        retention_weekly: Number(values.retention_weekly),
        retention_monthly: Number(values.retention_monthly),
        retention_yearly: Number(values.retention_yearly),
        check_enabled: values.check_enabled,
        check_schedule: values.check_schedule,
        check_mode: values.check_mode,
        check_subset_percent: Number(values.check_subset_percent),
    }

    try {
        if (isEdit.value && props.destination) {
            // PATCH — only send credentials when the user entered new ones.
            // Omitting the field tells the backend to keep the stored
            // credentials, since the form never echoes secrets back.
            const body: Record<string, unknown> = {
                name: values.name,
                config: JSON.stringify(config),
                enabled: values.enabled,
                ...settings,
            }
            if (hasEnteredCredentials(creds)) {
                body.credentials = JSON.stringify(creds)
            }
            await api(`/api/v1/destinations/${props.destination.id}`, {
                method: 'PATCH',
                body,
            })
        } else {
            // Build the POST body; include import fields if provided so the
            // backend tests connectivity before persisting anything.
            const body: Record<string, unknown> = {
                name: values.name,
                type: values.type,
                config: JSON.stringify(config),
                credentials: JSON.stringify(creds),
                ...settings,
            }
            if (values.import_enabled) {
                body.import_agent_id = values.import_agent_id
                body.import_repo_password = values.import_repo_password
            }
            const res = await api<ApiResponse<CreateDestinationResponse>>('/api/v1/destinations', {
                method: 'POST',
                body,
            })
            if (res.data.import) {
                importResult.value = res.data.import
                creationDone.value = true
                emit('saved')
                return
            }
            // Create always enables the destination. A clone preserves the
            // original's enabled state, so disable it explicitly when cloning
            // a disabled one.
            if (isClone.value && !values.enabled && res.data.id) {
                await api(`/api/v1/destinations/${res.data.id}`, { method: 'PATCH', body: { enabled: false } })
            }
        }
        emit('update:open', false)
        emit('saved')
    } catch (e: any) {
        const msg = apiErrorMessage(e, t('destinationSheet.submitFailed'))
        if (values.import_enabled && !isEdit.value) {
            importError.value = msg
        } else {
            submitError.value = msg
        }
    }
})

function onDone() {
    emit('update:open', false)
}

function onOpenChange(value: boolean) {
    if (!value) {
        resetFields()
    }
    emit('update:open', value)
}
</script>

<template>
    <Sheet :open="props.open" @update:open="onOpenChange">
        <SheetContent class="sm:max-w-lg overflow-y-auto">
            <SheetHeader>
                <SheetTitle>{{ creationDone ? t('destinationSheet.createdTitle') : (isEdit ? t('destinationSheet.editTitle') : isClone ? t('destinationSheet.cloneTitle') : t('destinationSheet.newTitle')) }}</SheetTitle>
                <SheetDescription>
                    {{ creationDone ? t('destinationSheet.createdDescription') : (isEdit ? t('destinationSheet.editDescription') : isClone ? t('destinationSheet.cloneDescription') : t('destinationSheet.newDescription')) }}
                </SheetDescription>
            </SheetHeader>

            <!-- Success state shown after creation with import -->
            <div v-if="creationDone && importSummary" class="py-8 px-4 flex flex-col gap-6">
                <div class="space-y-3">
                    <div class="flex items-center gap-3">
                        <CheckCircle2 class="size-5 text-green-500 shrink-0" />
                        <div>
                            <p class="text-sm font-medium">{{ t('destinationSheet.destinationSaved') }}</p>
                            <p class="text-xs text-muted-foreground">{{ name }}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <AlertCircle v-if="importSummary.tone === 'error'" class="size-5 shrink-0 text-destructive" />
                        <CheckCircle2
                            v-else
                            class="size-5 shrink-0"
                            :class="importSummary.tone === 'success' ? 'text-green-500' : 'text-muted-foreground'"
                        />
                        <div>
                            <p class="text-sm font-medium">{{ importSummary.headline }}</p>
                            <p class="text-xs text-muted-foreground">{{ importSummary.detail }}</p>
                        </div>
                    </div>
                </div>
                <Button class="self-start" @click="onDone">{{ t('destinationSheet.done') }}</Button>
            </div>

            <form v-else class="py-6 px-4" novalidate @submit="onSubmit">
                <FieldGroup>

                    <!-- Error banner -->
                    <Transition enter-active-class="transition-all duration-200"
                        enter-from-class="-translate-y-1 opacity-0" leave-active-class="transition-all duration-150"
                        leave-to-class="-translate-y-1 opacity-0">
                        <Alert v-if="submitError" variant="destructive">
                            <AlertCircle class="size-4" />
                            <AlertDescription>{{ submitError }}</AlertDescription>
                        </Alert>
                    </Transition>

                    <!-- Name -->
                    <Field>
                        <FieldLabel for="dest-name">{{ t('destinationSheet.name') }}</FieldLabel>
                        <Input id="dest-name" v-model="name" :placeholder="t('destinationSheet.namePlaceholder')" autocomplete="off"
                            :class="nameError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="nameError">{{ nameError }}</FieldError>
                    </Field>

                    <!-- Type — disabled in edit mode -->
                    <Field>
                        <FieldLabel>{{ t('destinationSheet.type') }}</FieldLabel>
                        <Select :model-value="selectedType" :disabled="isEdit"
                            @update:model-value="selectedType = $event as DestType">
                            <SelectTrigger>
                                <SelectValue :placeholder="t('destinationSheet.selectType')" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="t in DEST_TYPES" :key="t.value" :value="t.value">
                                    {{ t.label }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p v-if="isEdit" class="text-muted-foreground text-xs">
                            {{ t('destinationSheet.typeFixed') }}
                        </p>
                    </Field>

                    <Separator />

                    <!-- ── Local ── -->
                    <template v-if="selectedType === 'local'">
                        <Field>
                            <FieldLabel for="local-path">{{ t('destinationSheet.path') }}</FieldLabel>
                            <Input id="local-path" v-model="localPath" :placeholder="t('destinationSheet.pathPlaceholder')" autocomplete="off"
                                :class="localPathError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="localPathError">{{ localPathError }}</FieldError>
                        </Field>
                    </template>

                    <!-- ── S3 ── -->
                    <template v-if="selectedType === 's3'">
                        <Field>
                            <FieldLabel for="s3-bucket">{{ t('destinationSheet.bucket') }}</FieldLabel>
                            <Input id="s3-bucket" v-model="s3Bucket" :placeholder="t('destinationSheet.bucketPlaceholder')" autocomplete="off"
                                :class="s3BucketError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="s3BucketError">{{ s3BucketError }}</FieldError>
                        </Field>
                        <Field>
                            <FieldLabel for="s3-endpoint">{{ t('destinationSheet.endpoint') }}</FieldLabel>
                            <Input id="s3-endpoint" v-model="s3Endpoint" autocomplete="off"
                                :placeholder="t('destinationSheet.endpointPlaceholder')"
                                :class="s3EndpointError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="s3EndpointError">{{ s3EndpointError }}</FieldError>
                            <p class="text-muted-foreground text-xs">
                                {{ t('destinationSheet.endpointHelp') }}
                            </p>
                        </Field>
                        <div class="grid grid-cols-2 gap-3">
                            <Field>
                                <FieldLabel for="s3-region">
                                    {{ t('destinationSheet.region') }} <span class="text-muted-foreground font-normal">{{ t('common.optional') }}</span>
                                </FieldLabel>
                                <Input id="s3-region" v-model="s3Region" placeholder="us-east-1" autocomplete="off" />
                            </Field>
                            <Field>
                                <FieldLabel for="s3-prefix">
                                    {{ t('destinationSheet.prefix') }} <span class="text-muted-foreground font-normal">{{ t('common.optional') }}</span>
                                </FieldLabel>
                                <Input id="s3-prefix" v-model="s3Prefix" placeholder="backups/" autocomplete="off" />
                            </Field>
                        </div>

                        <Separator />
                        <p class="text-sm font-medium">{{ t('destinationSheet.credentials') }}</p>
                        <p v-if="isEdit" class="text-muted-foreground text-xs -mt-2">
                            {{ t('destinationSheet.keepCredentials') }}
                        </p>

                        <Field>
                            <FieldLabel for="s3-access-key">{{ t('destinationSheet.accessKey') }}</FieldLabel>
                            <Input id="s3-access-key" v-model="s3AccessKey" autocomplete="off"
                                :class="s3AccessKeyError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="s3AccessKeyError">{{ s3AccessKeyError }}
                            </FieldError>
                        </Field>
                        <Field>
                            <FieldLabel for="s3-secret-key">{{ t('destinationSheet.secretKey') }}</FieldLabel>
                            <Input id="s3-secret-key" v-model="s3SecretKey" type="password" autocomplete="off"
                                :class="s3SecretKeyError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="s3SecretKeyError">{{ s3SecretKeyError }}
                            </FieldError>
                        </Field>
                    </template>

                    <!-- ── SFTP ── -->
                    <template v-if="selectedType === 'sftp'">
                        <div class="grid grid-cols-3 gap-3">
                            <Field class="col-span-2">
                                <FieldLabel for="sftp-host">{{ t('destinationSheet.host') }}</FieldLabel>
                                <Input id="sftp-host" v-model="sftpHost" :placeholder="t('destinationSheet.hostPlaceholder')" autocomplete="off"
                                    :class="sftpHostError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                <FieldError v-if="sftpHostError">{{ sftpHostError }}</FieldError>
                            </Field>
                            <Field>
                                <FieldLabel for="sftp-port">
                                    {{ t('destinationSheet.port') }} <span class="text-muted-foreground font-normal">{{ t('destinationSheet.optionalShort') }}</span>
                                </FieldLabel>
                                <Input id="sftp-port" v-model="sftpPort" placeholder="22" autocomplete="off"
                                    :class="sftpPortError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                <FieldError v-if="sftpPortError">{{ sftpPortError }}</FieldError>
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel for="sftp-user">{{ t('destinationSheet.username') }}</FieldLabel>
                            <Input id="sftp-user" v-model="sftpUser" :placeholder="t('destinationSheet.usernamePlaceholder')" autocomplete="off"
                                :class="sftpUserError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="sftpUserError">{{ sftpUserError }}</FieldError>
                        </Field>
                        <Field>
                            <FieldLabel for="sftp-path">{{ t('destinationSheet.remotePath') }}</FieldLabel>
                            <Input id="sftp-path" v-model="sftpPath" :placeholder="t('destinationSheet.remotePathPlaceholder')" autocomplete="off"
                                :class="sftpPathError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="sftpPathError">{{ sftpPathError }}</FieldError>
                        </Field>

                        <Separator />
                        <p class="text-sm font-medium">
                            {{ t('destinationSheet.authentication') }}
                            <span class="text-muted-foreground font-normal"> {{ t('destinationSheet.passwordOrKey') }}</span>
                        </p>
                        <p v-if="isEdit" class="text-muted-foreground text-xs -mt-2">
                            {{ t('destinationSheet.keepCredentials') }}
                        </p>

                        <Field>
                            <FieldLabel for="sftp-password">
                                {{ t('destinationSheet.passwordOptional') }} <span class="text-muted-foreground font-normal">{{ t('common.optional') }}</span>
                            </FieldLabel>
                            <Input id="sftp-password" v-model="sftpPassword" type="password" autocomplete="off"
                                :class="sftpPasswordError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="sftpPasswordError">{{ sftpPasswordError }}</FieldError>
                        </Field>
                        <Field>
                            <FieldLabel for="sftp-key">
                                {{ t('destinationSheet.privateKey') }} <span class="text-muted-foreground font-normal">{{ t('common.optional') }}</span>
                            </FieldLabel>
                            <textarea id="sftp-key" v-model="sftpPrivateKey" rows="4"
                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                class="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] resize-none font-mono" />
                        </Field>

                        <Separator />
                        <Field>
                            <FieldLabel for="sftp-host-key">
                                {{ t('destinationSheet.hostKey') }} <span class="text-muted-foreground font-normal">{{ t('destinationSheet.recommended') }}</span>
                            </FieldLabel>
                            <textarea id="sftp-host-key" v-model="sftpHostKey" rows="3"
                                placeholder="backup.example.com ssh-ed25519 AAAA…"
                                class="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] resize-none font-mono"
                                :class="sftpHostKeyError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="sftpHostKeyError">{{ sftpHostKeyError }}</FieldError>
                            <p class="text-muted-foreground text-xs">
                                {{ t('destinationSheet.hostKeyHelp', { port: sftpPort || '22', host: sftpHost || '<host>' }) }}
                            </p>
                            <p v-if="!sftpHostKey.trim()" data-testid="sftp-host-key-warning"
                                class="text-amber-600 dark:text-amber-400 text-xs">
                                {{ t('destinationSheet.hostKeyWarning') }}
                            </p>
                        </Field>
                    </template>

                    <!-- ── REST ── -->
                    <template v-if="selectedType === 'rest'">
                        <Field>
                            <FieldLabel for="rest-url">{{ t('destinationSheet.restUrl') }}</FieldLabel>
                            <Input id="rest-url" v-model="restUrl" placeholder="https://rest.example.com/repo" autocomplete="off"
                                :class="restUrlError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="restUrlError">{{ restUrlError }}</FieldError>
                        </Field>

                        <Separator />
                        <p class="text-sm font-medium">
                            {{ t('destinationSheet.credentials') }}
                            <span class="text-muted-foreground font-normal"> {{ t('common.optional') }}</span>
                        </p>
                        <p v-if="isEdit" class="text-muted-foreground text-xs -mt-2">
                            {{ t('destinationSheet.keepCredentials') }}
                        </p>

                        <Field>
                            <FieldLabel for="rest-user">{{ t('destinationSheet.username') }}</FieldLabel>
                            <Input id="rest-user" v-model="restUser" autocomplete="off" />
                        </Field>
                        <Field>
                            <FieldLabel for="rest-password">{{ t('common.password') }}</FieldLabel>
                            <Input id="rest-password" v-model="restPassword" type="password" autocomplete="off" />
                        </Field>
                    </template>

                    <!-- ── Rclone ── -->
                    <template v-if="selectedType === 'rclone'">
                        <Field>
                            <FieldLabel for="rclone-remote">{{ t('destinationSheet.rcloneRemote') }}</FieldLabel>
                            <Input id="rclone-remote" v-model="rcloneRemote" :placeholder="t('destinationSheet.rcloneRemotePlaceholder')" autocomplete="off"
                                :class="rcloneRemoteError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <p class="text-muted-foreground text-xs">
                                {{ t('destinationSheet.rcloneRemoteHelp') }}
                            </p>
                            <FieldError v-if="rcloneRemoteError">{{ rcloneRemoteError }}</FieldError>
                        </Field>
                        <Field>
                            <FieldLabel for="rclone-path">{{ t('destinationSheet.path') }}</FieldLabel>
                            <Input id="rclone-path" v-model="rclonePath" :placeholder="t('destinationSheet.rclonePathPlaceholder')" autocomplete="off"
                                :class="rclonePathError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="rclonePathError">{{ rclonePathError }}</FieldError>
                        </Field>
                    </template>

                    <!-- ── Retention (issue #130) ──────────────────────────────────────
                         One retention configuration per destination, applied uniformly
                         to every policy's own snapshot-tag pool here, on its own
                         schedule fully detached from any backup job. -->
                    <Separator />

                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium">{{ t('destinationSheet.appendOnly') }}</p>
                            <p class="text-muted-foreground text-xs">
                                {{ t('destinationSheet.appendOnlyHelp') }}
                            </p>
                        </div>
                        <Switch :model-value="appendOnly" @update:model-value="(v: boolean) => { appendOnly = v; if (v) retentionEnabled = false }" />
                    </div>

                    <Alert v-if="appendOnly" variant="default" class="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
                        <AlertCircle class="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <AlertDescription class="text-amber-800 dark:text-amber-300 text-xs">
                            {{ t('destinationSheet.appendOnlyWarning') }}
                        </AlertDescription>
                    </Alert>

                    <template v-else>
                        <Alert v-if="retentionNeedsReview" variant="destructive">
                            <AlertTriangle class="h-4 w-4" />
                            <AlertDescription class="text-xs">
                                {{ t('destinationSheet.needsReviewWarning') }}
                            </AlertDescription>
                        </Alert>

                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-sm font-medium">{{ t('destinationSheet.enableRetention') }}</p>
                                <p class="text-muted-foreground text-xs">
                                    {{ t('destinationSheet.enableRetentionHelp') }}
                                </p>
                            </div>
                            <Switch :model-value="retentionEnabled" @update:model-value="retentionEnabled = $event" />
                        </div>

                        <template v-if="retentionEnabled">
                            <p class="text-sm font-medium">{{ t('destinationSheet.schedule') }}</p>
                            <div class="flex flex-wrap gap-1.5">
                                <button v-for="preset in RETENTION_SCHEDULE_PRESETS" :key="preset.value" type="button"
                                    class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                                    :class="retentionSchedule === preset.value
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border hover:border-primary/50 hover:bg-muted'"
                                    @click="retentionSchedule = preset.value">
                                    {{ preset.label }}
                                </button>
                            </div>
                            <Field>
                                <FieldLabel for="retention-schedule">{{ t('destinationSheet.cronExpression') }}</FieldLabel>
                                <Input id="retention-schedule" v-model="retentionSchedule" class="font-mono" placeholder="0 2 * * *"
                                    :class="retentionScheduleError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                <FieldError v-if="retentionScheduleError">{{ retentionScheduleError }}</FieldError>
                            </Field>

                            <p class="text-sm font-medium">{{ t('destinationSheet.retention') }}</p>
                            <p class="text-muted-foreground text-xs -mt-2">
                                {{ t('destinationSheet.retentionHelp') }}
                            </p>
                            <div class="grid grid-cols-2 gap-3">
                                <Field>
                                    <FieldLabel for="ret-last" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionLast') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipLast') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-last" v-model="retentionLast" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionLastError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionLastError">{{ retentionLastError }}</FieldError>
                                </Field>
                                <Field>
                                    <FieldLabel for="ret-hourly" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionHourly') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipHourly') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-hourly" v-model="retentionHourly" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionHourlyError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionHourlyError">{{ retentionHourlyError }}</FieldError>
                                </Field>
                                <Field>
                                    <FieldLabel for="ret-daily" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionDaily') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipDaily') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-daily" v-model="retentionDaily" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionDailyError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionDailyError">{{ retentionDailyError }}</FieldError>
                                </Field>
                                <Field>
                                    <FieldLabel for="ret-weekly" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionWeekly') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipWeekly') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-weekly" v-model="retentionWeekly" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionWeeklyError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionWeeklyError">{{ retentionWeeklyError }}</FieldError>
                                </Field>
                                <Field>
                                    <FieldLabel for="ret-monthly" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionMonthly') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipMonthly') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-monthly" v-model="retentionMonthly" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionMonthlyError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionMonthlyError">{{ retentionMonthlyError }}</FieldError>
                                </Field>
                                <Field>
                                    <FieldLabel for="ret-yearly" class="flex items-center gap-1">
                                        {{ t('destinationSheet.retentionYearly') }}
                                        <Tooltip>
                                            <TooltipTrigger class="text-muted-foreground hover:text-foreground">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-60">{{ t('destinationSheet.tipYearly') }}</TooltipContent>
                                        </Tooltip>
                                    </FieldLabel>
                                    <Input id="ret-yearly" v-model="retentionYearly" type="number" min="0" :max="MAX_RETENTION_KEEP"
                                        :class="retentionYearlyError || retentionKeepError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                    <FieldError v-if="retentionYearlyError">{{ retentionYearlyError }}</FieldError>
                                </Field>
                            </div>
                            <FieldError v-if="retentionKeepError">{{ retentionKeepError }}</FieldError>
                        </template>
                    </template>

                    <!-- ── Integrity check (issue #307) ───────────────────────────────
                         restic check on its own schedule. Restic never re-reads
                         stored data, so this is the only way damage to the
                         repository surfaces before a restore needs it. -->
                    <Separator />

                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium">{{ t('destinationSheet.enableCheck') }}</p>
                            <p class="text-muted-foreground text-xs">
                                {{ t('destinationSheet.enableCheckHelp') }}
                            </p>
                        </div>
                        <Switch :model-value="checkEnabled" @update:model-value="checkEnabled = $event" />
                    </div>

                    <template v-if="checkEnabled">
                        <Field>
                            <FieldLabel for="check-mode">{{ t('destinationSheet.checkDepth') }}</FieldLabel>
                            <Select :model-value="checkMode" @update:model-value="checkMode = $event as CheckMode">
                                <SelectTrigger id="check-mode">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem v-for="m in CHECK_MODES" :key="m.value" :value="m.value">
                                        {{ m.label }}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p class="text-muted-foreground text-xs">
                                {{ CHECK_MODES.find(m => m.value === checkMode)?.description }}
                            </p>
                        </Field>

                        <Field v-if="checkMode === 'subset'">
                            <FieldLabel for="check-subset">{{ t('destinationSheet.dataPercent') }}</FieldLabel>
                            <Input id="check-subset" v-model="checkSubsetPercent" type="number" min="1" max="100"
                                :class="checkSubsetPercentError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="checkSubsetPercentError">{{ checkSubsetPercentError }}</FieldError>
                        </Field>

                        <p class="text-sm font-medium">{{ t('destinationSheet.schedule') }}</p>
                        <div class="flex flex-wrap gap-1.5">
                            <button v-for="preset in CHECK_SCHEDULE_PRESETS" :key="preset.value" type="button"
                                class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                                :class="checkSchedule === preset.value
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border hover:border-primary/50 hover:bg-muted'"
                                @click="checkSchedule = preset.value">
                                {{ preset.label }}
                            </button>
                        </div>
                        <Field>
                            <FieldLabel for="check-schedule">{{ t('destinationSheet.cronExpression') }}</FieldLabel>
                            <Input id="check-schedule" v-model="checkSchedule" class="font-mono" :placeholder="DEFAULT_CHECK_SCHEDULE"
                                :class="checkScheduleError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="checkScheduleError">{{ checkScheduleError }}</FieldError>
                        </Field>
                    </template>

                    <!-- Maintenance agent — runs both retention sweeps and integrity
                         checks, so it is shown as soon as either is enabled. -->
                    <Field v-if="needsMaintenanceAgent">
                        <FieldLabel for="retention-agent">{{ t('destinationSheet.maintenanceAgent') }}</FieldLabel>
                        <AsyncCombobox
                            endpoint="/api/v1/agents"
                            :model-value="retentionAgentId"
                            :initial-label="props.destination?.retention_agent_name"
                            :placeholder="t('destinationSheet.selectAgent')"
                            :class="retentionAgentError ? '[&_button]:border-destructive [&_button]:focus-visible:ring-destructive/30' : ''"
                            @update:model-value="retentionAgentId = $event"
                        />
                        <p class="text-muted-foreground text-xs">
                            {{ t('destinationSheet.maintenanceAgentHelp') }}
                        </p>
                        <FieldError v-if="retentionAgentError">{{ retentionAgentError }}</FieldError>
                    </Field>

                    <!-- Enabled toggle — edit and clone modes (clone copies the original's state) -->
                    <template v-if="isEdit || isClone">
                        <Separator />
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-sm font-medium">{{ t('destinationSheet.enabled') }}</p>
                                <p class="text-muted-foreground text-xs">
                                    {{ t('destinationSheet.enabledHelp') }}
                                </p>
                            </div>
                            <Switch :model-value="enabled" @update:model-value="enabled = $event" />
                        </div>
                    </template>

                    <!-- Import existing repository — plain create mode only (not clone) -->
                    <template v-if="!isEdit && !isClone">
                        <Separator />
                        <div class="rounded-lg border p-4 space-y-3" :class="importEnabled ? 'bg-muted/30' : ''">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex items-start gap-2.5">
                                    <Archive class="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                                    <div>
                                        <p class="text-sm font-medium leading-none">{{ t('destinationSheet.importRepository') }}</p>
                                        <p class="text-muted-foreground text-xs mt-1.5">
                                            {{ t('destinationSheet.importRepositoryHelp') }}
                                        </p>
                                    </div>
                                </div>
                                <Switch :model-value="importEnabled" @update:model-value="importEnabled = $event" />
                            </div>

                            <Transition
                                enter-active-class="transition-all duration-200 overflow-hidden"
                                enter-from-class="opacity-0 max-h-0"
                                enter-to-class="opacity-100 max-h-96"
                                leave-active-class="transition-all duration-150 overflow-hidden"
                                leave-from-class="opacity-100 max-h-96"
                                leave-to-class="opacity-0 max-h-0"
                            >
                                <div v-if="importEnabled" class="space-y-3 pt-1">
                                    <Field>
                                        <FieldLabel for="import-agent">{{ t('destinationSheet.agent') }}</FieldLabel>
                                        <AsyncCombobox
                                            endpoint="/api/v1/agents"
                                            :model-value="importAgentId"
                                            :placeholder="t('destinationSheet.selectAgent')"
                                            :class="importAgentError ? '[&_button]:border-destructive [&_button]:focus-visible:ring-destructive/30' : ''"
                                            @update:model-value="importAgentId = $event"
                                        />
                                        <FieldError v-if="importAgentError">{{ importAgentError }}</FieldError>
                                    </Field>
                                    <Field>
                                        <FieldLabel for="import-password">{{ t('destinationSheet.repoPassword') }}</FieldLabel>
                                        <Input id="import-password" v-model="importRepoPassword" type="password"
                                            autocomplete="off" :placeholder="t('destinationSheet.repoPasswordPlaceholder')"
                                            :class="importPasswordError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                                        <FieldError v-if="importPasswordError">{{ importPasswordError }}</FieldError>
                                    </Field>
                                    <Transition enter-active-class="transition-all duration-200"
                                        enter-from-class="-translate-y-1 opacity-0" leave-active-class="transition-all duration-150"
                                        leave-to-class="-translate-y-1 opacity-0">
                                        <p v-if="importError" class="text-xs text-destructive flex items-start gap-1.5">
                                            <AlertCircle class="size-3.5 mt-0.5 shrink-0" />
                                            {{ importError }}
                                        </p>
                                    </Transition>
                                    <p class="text-xs text-muted-foreground">
                                        {{ t('destinationSheet.importTestNote') }}
                                    </p>
                                </div>
                            </Transition>
                        </div>
                    </template>

                    <SheetFooter class="mt-2 px-0">
                        <Button type="button" variant="outline" :disabled="submitting" @click="onOpenChange(false)">
                            {{ t('destinationSheet.cancel') }}
                        </Button>
                        <Button type="submit" :disabled="submitting">
                            <Loader2 v-if="submitting" class="size-4 animate-spin" />
                            {{ submitting ? (importEnabled ? t('destinationSheet.importing') : t('destinationSheet.saving')) : (isEdit ? t('destinationSheet.saveChanges') : (importEnabled ? t('destinationSheet.createAndImport') : t('destinationSheet.createDestination'))) }}
                        </Button>
                    </SheetFooter>

                </FieldGroup>
            </form>
        </SheetContent>
    </Sheet>
</template>