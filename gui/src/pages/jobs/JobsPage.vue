<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BriefcaseBusiness, RefreshCw } from '@lucide/vue'
import { api, apiErrorMessage } from '@/services/api'
import type { ApiResponse, Job, JobStatus, JobType } from '@/types'
import { statusVariant, statusClass, statusLabel, statusIcon, jobTypeLabel, formatDate, formatDuration } from '@/lib/jobUtils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobListResponse {
    items: Job[]
    total: number
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const jobs = ref<Job[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

const pageSize = 50

// Initialise filters and page from the URL query string so that state is
// preserved when the user navigates back from a job detail page.
const statusFilter = ref<JobStatus | 'all'>((route.query.status as JobStatus | 'all') || 'all')
const typeFilter = ref<JobType | 'all'>((route.query.type as JobType | 'all') || 'all')
const policyIdFilter = ref<string>((route.query.policy_id as string) || '')
const agentIdFilter = ref<string>((route.query.agent_id as string) || '')
const destinationIdFilter = ref<string>((route.query.destination_id as string) || '')
const page = ref(Number(route.query.page) || 1)

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const offset = computed(() => (page.value - 1) * pageSize)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

// ---------------------------------------------------------------------------
// Helpers — imported from @/lib/jobUtils
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// URL sync — keep query string in sync with filter/page state
// ---------------------------------------------------------------------------

function syncUrl() {
    const query: Record<string, string> = {}
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    if (typeFilter.value !== 'all') query.type = typeFilter.value
    if (policyIdFilter.value) query.policy_id = policyIdFilter.value
    if (agentIdFilter.value) query.agent_id = agentIdFilter.value
    if (destinationIdFilter.value) query.destination_id = destinationIdFilter.value
    if (page.value > 1) query.page = String(page.value)
    router.replace({ query })
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchJobs() {
    loading.value = true
    error.value = null
    syncUrl()
    try {
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset.value) })
        if (statusFilter.value !== 'all') params.set('status', statusFilter.value)
        if (typeFilter.value !== 'all') params.set('type', typeFilter.value)
        if (policyIdFilter.value) params.set('policy_id', policyIdFilter.value)
        if (agentIdFilter.value) params.set('agent_id', agentIdFilter.value)
        if (destinationIdFilter.value) params.set('destination_id', destinationIdFilter.value)
        const res = await api<ApiResponse<JobListResponse>>(`/api/v1/jobs?${params}`)
        jobs.value = res.data.items
        total.value = res.data.total
    } catch (e: any) {
        error.value = apiErrorMessage(e, t('jobs.loadFailed'))
    } finally {
        loading.value = false
    }
}

// Re-fetch when filters change; reset to page 1.
watch([statusFilter, typeFilter], () => {
    page.value = 1
    fetchJobs()
})

async function goToPage(p: number) {
    if (p < 1 || p > totalPages.value) return
    page.value = p
    await fetchJobs()
}

onMounted(fetchJobs)
</script>

<template>
    <div class="flex flex-col gap-6 p-6">

        <!-- Page header -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold tracking-tight">{{ t('jobs.title') }}</h1>
                <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('jobs.subtitle') }}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="icon" :aria-label="t('common.refresh')" :disabled="loading" @click="fetchJobs">
                    <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
                </Button>
            </div>
        </div>

        <!-- Error banner -->
        <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Filter bar -->
        <div class="flex items-center gap-3">
            <Select v-model="statusFilter">
                <SelectTrigger class="w-40">
                    <SelectValue :placeholder="t('jobs.allStatuses')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{{ t('jobs.allStatuses') }}</SelectItem>
                    <SelectItem value="pending">{{ t('status.pending') }}</SelectItem>
                    <SelectItem value="waiting">{{ t('status.waiting') }}</SelectItem>
                    <SelectItem value="running">{{ t('status.running') }}</SelectItem>
                    <SelectItem value="succeeded">{{ t('status.succeeded') }}</SelectItem>
                    <SelectItem value="failed">{{ t('status.failed') }}</SelectItem>
                    <SelectItem value="cancelled">{{ t('status.cancelled') }}</SelectItem>
                    <SelectItem value="interrupted">{{ t('status.interrupted') }}</SelectItem>
                </SelectContent>
            </Select>

            <Select v-model="typeFilter">
                <SelectTrigger class="w-40">
                    <SelectValue :placeholder="t('jobs.allTypes')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{{ t('jobs.allTypes') }}</SelectItem>
                    <SelectItem value="backup">{{ t('jobType.backup') }}</SelectItem>
                    <SelectItem value="restore">{{ t('jobType.restore') }}</SelectItem>
                    <SelectItem value="retention">{{ t('jobType.retention') }}</SelectItem>
                    <SelectItem value="check">{{ t('jobType.check') }}</SelectItem>
                </SelectContent>
            </Select>

            <!-- Result count -->
            <span v-if="!loading" class="text-sm text-muted-foreground">
                {{ t('jobs.count', total, { named: { n: total } }) }}
            </span>
        </div>

        <!-- Table -->
        <div class="border rounded-md overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{{ t('jobs.colPolicy') }}</TableHead>
                        <TableHead>{{ t('jobs.colType') }}</TableHead>
                        <TableHead>{{ t('jobs.colAgent') }}</TableHead>
                        <TableHead>{{ t('jobs.colStatus') }}</TableHead>
                        <TableHead>{{ t('jobs.colStarted') }}</TableHead>
                        <TableHead>{{ t('jobs.colDuration') }}</TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    <!-- Loading skeletons -->
                    <template v-if="loading">
                        <TableRow v-for="n in 5" :key="n">
                            <TableCell v-for="col in 6" :key="col">
                                <Skeleton class="w-full h-4" />
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Empty state -->
                    <template v-else-if="jobs.length === 0">
                        <TableRow>
                            <TableCell colspan="6">
                                <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
                                    <div class="p-4 rounded-full bg-muted">
                                        <BriefcaseBusiness class="w-10 h-10 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <p class="font-medium">{{ t('jobs.empty') }}</p>
                                        <p class="mt-1 text-sm text-muted-foreground">
                                            {{ t('jobs.emptyDetail') }}
                                        </p>
                                    </div>
                                </div>
                            </TableCell>
                        </TableRow>
                    </template>

                    <!-- Data rows -->
                    <template v-else>
                        <TableRow v-for="job in jobs" :key="job.id"
                            class="cursor-pointer hover:bg-muted/50"
                            tabindex="0"
                            role="link"
                            :aria-label="t('jobs.viewJob', { name: job.policy_name })"
                            @click="router.push(`/jobs/${job.id}`)"
                            @keyup.enter="router.push(`/jobs/${job.id}`)">
                            <TableCell class="font-medium">{{ job.policy_name }}</TableCell>
                            <TableCell>
                                <Badge variant="outline">{{ jobTypeLabel(job.type) }}</Badge>
                            </TableCell>
                            <TableCell class="text-muted-foreground">{{ job.agent_name }}</TableCell>
                            <TableCell>
                                <Badge :variant="statusVariant(job.status)" class="gap-1" :class="statusClass(job.status)">
                                    <component :is="statusIcon(job.status)" class="w-3 h-3"
                                        :class="{ 'animate-spin': job.status === 'running' }" />
                                    {{ statusLabel(job.status) }}
                                </Badge>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ formatDate(job.started_at) }}
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground font-mono">
                                {{ formatDuration(job.started_at, job.ended_at) }}
                            </TableCell>
                        </TableRow>
                    </template>
                </TableBody>
            </Table>
        </div>

        <!-- Pagination -->
        <div v-if="!loading && totalPages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
            <span>
                {{ t('jobs.showing', {
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
</template>