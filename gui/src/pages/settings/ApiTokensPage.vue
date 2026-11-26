<script setup lang="ts">
// ApiTokensPage.vue — Every user's API tokens, for admins (ADR 0027). Users
// create and revoke their own tokens on their profile; an admin can revoke any
// of them here, for instance when a program's host is compromised.
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import ApiTokenRevokeDialog from '@/components/users/ApiTokenRevokeDialog.vue'
import { AlertCircle, KeyRound } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import { formatDate } from '@/lib/jobUtils'
import type { ApiResponse, ApiToken } from '@/types'

const { t } = useI18n()

const tokens = ref<ApiToken[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const revoking = ref<ApiToken | null>(null)

async function fetchTokens(): Promise<void> {
    loading.value = true
    loadError.value = null
    try {
        const res = await api<ApiResponse<ApiToken[]>>('/api/v1/api-tokens')
        tokens.value = res.data
    } catch (e: any) {
        loadError.value = apiErrorMessage(e, t('apiTokens.loadFailed'))
    } finally {
        loading.value = false
    }
}

onMounted(fetchTokens)

async function onRevoked(): Promise<void> {
    revoking.value = null
    await fetchTokens()
}

function isExpired(t: ApiToken): boolean {
    return t.expires_at !== null && new Date(t.expires_at).getTime() <= Date.now()
}
</script>

<template>
    <div class="flex flex-col gap-6">
        <div>
            <h2 class="text-lg font-semibold">{{ t('apiTokens.title') }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
                {{ t('apiTokens.page.description') }}
            </p>
        </div>

        <Alert v-if="loadError" variant="destructive">
            <AlertCircle class="size-4" />
            <AlertDescription>{{ loadError }}</AlertDescription>
        </Alert>

        <!-- w-0 min-w-full: the table scrolls inside the page instead of widening it. -->
        <div class="w-0 min-w-full border rounded-md overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{{ t('apiTokens.page.colUser') }}</TableHead>
                        <TableHead>{{ t('common.name') }}</TableHead>
                        <TableHead>{{ t('apiTokens.page.colToken') }}</TableHead>
                        <TableHead>{{ t('apiTokens.colCreated') }}</TableHead>
                        <TableHead>{{ t('apiTokens.colLastUsed') }}</TableHead>
                        <TableHead>{{ t('apiTokens.colExpires') }}</TableHead>
                        <TableHead class="w-24"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <template v-if="loading">
                        <TableRow v-for="n in 3" :key="n">
                            <TableCell v-for="col in 7" :key="col">
                                <Skeleton class="w-full h-4" />
                            </TableCell>
                        </TableRow>
                    </template>
                    <TableRow v-else-if="tokens.length === 0">
                        <TableCell colspan="7">
                            <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
                                <div class="p-4 rounded-full bg-muted">
                                    <KeyRound class="w-8 h-8 text-muted-foreground" />
                                </div>
                                <p class="text-sm text-muted-foreground">{{ t('apiTokens.page.empty') }}</p>
                            </div>
                        </TableCell>
                    </TableRow>
                    <template v-else>
                        <TableRow v-for="token in tokens" :key="token.id">
                            <TableCell class="text-sm">{{ token.user_email }}</TableCell>
                            <TableCell class="text-sm font-medium">{{ token.name }}</TableCell>
                            <TableCell><code class="text-xs">{{ token.hint }}…</code></TableCell>
                            <TableCell class="text-sm text-muted-foreground whitespace-nowrap">{{ formatDate(token.created_at) }}</TableCell>
                            <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
                                {{ token.last_used_at ? formatDate(token.last_used_at) : t('apiTokens.never') }}
                            </TableCell>
                            <TableCell class="text-sm whitespace-nowrap"
                                :class="isExpired(token) ? 'text-destructive' : 'text-muted-foreground'">
                                {{ token.expires_at ? (isExpired(token) ? t('apiTokens.expiredPrefix') : '') + formatDate(token.expires_at) : t('apiTokens.never') }}
                            </TableCell>
                            <TableCell class="text-right">
                                <Button variant="outline" size="sm" @click="revoking = token">{{ t('apiTokens.revoke') }}</Button>
                            </TableCell>
                        </TableRow>
                    </template>
                </TableBody>
            </Table>
        </div>
    </div>

    <ApiTokenRevokeDialog :token="revoking" endpoint="/api/v1/api-tokens"
        @cancel="revoking = null" @revoked="onRevoked" />
</template>
