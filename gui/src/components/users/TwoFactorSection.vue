<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, useField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import QRCode from 'qrcode'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PinInput, PinInputGroup, PinInputSlot } from '@/components/ui/pin-input'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import type {
    ApiResponse, TwoFactorRecoveryCodesResponse, TwoFactorSetupResponse, TwoFactorStatus,
} from '@/types'

const auth = useAuthStore()
const { t } = useI18n()

const isOIDC = computed(() => auth.user?.is_oidc ?? false)

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const status = ref<TwoFactorStatus | null>(null)
const statusLoading = ref(true)

async function fetchStatus(): Promise<void> {
    statusLoading.value = true
    try {
        const res = await api<ApiResponse<TwoFactorStatus>>('/api/v1/auth/2fa/status')
        status.value = res.data
    } finally {
        statusLoading.value = false
    }
}

onMounted(fetchStatus)

// ---------------------------------------------------------------------------
// Enrollment (setup → verify)
// ---------------------------------------------------------------------------

// Enrollment runs as a two-step dialog: the QR step, then the verify step.
// enrollDialogOpen controls the shared dialog; enrollStep picks its content.
const enrollDialogOpen = ref(false)
const enrollStep = ref<'qr' | 'verify'>('qr')
const setupData = ref<TwoFactorSetupResponse | null>(null)
const qrDataUrl = ref('')
const enrollError = ref<string | null>(null)
const enrollSubmitting = ref(false)
const verifyPinEl = useTemplateRef<HTMLElement>('verifyPin')

// The section holds three small forms (the code that confirms enrollment and
// the password that confirms disabling or regenerating): each field names
// the form it belongs to, since useField would otherwise attach to the last
// form created in the component.
const verifyForm = useForm({
    validationSchema: toTypedSchema(z.object({
        code: z.array(z.string()).refine((c) => c.join('').length === 6, { error: () => t('twoFactor.validation.allDigits') }),
    })),
    initialValues: { code: [] as string[] },
})
// The code is checked on submit only, as on the login page.
const { value: verifyCode, errorMessage: verifyCodeError } =
    useField<string[]>('code', undefined, { form: verifyForm, validateOnValueUpdate: false })

async function startEnrollment(): Promise<void> {
    enrollError.value = null
    enrollSubmitting.value = true
    try {
        const res = await api<ApiResponse<TwoFactorSetupResponse>>('/api/v1/auth/2fa/setup', {
            method: 'POST',
        })
        setupData.value = res.data
        qrDataUrl.value = await QRCode.toDataURL(res.data.otpauth_url, { width: 200, margin: 1 })
        verifyForm.resetForm()
        enrollStep.value = 'qr'
        enrollDialogOpen.value = true
    } catch (e: any) {
        enrollError.value = apiErrorMessage(e, t('twoFactor.errors.startFailed'))
    } finally {
        enrollSubmitting.value = false
    }
}

function cancelEnrollment(): void {
    enrollDialogOpen.value = false
    enrollStep.value = 'qr'
    setupData.value = null
    qrDataUrl.value = ''
    verifyForm.resetForm()
    enrollError.value = null
}

const submitVerify = verifyForm.handleSubmit(async (values) => {
    enrollError.value = null
    enrollSubmitting.value = true
    try {
        const res = await api<ApiResponse<TwoFactorRecoveryCodesResponse>>('/api/v1/auth/2fa/verify', {
            method: 'POST',
            body: { code: values.code.join('') },
        })
        if (auth.user) auth.user.two_factor_enabled = true
        enrollDialogOpen.value = false
        enrollStep.value = 'qr'
        setupData.value = null
        qrDataUrl.value = ''
        recoveryCodes.value = res.data.recovery_codes
        recoveryCodesDialogOpen.value = true
        await fetchStatus()
    } catch (e: any) {
        enrollError.value = apiErrorMessage(e, t('twoFactor.errors.invalidCode'))
        enrollSubmitting.value = false
        // Clear the rejected code and put the cursor back on the first digit.
        verifyCode.value = []
        await nextTick()
        verifyPinEl.value?.querySelector<HTMLInputElement>('[data-slot="pin-input-slot"]')?.focus()
        return
    }
    enrollSubmitting.value = false
})

// ---------------------------------------------------------------------------
// Recovery codes dialog — shown once after verify or regenerate
// ---------------------------------------------------------------------------

const recoveryCodesDialogOpen = ref(false)
const recoveryCodes = ref<string[]>([])
const codesCopied = ref(false)

async function copyRecoveryCodes(): Promise<void> {
    await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
    codesCopied.value = true
    setTimeout(() => { codesCopied.value = false }, 2000)
}

function downloadRecoveryCodes(): void {
    const blob = new Blob([recoveryCodes.value.join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'arkeep-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------

// passwordFormSchema is the current password that confirms a sensitive
// change; the server checks it.
const passwordFormSchema = toTypedSchema(z.object({
    password: z.string().min(1, { error: () => t('twoFactor.validation.passwordRequired') }),
}))

const disableDialogOpen = ref(false)
const disableError = ref<string | null>(null)
const showDisablePassword = ref(false)

const disableForm = useForm({ validationSchema: passwordFormSchema, initialValues: { password: '' } })
const { isSubmitting: disableLoading } = disableForm
const { value: disablePassword, errorMessage: disablePasswordError } =
    useField<string>('password', undefined, { form: disableForm })

function openDisableDialog(): void {
    disableForm.resetForm()
    disableError.value = null
    disableDialogOpen.value = true
}

const confirmDisable = disableForm.handleSubmit(async (values) => {
    disableError.value = null
    try {
        await api('/api/v1/auth/2fa/disable', {
            method: 'POST',
            body: { password: values.password },
        })
        if (auth.user) auth.user.two_factor_enabled = false
        disableDialogOpen.value = false
        await fetchStatus()
    } catch (e: any) {
        disableError.value = apiErrorMessage(e, t('twoFactor.errors.incorrectPassword'))
    }
})

// ---------------------------------------------------------------------------
// Regenerate recovery codes
// ---------------------------------------------------------------------------

const regenerateDialogOpen = ref(false)
const regenerateError = ref<string | null>(null)
const showRegeneratePassword = ref(false)

const regenerateForm = useForm({ validationSchema: passwordFormSchema, initialValues: { password: '' } })
const { isSubmitting: regenerateLoading } = regenerateForm
const { value: regeneratePassword, errorMessage: regeneratePasswordError } =
    useField<string>('password', undefined, { form: regenerateForm })

function openRegenerateDialog(): void {
    regenerateForm.resetForm()
    regenerateError.value = null
    regenerateDialogOpen.value = true
}

const confirmRegenerate = regenerateForm.handleSubmit(async (values) => {
    regenerateError.value = null
    try {
        const res = await api<ApiResponse<TwoFactorRecoveryCodesResponse>>('/api/v1/auth/2fa/recovery-codes/regenerate', {
            method: 'POST',
            body: { password: values.password },
        })
        regenerateDialogOpen.value = false
        recoveryCodes.value = res.data.recovery_codes
        recoveryCodesDialogOpen.value = true
        await fetchStatus()
    } catch (e: any) {
        regenerateError.value = apiErrorMessage(e, t('twoFactor.errors.incorrectPassword'))
    }
})
</script>

<template>
    <div class="grid grid-cols-[280px_1fr] gap-12 py-8 border-b">
        <div>
            <h2 class="text-sm font-semibold">{{ t('twoFactor.title') }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
                {{ t('twoFactor.description') }}
            </p>
        </div>

        <!-- OIDC accounts are managed by their identity provider -->
        <div v-if="isOIDC"
            class="flex items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
            {{ t('twoFactor.oidcManaged') }}
        </div>

        <div v-else-if="statusLoading || !status" class="flex justify-center py-4 text-muted-foreground">
            <Loader2 class="size-5 animate-spin" />
        </div>

        <!-- Enabled -->
        <div v-else-if="status.enabled" class="flex flex-col gap-4">
            <div class="flex items-center gap-2">
                <Badge variant="outline" class="gap-1">
                    <ShieldCheck class="size-3" />
                    {{ t('twoFactor.enabled') }}
                </Badge>
                <span class="text-sm text-muted-foreground">
                    {{ t('twoFactor.recoveryRemaining', status.recovery_codes_remaining, { named: { n: status.recovery_codes_remaining } }) }}
                </span>
            </div>
            <div class="flex gap-2">
                <Button variant="outline" @click="openRegenerateDialog">{{ t('twoFactor.regenerateCodes') }}</Button>
                <Button variant="outline" @click="openDisableDialog">{{ t('twoFactor.disable') }}</Button>
            </div>
        </div>

        <!-- Disabled -->
        <div v-else class="flex flex-col items-start gap-4">
            <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                <Alert v-if="enrollError" variant="destructive">
                    <AlertCircle class="size-4" />
                    <AlertDescription>{{ enrollError }}</AlertDescription>
                </Alert>
            </Transition>
            <Button :disabled="enrollSubmitting" @click="startEnrollment">
                <Loader2 v-if="enrollSubmitting" class="size-4 animate-spin" />
                {{ enrollSubmitting ? t('twoFactor.starting') : t('twoFactor.enable') }}
            </Button>
        </div>
    </div>

    <!-- Enrollment — QR step, then verify step, same dialog throughout -->
    <Dialog :open="enrollDialogOpen" @update:open="(v) => { if (!v) cancelEnrollment() }">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('twoFactor.setupTitle') }}</DialogTitle>
                <DialogDescription v-if="enrollStep === 'qr'">
                    {{ t('twoFactor.setupQrDescription') }}
                </DialogDescription>
                <DialogDescription v-else>
                    {{ t('twoFactor.setupVerifyDescription') }}
                </DialogDescription>
            </DialogHeader>

            <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                <Alert v-if="enrollError" variant="destructive">
                    <AlertCircle class="size-4" />
                    <AlertDescription>{{ enrollError }}</AlertDescription>
                </Alert>
            </Transition>

            <div v-if="enrollStep === 'qr'" class="flex flex-col items-center gap-3">
                <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('twoFactor.qrAlt')"
                    class="rounded-md border" width="200" height="200">
                <code class="block w-full break-all rounded bg-muted px-2 py-1 text-center text-xs">{{ setupData?.secret }}</code>
            </div>

            <FieldGroup v-else>
                <Field class="items-center">
                    <div ref="verifyPin" class="w-full">
                        <PinInput v-model="verifyCode" otp class="w-full" :disabled="enrollSubmitting"
                            @complete="submitVerify()">
                            <PinInputGroup class="w-full justify-between">
                                <PinInputSlot v-for="i in 6" :key="i" :index="i - 1" />
                            </PinInputGroup>
                        </PinInput>
                    </div>
                    <FieldError v-if="verifyCodeError">{{ verifyCodeError }}</FieldError>
                </Field>
            </FieldGroup>

            <DialogFooter>
                <template v-if="enrollStep === 'qr'">
                    <Button variant="outline" @click="cancelEnrollment">{{ t('twoFactor.cancel') }}</Button>
                    <Button @click="enrollStep = 'verify'">{{ t('twoFactor.done') }}</Button>
                </template>
                <template v-else>
                    <Button variant="outline" :disabled="enrollSubmitting" @click="enrollStep = 'qr'">{{ t('twoFactor.back') }}</Button>
                    <Button :disabled="enrollSubmitting" @click="submitVerify()">
                        <Loader2 v-if="enrollSubmitting" class="size-4 animate-spin" />
                        {{ enrollSubmitting ? t('twoFactor.verifying') : t('twoFactor.verify') }}
                    </Button>
                </template>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- Recovery codes — shown once after verify or regenerate -->
    <Dialog :open="recoveryCodesDialogOpen" @update:open="recoveryCodesDialogOpen = $event">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('twoFactor.codesTitle') }}</DialogTitle>
                <DialogDescription>
                    {{ t('twoFactor.codesDescription') }}
                </DialogDescription>
            </DialogHeader>
            <div class="grid grid-cols-2 gap-2 rounded-md border bg-muted/50 p-4 font-mono text-sm">
                <span v-for="code in recoveryCodes" :key="code">{{ code }}</span>
            </div>
            <DialogFooter class="gap-2 sm:justify-between">
                <div class="flex gap-2">
                    <Button variant="outline" @click="copyRecoveryCodes">{{ codesCopied ? t('twoFactor.copied') : t('twoFactor.copy') }}</Button>
                    <Button variant="outline" @click="downloadRecoveryCodes">{{ t('twoFactor.download') }}</Button>
                </div>
                <Button @click="recoveryCodesDialogOpen = false">{{ t('twoFactor.done') }}</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- Disable confirmation -->
    <Dialog :open="disableDialogOpen" @update:open="disableDialogOpen = $event">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('twoFactor.disableTitle') }}</DialogTitle>
                <DialogDescription>
                    {{ t('twoFactor.disableDescription') }}
                </DialogDescription>
            </DialogHeader>
            <FieldGroup>
                <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                    leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                    <Alert v-if="disableError" variant="destructive">
                        <AlertCircle class="size-4" />
                        <AlertDescription>{{ disableError }}</AlertDescription>
                    </Alert>
                </Transition>
                <Field>
                    <FieldLabel for="disable-password">{{ t('twoFactor.password') }}</FieldLabel>
                    <div class="relative">
                        <Input id="disable-password" v-model="disablePassword"
                            :type="showDisablePassword ? 'text' : 'password'" autocomplete="current-password"
                            class="pr-10"
                            :class="disablePasswordError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
                            @keydown.enter.prevent="confirmDisable()" />
                        <button type="button"
                            class="absolute transition-colors -translate-y-1/2 right-3 top-1/2 text-muted-foreground hover:text-foreground"
                            :aria-label="showDisablePassword ? t('auth.hidePassword') : t('auth.showPassword')"
                            @click="showDisablePassword = !showDisablePassword">
                            <EyeOff v-if="showDisablePassword" class="size-4" />
                            <Eye v-else class="size-4" />
                        </button>
                    </div>
                    <FieldError v-if="disablePasswordError">{{ disablePasswordError }}</FieldError>
                </Field>
            </FieldGroup>
            <DialogFooter>
                <Button variant="outline" :disabled="disableLoading" @click="disableDialogOpen = false">{{ t('twoFactor.cancel') }}</Button>
                <Button variant="destructive" :disabled="disableLoading" @click="confirmDisable()">
                    <Loader2 v-if="disableLoading" class="size-4 animate-spin" />
                    {{ disableLoading ? t('twoFactor.disabling') : t('twoFactor.disable') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- Regenerate confirmation -->
    <Dialog :open="regenerateDialogOpen" @update:open="regenerateDialogOpen = $event">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('twoFactor.regenerateTitle') }}</DialogTitle>
                <DialogDescription>
                    {{ t('twoFactor.regenerateDescription') }}
                </DialogDescription>
            </DialogHeader>
            <FieldGroup>
                <Transition enter-active-class="transition-all duration-200" enter-from-class="-translate-y-1 opacity-0"
                    leave-active-class="transition-all duration-150" leave-to-class="-translate-y-1 opacity-0">
                    <Alert v-if="regenerateError" variant="destructive">
                        <AlertCircle class="size-4" />
                        <AlertDescription>{{ regenerateError }}</AlertDescription>
                    </Alert>
                </Transition>
                <Field>
                    <FieldLabel for="regenerate-password">{{ t('twoFactor.password') }}</FieldLabel>
                    <div class="relative">
                        <Input id="regenerate-password" v-model="regeneratePassword"
                            :type="showRegeneratePassword ? 'text' : 'password'" autocomplete="current-password"
                            class="pr-10"
                            :class="regeneratePasswordError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
                            @keydown.enter.prevent="confirmRegenerate()" />
                        <button type="button"
                            class="absolute transition-colors -translate-y-1/2 right-3 top-1/2 text-muted-foreground hover:text-foreground"
                            :aria-label="showRegeneratePassword ? t('auth.hidePassword') : t('auth.showPassword')"
                            @click="showRegeneratePassword = !showRegeneratePassword">
                            <EyeOff v-if="showRegeneratePassword" class="size-4" />
                            <Eye v-else class="size-4" />
                        </button>
                    </div>
                    <FieldError v-if="regeneratePasswordError">{{ regeneratePasswordError }}</FieldError>
                </Field>
            </FieldGroup>
            <DialogFooter>
                <Button variant="outline" :disabled="regenerateLoading" @click="regenerateDialogOpen = false">{{ t('twoFactor.cancel') }}</Button>
                <Button :disabled="regenerateLoading" @click="confirmRegenerate()">
                    <Loader2 v-if="regenerateLoading" class="size-4 animate-spin" />
                    {{ regenerateLoading ? t('twoFactor.regenerating') : t('twoFactor.regenerate') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
