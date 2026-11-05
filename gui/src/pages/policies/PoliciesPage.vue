<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog,
    AlertDialogAction,
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
import { Skeleton } from '@/components/ui/skeleton'
import {
    Plus,
    MoreHorizontal,
    PencilLine,
    Copy,
    Trash2,
    Play,
    ShieldCheck,
    RefreshCw,
} from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, apiErrorMessage } from '@/services/api'
import { scheduleLabel } from '@/lib/schedule'
import type { Policy, ApiResponse, TriggerResponse } from '@/types'
import PolicySheet from '@/components/policies/PolicySheet.vue'
import SortableTableHead from '@/components/shared/SortableTableHead.vue'
import { useListSort } from '@/composables/useListSort'

interface PolicyListResponse {
    items: Policy[]
    total: number
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()

const policies = ref<Policy[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

const page = ref(1)
const pageSize = 50
const offset = computed(() => (page.value - 1) * pageSize)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

// Server-side column sort, kept in the URL; by name when unset (issue #320).
const { sortKey, sortOrder, queryParams: sortParams, toggle: toggleSort } = useListSort({ key: 'name' })

// Sheet
const sheetOpen = ref(false)
const editingPolicy = ref<Policy | null>(null)
// Source policy when duplicating; mutually exclusive with editingPolicy.
const cloningPolicy = ref<Policy | null>(null)

// Delete dialog
const deleteDialogOpen = ref(false)
const policyToDelete = ref<Policy | null>(null)
const deleteLoading = ref(false)

// Trigger
const triggeringId = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchPolicies() {
    loading.value = true
    error.value = null
    try {
        const res = await api<ApiResponse<PolicyListResponse>>(`/api/v1/policies?limit=${pageSize}&offset=${offset.value}${sortParams.value}`)
        policies.value = res.data.items
        total.value = res.data.total
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('policies.loadFailed'))
    } finally {
        loading.value = false
    }
}

// A new sort starts again from the first page.
watch(sortParams, () => {
    page.value = 1
    fetchPolicies()
})

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function openCreate() {
    editingPolicy.value = null
    cloningPolicy.value = null
    sheetOpen.value = true
}

function openEditSheet(policy: Policy) {
    cloningPolicy.value = null
    editingPolicy.value = policy
    sheetOpen.value = true
}

function openCloneSheet(policy: Policy) {
    editingPolicy.value = null
    cloningPolicy.value = policy
    sheetOpen.value = true
}

function onSaved() {
    fetchPolicies()
}

async function goToPage(p: number) {
    if (p < 1 || p > totalPages.value) return
    page.value = p
    await fetchPolicies()
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

async function triggerPolicy(policy: Policy) {
    triggeringId.value = policy.id
    try {
        const res = await api<ApiResponse<TriggerResponse>>(`/api/v1/policies/${policy.id}/trigger`, { method: 'POST' })
        router.push({ name: 'job-detail', params: { id: res.data.job_id } })
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('policies.triggerFailed', { name: policy.name }))
    } finally {
        triggeringId.value = null
    }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function openDeleteDialog(policy: Policy) {
    policyToDelete.value = policy
    deleteDialogOpen.value = true
}

async function confirmDelete() {
    if (!policyToDelete.value) return
    deleteLoading.value = true
    try {
        await api(`/api/v1/policies/${policyToDelete.value.id}`, { method: 'DELETE' })
        deleteDialogOpen.value = false
        policyToDelete.value = null
        if (policies.value.length === 1 && page.value > 1) {
            page.value--
        }
        await fetchPolicies()
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('policies.deleteFailed'))
    } finally {
        deleteLoading.value = false
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(fetchPolicies)
</script>

<template>
    <div class="flex flex-col gap-6 p-6">

        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold tracking-tight">{{ t('policies.title') }}</h1>
                <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('policies.subtitle') }}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="icon" :aria-label="t('common.refresh')" :disabled="loading" @click="fetchPolicies">
                    <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
                </Button>
                <Button v-if="authStore.isAdmin" @click="openCreate">
                    <Plus class="w-4 h-4" />
                    {{ t('policies.newPolicy') }}
                </Button>
            </div>
        </div>

        <!-- Error banner -->
        <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Table -->
        <div class="border rounded-md overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <SortableTableHead :label="t('policies.colName')" :active="sortKey === 'name'" :order="sortOrder"
                            @toggle="toggleSort('name')" />
                        <SortableTableHead :label="t('policies.colAgent')" :active="sortKey === 'agent'" :order="sortOrder"
                            @toggle="toggleSort('agent')" />
                        <TableHead>{{ t('policies.colSchedule') }}</TableHead>
                        <SortableTableHead :label="t('policies.colStatus')" :active="sortKey === 'status'" :order="sortOrder"
                            @toggle="toggleSort('status', 'desc')" />
                        <TableHead class="w-13" />
                    </TableRow>
                </TableHeader>

                <TableBody>
                    <!-- Loading skeletons -->
                    <template v-if="loading">
                        <TableRow v-for="n in 5" :key="n">
                            <TableCell v-for="col in 5" :key="col">
                                <Skeleton class="w-full h-4" />
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Empty state -->
                    <template v-else-if="policies.length === 0">
                        <TableRow>
                            <TableCell colspan="5">
                                <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
                                    <div class="p-4 rounded-full bg-muted">
                                        <ShieldCheck class="w-10 h-10 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <p class="font-medium">{{ t('policies.empty') }}</p>
                                        <p class="mt-1 text-sm text-muted-foreground">
                                            {{ t('policies.emptyDetail') }}
                                        </p>
                                    </div>
                                    <Button v-if="authStore.isAdmin" size="sm" @click="openCreate">
                                        <Plus class="w-4 h-4" />
                                        {{ t('policies.newPolicy') }}
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Data rows -->
                    <template v-else>
                        <TableRow v-for="policy in policies" :key="policy.id"
                            class="cursor-pointer hover:bg-muted/50"
                            tabindex="0"
                            role="link"
                            :aria-label="t('policies.viewPolicy', { name: policy.name })"
                            @click="router.push(`/policies/${policy.id}`)"
                            @keyup.enter="router.push(`/policies/${policy.id}`)">
                            <TableCell class="font-medium">{{ policy.name }}</TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ policy.agent_name }}
                            </TableCell>
                            <TableCell>
                                <span class="font-mono text-xs text-muted-foreground">
                                    {{ scheduleLabel(policy.schedule) }}
                                </span>
                            </TableCell>
                            <TableCell>
                                <Badge :variant="policy.enabled ? 'default' : 'secondary'">
                                    {{ policy.enabled ? t('common.enabled') : t('common.disabled') }}
                                </Badge>
                            </TableCell>

                            <!-- Actions dropdown -->
                            <TableCell @click.stop>
                                <!-- Every action changes or runs the policy: admins only -->
                                <DropdownMenu v-if="authStore.isAdmin">
                                    <DropdownMenuTrigger as-child>
                                        <Button variant="ghost" size="icon" class="w-8 h-8">
                                            <MoreHorizontal class="w-4 h-4" />
                                            <span class="sr-only">{{ t('policies.openActions') }}</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <!-- The wrapper receives hover while the disabled item has pointer-events: none -->
                                        <Tooltip v-if="authStore.isAdmin" :disabled="policy.enabled">
                                            <TooltipTrigger as-child>
                                                <div>
                                                    <DropdownMenuItem
                                                        :disabled="!policy.enabled || triggeringId === policy.id"
                                                        @click="triggerPolicy(policy)">
                                                        <Play class="w-4 h-4 mr-2" />
                                                        {{ t('policies.runNow') }}
                                                    </DropdownMenuItem>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="left">{{ t('policies.enableToRun') }}</TooltipContent>
                                        </Tooltip>
                                        <DropdownMenuSeparator v-if="authStore.isAdmin" />
                                        <DropdownMenuItem @click="openEditSheet(policy)">
                                            <PencilLine class="w-4 h-4 mr-2" />
                                            {{ t('common.edit') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem @click="openCloneSheet(policy)">
                                            <Copy class="w-4 h-4 mr-2" />
                                            {{ t('policies.duplicate') }}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator v-if="authStore.isAdmin" />
                                        <DropdownMenuItem v-if="authStore.isAdmin"
                                            class="text-destructive focus:text-destructive"
                                            @click="openDeleteDialog(policy)">
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
                {{ t('policies.showing', {
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

    <!-- Edit / create sheet -->
    <PolicySheet :policy="editingPolicy" :clone-from="cloningPolicy" :open="sheetOpen" @update:open="sheetOpen = $event" @saved="onSaved" />

    <!-- Delete confirmation dialog -->
    <AlertDialog :open="deleteDialogOpen" @update:open="deleteDialogOpen = $event">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{{ t('policies.deleteTitle') }}</AlertDialogTitle>
                <AlertDialogDescription>
                    <span v-if="policyToDelete">
                        {{ t('policies.deleteBody', { name: policyToDelete.name }) }}
                    </span>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="deleteLoading">{{ t('common.cancel') }}</AlertDialogCancel>
                <AlertDialogAction variant="destructive"
                    :disabled="deleteLoading" @click="confirmDelete">
                    {{ deleteLoading ? t('policies.deleting') : t('common.delete') }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>