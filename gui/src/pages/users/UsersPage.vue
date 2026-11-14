<script setup lang="ts">
import { ref, computed, onMounted, useTemplateRef, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { KeyRound, MoreHorizontal, PencilLine, Plus, RefreshCw, ShieldOff, Trash2, Users } from '@lucide/vue'
import UserSheet from '@/components/users/UserSheet.vue'
import SetPasswordDialog from '@/components/users/SetPasswordDialog.vue'
import { api, apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import type { ApiResponse, User } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserListResponse { items: User[]; total: number }

// ---------------------------------------------------------------------------
// State — list
// ---------------------------------------------------------------------------

const users = ref<User[]>([])
const { t, locale } = useI18n()
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

const page = ref(1)
const pageSize = 50
const offset = computed(() => (page.value - 1) * pageSize)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

// ---------------------------------------------------------------------------
// State — sheet
// ---------------------------------------------------------------------------

const sheetOpen = ref(false)
const sheetUser = ref<User | null>(null)
const sheetRef = useTemplateRef<InstanceType<typeof UserSheet>>('sheetRef')

// ---------------------------------------------------------------------------
// State — delete
// ---------------------------------------------------------------------------

const deleteDialogOpen = ref(false)
const userToDelete = ref<User | null>(null)
const deleteLoading = ref(false)

// ---------------------------------------------------------------------------
// State — 2FA reset
// ---------------------------------------------------------------------------

const resetDialogOpen = ref(false)
const userToReset = ref<User | null>(null)
const resetLoading = ref(false)

// ---------------------------------------------------------------------------
// State — set password
// ---------------------------------------------------------------------------

const auth = useAuthStore()
const setPasswordOpen = ref(false)
const userToSetPassword = ref<User | null>(null)

// The identity provider owns an OIDC user's password, and your own password is
// changed from Profile, where the current one is asked for.
function canSetPassword(u: User): boolean {
    return !u.is_oidc && u.id !== auth.user?.id
}

function openSetPassword(u: User) {
    userToSetPassword.value = u
    setPasswordOpen.value = true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string): string {
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function roleVariant(role: string): 'default' | 'secondary' {
    return role === 'admin' ? 'default' : 'secondary'
}

function roleLabel(role: string): string {
    return role === 'admin' ? t('users.roles.admin') : t('users.roles.user')
}

function formatDate(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchUsers() {
    loading.value = true
    error.value = null
    try {
        const res = await api<ApiResponse<UserListResponse>>(`/api/v1/users?limit=${pageSize}&offset=${offset.value}`)
        users.value = res.data.items
        total.value = res.data.total
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('users.loadFailed'))
    } finally {
        loading.value = false
    }
}

async function goToPage(p: number) {
    if (p < 1 || p > totalPages.value) return
    page.value = p
    await fetchUsers()
}

onMounted(fetchUsers)

// ---------------------------------------------------------------------------
// Sheet open helpers
// ---------------------------------------------------------------------------

function openCreate() {
    sheetUser.value = null
    sheetOpen.value = true
    nextTick(() => sheetRef.value?.reset())
}

function openEdit(u: User) {
    sheetUser.value = u
    sheetOpen.value = true
    nextTick(() => sheetRef.value?.reset())
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function openDeleteDialog(u: User) {
    userToDelete.value = u
    deleteDialogOpen.value = true
}

async function confirmDelete() {
    if (!userToDelete.value) return
    deleteLoading.value = true
    try {
        await api(`/api/v1/users/${userToDelete.value.id}`, { method: 'DELETE' })
        deleteDialogOpen.value = false
        userToDelete.value = null
        if (users.value.length === 1 && page.value > 1) {
            page.value--
        }
        await fetchUsers()
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('users.deleteFailed'))
    } finally {
        deleteLoading.value = false
    }
}

// ---------------------------------------------------------------------------
// 2FA reset
// ---------------------------------------------------------------------------

function openResetDialog(u: User) {
    userToReset.value = u
    resetDialogOpen.value = true
}

async function confirmReset() {
    if (!userToReset.value) return
    resetLoading.value = true
    try {
        await api(`/api/v1/users/${userToReset.value.id}/2fa/reset`, { method: 'POST' })
        resetDialogOpen.value = false
        userToReset.value = null
        await fetchUsers()
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('users.resetFailed'))
    } finally {
        resetLoading.value = false
    }
}
</script>

<template>
    <div class="flex flex-col gap-6 p-6">

        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold tracking-tight">{{ t('users.title') }}</h1>
                <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('users.subtitle') }}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="icon" :aria-label="t('common.refresh')" :disabled="loading" @click="fetchUsers">
                    <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
                </Button>
                <Button @click="openCreate">
                    <Plus class="w-4 h-4" />
                    {{ t('users.newUser') }}
                </Button>
            </div>
        </div>

        <!-- Error banner -->
        <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Table -->
        <div class="border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{{ t('users.colUser') }}</TableHead>
                        <TableHead>{{ t('users.colRole') }}</TableHead>
                        <TableHead>{{ t('users.colStatus') }}</TableHead>
                        <TableHead>{{ t('users.colLastLogin') }}</TableHead>
                        <TableHead class="w-13" />
                    </TableRow>
                </TableHeader>
                <TableBody>

                    <!-- Loading -->
                    <template v-if="loading">
                        <TableRow v-for="n in 5" :key="n">
                            <TableCell v-for="col in 5" :key="col">
                                <Skeleton class="w-full h-4" />
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Empty -->
                    <template v-else-if="users.length === 0">
                        <TableRow>
                            <TableCell colspan="5">
                                <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
                                    <div class="p-4 rounded-full bg-muted">
                                        <Users class="w-8 h-8 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <p class="font-medium">{{ t('users.empty') }}</p>
                                        <p class="mt-1 text-sm text-muted-foreground">
                                            {{ t('users.emptyDetail') }}
                                        </p>
                                    </div>
                                </div>
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Rows -->
                    <template v-else>
                        <TableRow v-for="u in users" :key="u.id">
                            <TableCell>
                                <div class="flex items-center gap-3">
                                    <Avatar class="w-8 h-8 rounded-lg shrink-0">
                                        <AvatarFallback class="rounded-lg text-xs">
                                            {{ initials(u.display_name) }}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p class="text-sm font-medium leading-none">{{ u.display_name }}</p>
                                        <p class="text-xs text-muted-foreground mt-0.5">{{ u.email }}</p>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <div class="flex items-center gap-1.5">
                                    <Badge :variant="roleVariant(u.role)">{{ roleLabel(u.role) }}</Badge>
                                    <Badge v-if="u.two_factor_enabled" variant="outline">2FA</Badge>
                                    <Badge v-if="u.must_change_password" variant="outline">{{ t('users.passwordPending') }}</Badge>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge :variant="u.is_active ? 'default' : 'secondary'">
                                    {{ u.is_active ? t('users.active') : t('users.inactive') }}
                                </Badge>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ formatDate(u.last_login_at) }}
                            </TableCell>
                            <TableCell @click.stop>
                                <DropdownMenu>
                                    <DropdownMenuTrigger as-child>
                                        <Button variant="ghost" size="icon" class="w-8 h-8">
                                            <MoreHorizontal class="w-4 h-4" />
                                            <span class="sr-only">{{ t('users.openActions') }}</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem @click="openEdit(u)">
                                            <PencilLine class="w-4 h-4 mr-2" />
                                            {{ t('common.edit') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem v-if="canSetPassword(u)" @click="openSetPassword(u)">
                                            <KeyRound class="w-4 h-4 mr-2" />
                                            {{ t('users.setPassword') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem v-if="u.two_factor_enabled" @click="openResetDialog(u)">
                                            <ShieldOff class="w-4 h-4 mr-2" />
                                            {{ t('users.reset2fa') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem class="text-destructive focus:text-destructive"
                                            @click="openDeleteDialog(u)">
                                            <Trash2 class="w-4 h-4 mr-2" />
                                            {{ t('common.delete') }}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    </template>

                </TableBody>
            </Table>
        </div>

        <!-- Pagination -->
        <div v-if="!loading && totalPages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
            <span>
                {{ t('users.showing', {
                    from: offset + 1,
                    to: Math.min(offset + pageSize, total),
                    total,
                }) }}
            </span>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" :disabled="page === 1" @click="goToPage(page - 1)">
                    {{ t('agents.previous') }}
                </Button>
                <span class="px-2">{{ page }} / {{ totalPages }}</span>
                <Button variant="outline" size="sm" :disabled="page === totalPages" @click="goToPage(page + 1)">
                    {{ t('agents.next') }}
                </Button>
            </div>
        </div>

    </div>

    <!-- User sheet -->
    <UserSheet ref="sheetRef" :open="sheetOpen" :user="sheetUser" @update:open="sheetOpen = $event"
        @saved="fetchUsers" />

    <!-- Set password dialog -->
    <SetPasswordDialog :open="setPasswordOpen" :user="userToSetPassword" @update:open="setPasswordOpen = $event"
        @saved="fetchUsers" />

    <!-- Delete dialog -->
    <AlertDialog :open="deleteDialogOpen" @update:open="deleteDialogOpen = $event">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{{ t('users.deleteTitle') }}</AlertDialogTitle>
                <AlertDialogDescription>
                    <span v-if="userToDelete">
                        {{ t('users.deleteBody', { name: userToDelete.display_name, email: userToDelete.email }) }}
                    </span>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="deleteLoading">{{ t('common.cancel') }}</AlertDialogCancel>
                <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    :disabled="deleteLoading" @click="confirmDelete">
                    {{ deleteLoading ? t('users.deleting') : t('common.delete') }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    <!-- Reset 2FA dialog -->
    <AlertDialog :open="resetDialogOpen" @update:open="resetDialogOpen = $event">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{{ t('users.resetTitle') }}</AlertDialogTitle>
                <AlertDialogDescription>
                    <span v-if="userToReset">
                        {{ t('users.resetBody', { name: userToReset.display_name, email: userToReset.email }) }}
                    </span>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="resetLoading">{{ t('common.cancel') }}</AlertDialogCancel>
                <AlertDialogAction :disabled="resetLoading" @click="confirmReset">
                    {{ resetLoading ? t('users.resetting') : t('users.resetConfirm') }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>