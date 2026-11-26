<script setup lang="ts">
// ApiTokenRevokeDialog.vue — Confirms the revocation of an API token. Open
// while token is not null. endpoint is the collection the token is deleted
// from: the user's own tokens, or every user's for an admin.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Loader2 } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import type { ApiToken } from '@/types'

const { t } = useI18n()

const props = defineProps<{
    token: ApiToken | null
    endpoint: string
}>()

const emit = defineEmits<{
    cancel: []
    revoked: []
}>()

const revoking = ref(false)
const error = ref<string | null>(null)

watch(() => props.token, () => { error.value = null })

async function confirmRevoke(): Promise<void> {
    if (!props.token) return
    revoking.value = true
    error.value = null
    try {
        await api(`${props.endpoint}/${props.token.id}`, { method: 'DELETE' })
        emit('revoked')
    } catch (e) {
        error.value = apiErrorMessage(e, t('apiTokens.revokeFailed'))
    } finally {
        revoking.value = false
    }
}
</script>

<template>
    <AlertDialog :open="props.token !== null" @update:open="(v) => { if (!v) emit('cancel') }">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{{ t('apiTokens.revokeTitle') }}</AlertDialogTitle>
                <AlertDialogDescription>
                    <span v-if="props.token">
                        <strong>{{ props.token.name }}</strong>
                        <template v-if="props.token.user_email">{{ t('apiTokens.revokeBodyOf', { email: props.token.user_email }) }}</template>
                        {{ t('apiTokens.revokeBodyAfter') }}
                    </span>
                </AlertDialogDescription>
            </AlertDialogHeader>

            <Alert v-if="error" variant="destructive">
                <AlertDescription>{{ error }}</AlertDescription>
            </Alert>

            <AlertDialogFooter>
                <AlertDialogCancel :disabled="revoking">{{ t('common.cancel') }}</AlertDialogCancel>
                <Button variant="destructive" :disabled="revoking" @click="confirmRevoke">
                    <Loader2 v-if="revoking" class="size-4 animate-spin" />
                    {{ revoking ? t('apiTokens.revoking') : t('apiTokens.revoke') }}
                </Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>
