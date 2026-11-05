<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, useField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import {
    Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
    Field, FieldError, FieldGroup, FieldLabel,
} from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { AlertCircle, Loader2 } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import { passwordSchema } from '@/lib/validation'
import type { User } from '@/types'

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
    open: boolean
    // null = create mode, User = edit mode
    user: User | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    // Emitted after a successful create or edit so the parent can refresh
    saved: []
}>()

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

const isEdit = computed(() => props.user !== null)
const { t } = useI18n()

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

// Email and password are set on create only: in edit mode the email is shown
// read-only and the password is changed by the user from the Profile page.
const roleSchema = z.enum(['admin', 'user'])

function createSchema() {
    return z.object({
        email: z.email({ error: () => t('userSheet.validation.emailInvalid') }),
        display_name: z.string().min(1, { error: () => t('userSheet.validation.displayNameRequired') }),
        password: passwordSchema(),
        role: roleSchema,
        is_active: z.boolean(),
    })
}

function editSchema() {
    return z.object({
        email: z.string(),
        display_name: z.string().min(1, { error: () => t('userSheet.validation.displayNameRequired') }),
        password: z.string(),
        role: roleSchema,
        is_active: z.boolean(),
    })
}

const validationSchema = computed(() =>
    toTypedSchema(isEdit.value ? editSchema() : createSchema()),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({
    validationSchema,
    initialValues: formValues(),
})

const { value: fieldEmail, errorMessage: emailError } = useField<string>('email')
const { value: fieldDisplayName, errorMessage: displayNameError } = useField<string>('display_name')
const { value: fieldPassword, errorMessage: passwordError } = useField<string>('password')
const { value: fieldRole } = useField<'admin' | 'user'>('role')
const { value: fieldIsActive } = useField<boolean>('is_active')

const submitError = ref<string | null>(null)

// formValues returns the form values for the current user, or empty ones for
// a new user.
function formValues() {
    return {
        email: props.user?.email ?? '',
        display_name: props.user?.display_name ?? '',
        password: '',
        role: (props.user?.role as 'admin' | 'user') ?? 'user',
        is_active: props.user?.is_active ?? true,
    }
}

// ---------------------------------------------------------------------------
// Reset / populate form when sheet opens or user changes
// ---------------------------------------------------------------------------

function reset() {
    resetForm({ values: formValues() })
    submitError.value = null
}

// Called by the parent via template ref when it opens the sheet
defineExpose({ reset })

// ---------------------------------------------------------------------------
// Sheet open/close passthrough
// ---------------------------------------------------------------------------

function onOpenChange(val: boolean) {
    emit('update:open', val)
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

const onSubmit = handleSubmit(async (values) => {
    submitError.value = null
    try {
        if (isEdit.value && props.user) {
            await api(`/api/v1/users/${props.user.id}`, {
                method: 'PATCH',
                body: {
                    display_name: values.display_name,
                    role: values.role,
                    is_active: values.is_active,
                },
            })
        } else {
            await api('/api/v1/users', {
                method: 'POST',
                body: {
                    email: values.email,
                    display_name: values.display_name,
                    password: values.password,
                    role: values.role,
                },
            })
        }
        emit('update:open', false)
        emit('saved')
    } catch (e: any) {
        submitError.value = apiErrorMessage(e, t('userSheet.saveFailed'))
    }
})
</script>

<template>
    <Sheet :open="open" @update:open="onOpenChange">
        <SheetContent class="sm:max-w-md overflow-y-auto">
            <SheetHeader>
                <SheetTitle>{{ isEdit ? t('userSheet.editTitle') : t('userSheet.newTitle') }}</SheetTitle>
                <SheetDescription>
                    {{ isEdit ? t('userSheet.editDescription') : t('userSheet.newDescription') }}
                </SheetDescription>
            </SheetHeader>

            <form class="py-6 px-4" novalidate @submit="onSubmit">
                <FieldGroup class="flex flex-col gap-4">

                    <!-- Error banner -->
                    <Transition enter-active-class="transition-all duration-200"
                        enter-from-class="-translate-y-1 opacity-0" leave-active-class="transition-all duration-150"
                        leave-to-class="-translate-y-1 opacity-0">
                        <Alert v-if="submitError" variant="destructive">
                            <AlertCircle class="size-4" />
                            <AlertDescription>{{ submitError }}</AlertDescription>
                        </Alert>
                    </Transition>

                    <!-- Email — create only -->
                    <Field v-if="!isEdit">
                        <FieldLabel for="user-email">{{ t('userSheet.email') }}</FieldLabel>
                        <Input id="user-email" v-model="fieldEmail" type="email" :placeholder="t('userSheet.emailPlaceholder')"
                            autocomplete="off"
                            :class="emailError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="emailError">{{ emailError }}</FieldError>
                    </Field>

                    <!-- Email read-only in edit mode -->
                    <div v-else class="flex flex-col gap-1.5">
                        <p class="text-sm font-medium">{{ t('userSheet.email') }}</p>
                        <p class="text-sm text-muted-foreground font-mono">{{ fieldEmail }}</p>
                    </div>

                    <!-- Display name -->
                    <Field>
                        <FieldLabel for="user-display-name">{{ t('userSheet.displayName') }}</FieldLabel>
                        <Input id="user-display-name" v-model="fieldDisplayName" :placeholder="t('userSheet.displayNamePlaceholder')"
                            autocomplete="off"
                            :class="displayNameError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                        <FieldError v-if="displayNameError">{{ displayNameError }}</FieldError>
                    </Field>

                    <!-- Password — create only; in edit mode the admin cannot set the password here.
               Users change their own password from the Profile page. -->
                    <template v-if="!isEdit">
                        <Field>
                            <FieldLabel for="user-password">{{ t('userSheet.password') }}</FieldLabel>
                            <Input id="user-password" v-model="fieldPassword" type="password"
                                autocomplete="new-password"
                                :class="passwordError ? 'border-destructive focus-visible:ring-destructive/30' : ''" />
                            <FieldError v-if="passwordError">{{ passwordError }}</FieldError>
                        </Field>
                    </template>

                    <!-- Role -->
                    <Field>
                        <FieldLabel>{{ t('userSheet.role') }}</FieldLabel>
                        <Select :model-value="fieldRole" @update:model-value="fieldRole = $event as 'admin' | 'user'">
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">{{ t('userSheet.roleUser') }}</SelectItem>
                                <SelectItem value="admin">{{ t('userSheet.roleAdmin') }}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <!-- Active toggle — edit only -->
                    <div v-if="isEdit" class="flex items-center justify-between pt-1">
                        <div>
                            <p class="text-sm font-medium">{{ t('userSheet.active') }}</p>
                            <p class="text-xs text-muted-foreground">{{ t('userSheet.activeHelp') }}</p>
                        </div>
                        <Switch :model-value="fieldIsActive" @update:model-value="fieldIsActive = $event" />
                    </div>

                    <SheetFooter class="mt-2 px-0">
                        <Button type="button" variant="outline" :disabled="isSubmitting"
                            @click="emit('update:open', false)">
                            {{ t('userSheet.cancel') }}
                        </Button>
                        <Button type="submit" :disabled="isSubmitting">
                            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
                            {{ isSubmitting ? t('userSheet.saving') : (isEdit ? t('userSheet.saveChanges') : t('userSheet.createUser')) }}
                        </Button>
                    </SheetFooter>

                </FieldGroup>
            </form>
        </SheetContent>
    </Sheet>
</template>