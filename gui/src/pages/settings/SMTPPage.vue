<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, useField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { integerInRange } from '@/lib/validation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { AlertCircle, Loader2, RefreshCw, Send, X } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import type { ApiResponse, SMTPSettings } from '@/types'

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

const loading = ref(false)
const { t } = useI18n()
const smtpExists = ref(false)
const submitError = ref<string | null>(null)
const success = ref(false)

const schema = toTypedSchema(
    z.object({
        host: z.string().min(1, { error: () => t('settingsSmtp.hostRequired') }),
        port: integerInRange(1, 65535),
        tls: z.boolean(),
        auth_enabled: z.boolean(),
        username: z.string(),
        password: z.string(),
        from: z.email({ error: () => t('settingsSmtp.emailInvalid') }),
        from_name: z.string(),
        recipients: z.array(z.string()),
        // The address being typed in the recipients input: checked when it is
        // added to the list, not on submit.
        recipient_input: z.string(),
    }),
)

function defaultValues() {
    return {
        host: '',
        port: 587,
        tls: false,
        auth_enabled: false,
        username: '',
        password: '',
        from: '',
        from_name: '',
        recipients: [] as string[],
        recipient_input: '',
    }
}

const { handleSubmit, resetForm, isSubmitting } = useForm({
    validationSchema: schema,
    initialValues: defaultValues(),
})

// Connection
const { value: smtpHost, errorMessage: hostError } = useField<string>('host')
const { value: smtpPort, errorMessage: portError } = useField<number | string>('port')
const { value: smtpTLS } = useField<boolean>('tls')

// Auth
const { value: smtpAuthEnabled } = useField<boolean>('auth_enabled')
const { value: smtpUsername } = useField<string>('username')
const { value: smtpPassword } = useField<string>('password')

// From / recipients
const { value: smtpFrom, errorMessage: fromError } = useField<string>('from')
const { value: smtpFromName } = useField<string>('from_name')
const { value: smtpRecipients } = useField<string[]>('recipients')
const {
    value: recipientInput,
    errorMessage: recipientError,
    setErrors: setRecipientError,
} = useField<string>('recipient_input', undefined, { validateOnValueUpdate: false })

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

function addRecipient() {
    setRecipientError([])
    const email = recipientInput.value.trim()
    if (!email) return
    if (!z.email().safeParse(email).success) {
        setRecipientError(t('settingsSmtp.invalidEmail'))
        return
    }
    if (smtpRecipients.value.includes(email)) {
        setRecipientError(t('settingsSmtp.alreadyInList'))
        return
    }
    smtpRecipients.value = [...smtpRecipients.value, email]
    recipientInput.value = ''
}

function removeRecipient(email: string) {
    smtpRecipients.value = smtpRecipients.value.filter(r => r !== email)
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchSMTP() {
    loading.value = true
    try {
        const res = await api<ApiResponse<SMTPSettings>>('/api/v1/settings/smtp')
        const s = res.data
        smtpExists.value = true
        resetForm({
            values: {
                ...defaultValues(),
                host: s.host ?? '',
                port: s.port ?? 587,
                tls: s.tls ?? false,
                auth_enabled: !!s.username,
                username: s.username ?? '',
                from: s.from ?? '',
                from_name: s.from_name ?? '',
                recipients: s.recipients ?? [],
            },
        })
    } catch (e: any) {
        if (e?.status === 404 || e?.response?.status === 404) {
            smtpExists.value = false
        }
    } finally {
        loading.value = false
    }
}

onMounted(fetchSMTP)

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

type FormValues = ReturnType<typeof defaultValues>

// requestBody is what both Save and Send test email send: the form values.
function requestBody(values: FormValues) {
    return {
        host: values.host,
        port: values.port,
        tls: values.tls,
        username: values.auth_enabled ? values.username : '',
        password: values.auth_enabled ? values.password : '',
        from: values.from,
        from_name: values.from_name,
        recipients: values.recipients,
    }
}

const submit = handleSubmit(async (values) => {
    submitError.value = null
    success.value = false
    testResult.value = null

    try {
        await api('/api/v1/settings/smtp', {
            method: 'PUT',
            body: requestBody(values),
        })
        smtpExists.value = true
        smtpPassword.value = ''
        success.value = true
        setTimeout(() => { success.value = false }, 3000)
    } catch (e: any) {
        submitError.value = apiErrorMessage(e, t('settingsSmtp.saveFailed'))
    }
})

// ---------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------

// The server sends the test to the signed-in admin, with the values in the
// form, saved or not. A blank password means the saved one, for the saved host.
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const sendTest = handleSubmit(async (values) => {
    submitError.value = null
    success.value = false
    testResult.value = null
    testing.value = true
    try {
        const res = await api<ApiResponse<{ sent_to: string }>>('/api/v1/settings/smtp/test', {
            method: 'POST',
            body: requestBody(values),
        })
        testResult.value = { ok: true, message: t('settingsSmtp.testSent', { email: res.data.sent_to }) }
    } catch (e: any) {
        testResult.value = { ok: false, message: apiErrorMessage(e, t('settingsSmtp.sendFailed')) }
    } finally {
        testing.value = false
    }
})
</script>

<template>
    <!-- Section header -->
    <div class="flex items-start justify-between gap-4 mb-6">
        <div>
            <h2 class="text-base font-semibold">{{ t('settingsSmtp.title') }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
                {{ t('settingsSmtp.description') }}
            </p>
            <p v-if="!loading && !smtpExists" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {{ t('settingsSmtp.notConfigured') }}
            </p>
        </div>
        <Button variant="outline" size="icon" :aria-label="t('common.refresh')" :disabled="loading" @click="fetchSMTP">
            <RefreshCw class="size-4" :class="{ 'animate-spin': loading }" />
        </Button>
    </div>

    <!-- Skeleton -->
    <template v-if="loading">
        <div class="flex flex-col gap-6">
            <Skeleton class="h-20 w-full rounded-lg" />
            <Skeleton class="h-16 w-full rounded-lg" />
            <Skeleton class="h-16 w-full rounded-lg" />
            <Skeleton class="h-28 w-full rounded-lg" />
        </div>
    </template>

    <!-- Form -->
    <form v-else novalidate @submit="submit">
        <FieldGroup class="flex flex-col gap-6">

            <!-- Alerts -->
            <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                <Alert v-if="submitError" variant="destructive">
                    <AlertCircle class="size-4" />
                    <AlertDescription>{{ submitError }}</AlertDescription>
                </Alert>
            </Transition>

            <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                <Alert v-if="success"
                    class="border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
                    <AlertDescription>{{ t('settingsSmtp.saved') }}</AlertDescription>
                </Alert>
            </Transition>

            <Alert v-if="testResult" :variant="testResult.ok ? 'default' : 'destructive'" data-testid="smtp-test-result"
                :class="testResult.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' : ''">
                <AlertDescription>{{ testResult.message }}</AlertDescription>
            </Alert>

            <!-- ── Connection ──────────────────────────────────────────────── -->
            <div class="flex flex-col gap-4">
                <p class="text-sm font-medium">{{ t('settingsSmtp.connection') }}</p>

                <div class="grid grid-cols-3 gap-3">
                    <Field class="col-span-2">
                        <FieldLabel for="smtp-host">{{ t('settingsSmtp.host') }}</FieldLabel>
                        <Input id="smtp-host" v-model="smtpHost" placeholder="smtp.example.com" autocomplete="off"
                            :class="hostError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="hostError">{{ hostError }}</FieldError>
                    </Field>
                    <Field>
                        <FieldLabel for="smtp-port">{{ t('settingsSmtp.port') }}</FieldLabel>
                        <Input id="smtp-port" v-model="smtpPort" type="number" placeholder="587"
                            :class="portError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="portError">{{ portError }}</FieldError>
                    </Field>
                </div>

                <div class="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                        <p class="text-sm font-medium">{{ t('settingsSmtp.tls') }}</p>
                        <p class="text-xs text-muted-foreground">
                            {{ t('settingsSmtp.tlsHelp') }}
                        </p>
                    </div>
                    <Switch :model-value="smtpTLS" @update:model-value="smtpTLS = $event" />
                </div>
            </div>

            <Separator />

            <!-- ── Authentication ──────────────────────────────────────────── -->
            <div class="flex flex-col gap-4">
                <div class="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                        <p class="text-sm font-medium">{{ t('settingsSmtp.authentication') }}</p>
                        <p class="text-xs text-muted-foreground">
                            {{ t('settingsSmtp.authHelp') }}
                        </p>
                    </div>
                    <Switch :model-value="smtpAuthEnabled" @update:model-value="smtpAuthEnabled = $event" />
                </div>

                <Transition enter-active-class="transition-all duration-200"
                    enter-from-class="opacity-0 -translate-y-1" leave-active-class="transition-all duration-150"
                    leave-to-class="opacity-0 -translate-y-1">
                    <div v-if="smtpAuthEnabled" class="grid grid-cols-2 gap-3">
                        <Field>
                            <FieldLabel for="smtp-username">{{ t('settingsSmtp.username') }}</FieldLabel>
                            <Input id="smtp-username" v-model="smtpUsername" autocomplete="off" />
                        </Field>
                        <Field>
                            <FieldLabel for="smtp-password">
                                {{ t('settingsSmtp.password') }}
                                <span v-if="smtpExists" class="text-muted-foreground font-normal">{{ t('common.optional') }}</span>
                            </FieldLabel>
                            <Input id="smtp-password" v-model="smtpPassword" type="password"
                                :placeholder="smtpExists ? t('settingsSmtp.unchanged') : ''" autocomplete="new-password" />
                        </Field>
                    </div>
                </Transition>
            </div>

            <Separator />

            <!-- ── From address ────────────────────────────────────────────── -->
            <Field>
                <FieldLabel for="smtp-from">{{ t('settingsSmtp.fromAddress') }}</FieldLabel>
                <Input id="smtp-from" v-model="smtpFrom" placeholder="arkeep@example.com" autocomplete="off"
                    :class="fromError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                <p class="text-xs text-muted-foreground">{{ t('settingsSmtp.fromHelp') }}</p>
                <FieldError v-if="fromError">{{ fromError }}</FieldError>
            </Field>

            <!-- ── From name ───────────────────────────────────────────────── -->
            <Field>
                <FieldLabel for="smtp-from-name">{{ t('settingsSmtp.fromName') }}</FieldLabel>
                <Input id="smtp-from-name" v-model="smtpFromName" :placeholder="t('settingsSmtp.fromNamePlaceholder')" autocomplete="off" />
                <p class="text-xs text-muted-foreground">
                    {{ t('settingsSmtp.fromNameHelp') }}
                </p>
            </Field>

            <Separator />

            <!-- ── Notification recipients ─────────────────────────────────── -->
            <div class="flex flex-col gap-3">
                <div>
                    <p class="text-sm font-medium">{{ t('settingsSmtp.recipients') }}</p>
                    <p class="text-xs text-muted-foreground mt-0.5">
                        {{ t('settingsSmtp.recipientsHelp') }}
                    </p>
                </div>

                <!-- Chips -->
                <div v-if="smtpRecipients.length" class="flex flex-wrap gap-1.5">
                    <span v-for="email in smtpRecipients" :key="email"
                        class="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                        {{ email }}
                        <button type="button" :aria-label="t('settingsSmtp.removeRecipient', { email })"
                            class="ml-0.5 rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            @click="removeRecipient(email)">
                            <X class="size-3" />
                        </button>
                    </span>
                </div>

                <!-- Add input -->
                <div class="flex gap-2">
                    <div class="flex-1">
                        <Input id="smtp-recipient-input" v-model="recipientInput" type="email"
                            placeholder="admin@company.com" autocomplete="off"
                            :class="recipientError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
                            @keydown.enter.prevent="addRecipient" />
                        <FieldError v-if="recipientError" class="mt-1">{{ recipientError }}</FieldError>
                    </div>
                    <Button type="button" variant="outline" @click="addRecipient">{{ t('settingsSmtp.add') }}</Button>
                </div>
            </div>

            <!-- ── Submit ──────────────────────────────────────────────────── -->
            <div class="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" :disabled="isSubmitting || testing" @click="sendTest">
                    <Loader2 v-if="testing" class="size-4 animate-spin" />
                    <Send v-else class="size-4" />
                    {{ testing ? t('settingsSmtp.sending') : t('settingsSmtp.sendTest') }}
                </Button>
                <Button type="submit" :disabled="isSubmitting">
                    <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
                    {{ isSubmitting ? t('settingsSmtp.saving') : t('settingsSmtp.saveSettings') }}
                </Button>
            </div>

        </FieldGroup>
    </form>
</template>
