<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
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
  RefreshCw,
  MoreHorizontal,
  PencilLine,
  Copy,
  Trash2,
  Archive,
  HardDrive,
  Server,
  Globe,
  Network,
  Cloud,
} from '@lucide/vue'
import { formatDate } from '@/lib/jobUtils'
import { lockExplanation, lockLabel } from '@/lib/destinationLocks'
import SortableTableHead from '@/components/shared/SortableTableHead.vue'
import { useListSort } from '@/composables/useListSort'
import { api, apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import type { Destination, ApiResponse } from '@/types'
import DestinationSheet from '@/components/destinations/DestinationSheet.vue'
import ImportSnapshotsDialog from '@/components/destinations/ImportSnapshotsDialog.vue'

interface DestinationListResponse {
  items: Destination[]
  total: number
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const router = useRouter()
const authStore = useAuthStore()
const { t, te, locale } = useI18n()

const destinations = ref<Destination[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

const page = ref(1)
const pageSize = 50
const offset = computed(() => (page.value - 1) * pageSize)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

// How many destinations on the current page need retention reconfiguration
// after the migration backfill (issue #130). An approximation across large
// installs with more than one page of destinations, but exact for the vast
// majority — good enough for a "go look at this" nudge.
const needsReviewCount = computed(() => destinations.value.filter(d => d.retention_needs_review).length)

// Usage-column sort, applied server-side so ordering is global across pages
// and kept in the URL. Cycles: none → desc → asc → none.
const { sortKey, sortOrder, queryParams: sortParams, toggle: toggleSort } = useListSort()

// Sheet
const sheetOpen = ref(false)
const editingDestination = ref<Destination | null>(null)
// Source destination when duplicating; mutually exclusive with editingDestination.
const cloningDestination = ref<Destination | null>(null)

// Import-snapshots dialog
const importDialogOpen = ref(false)
const destinationToImport = ref<Destination | null>(null)

// Delete dialog
const deleteDialogOpen = ref(false)
const destinationToDelete = ref<Destination | null>(null)
const deleteLoading = ref(false)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeIcon(type: string) {
  switch (type) {
    case 'local': return HardDrive
    case 's3': return Cloud
    case 'sftp': return Server
    case 'rest': return Globe
    case 'rclone': return Network
    default: return HardDrive
  }
}

function typeLabel(type: string): string {
  const key = `destinations.type.${type}`
  return te(key) ? t(key) : type
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// A new sort starts again from the first page.
watch(sortParams, () => {
  page.value = 1
  fetchDestinations()
})

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchDestinations() {
  loading.value = true
  error.value = null
  try {
    const res = await api<ApiResponse<DestinationListResponse>>(`/api/v1/destinations?limit=${pageSize}&offset=${offset.value}${sortParams.value}`)
    destinations.value = res.data.items
    total.value = res.data.total
  } catch (e: any) {
    error.value = apiErrorMessage(e, t('destinations.loadFailed'))
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function openCreate() {
  editingDestination.value = null
  cloningDestination.value = null
  sheetOpen.value = true
}

function openEditSheet(dest: Destination) {
  cloningDestination.value = null
  editingDestination.value = dest
  sheetOpen.value = true
}

function openCloneSheet(dest: Destination) {
  editingDestination.value = null
  cloningDestination.value = dest
  sheetOpen.value = true
}

function onSaved() {
  fetchDestinations()
}

function openImportDialog(dest: Destination) {
  destinationToImport.value = dest
  importDialogOpen.value = true
}

async function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  await fetchDestinations()
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function openDeleteDialog(dest: Destination) {
  destinationToDelete.value = dest
  deleteDialogOpen.value = true
}

async function confirmDelete() {
  if (!destinationToDelete.value) return
  deleteLoading.value = true
  try {
    await api(`/api/v1/destinations/${destinationToDelete.value.id}`, { method: 'DELETE' })
    deleteDialogOpen.value = false
    destinationToDelete.value = null
    if (destinations.value.length === 1 && page.value > 1) {
      page.value--
    }
    await fetchDestinations()
  } catch (e: any) {
    error.value = apiErrorMessage(e, t('destinations.deleteFailed'))
  } finally {
    deleteLoading.value = false
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(fetchDestinations)
</script>

<template>
  <div class="flex flex-col gap-6 p-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('destinations.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('destinations.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="icon" :aria-label="t('common.refresh')" :disabled="loading" @click="fetchDestinations">
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        </Button>
        <Button v-if="authStore.isAdmin" @click="openCreate">
          <Plus class="w-4 h-4" />
          {{ t('destinations.newDestination') }}
        </Button>
      </div>
    </div>

    <!-- Error banner -->
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Post-upgrade retention reconfiguration banner (issue #130) — these
         destinations were shared by multiple policies with different
         retention settings before retention moved here, so it was left
         disabled rather than guessed. -->
    <Alert v-if="needsReviewCount > 0" variant="destructive">
      <AlertDescription>
        {{ t('destinations.needsReviewBanner', needsReviewCount, { named: { n: needsReviewCount } }) }}
      </AlertDescription>
    </Alert>

    <!-- Table -->
    <div class="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('destinations.colName') }}</TableHead>
            <TableHead>{{ t('destinations.colType') }}</TableHead>
            <TableHead>{{ t('destinations.colStatus') }}</TableHead>
            <SortableTableHead :label="t('destinations.colUsage')" :active="sortKey === 'usage'" :order="sortOrder"
              @toggle="toggleSort('usage', 'desc')" />
            <TableHead>{{ t('destinations.colCreated') }}</TableHead>
            <TableHead class="w-13" />
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
          <template v-else-if="destinations.length === 0">
            <TableRow>
              <TableCell colspan="6">
                <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <div class="p-4 rounded-full bg-muted">
                    <HardDrive class="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p class="font-medium">{{ t('destinations.empty') }}</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                      {{ t('destinations.emptyDetail') }}
                    </p>
                  </div>
                  <Button v-if="authStore.isAdmin" size="sm" @click="openCreate">
                    <Plus class="w-4 h-4" />
                    {{ t('destinations.newDestination') }}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </template>

          <!-- Data rows -->
          <template v-else>
            <TableRow v-for="dest in destinations" :key="dest.id"
              class="cursor-pointer hover:bg-muted/50"
              tabindex="0"
              role="link"
              :aria-label="t('destinations.viewDestination', { name: dest.name })"
              @click="router.push(`/destinations/${dest.id}`)"
              @keyup.enter="router.push(`/destinations/${dest.id}`)">
              <TableCell class="font-medium">
                <div class="flex items-center gap-2">
                  {{ dest.name }}
                  <Badge v-if="dest.has_repo_password" variant="outline" class="text-xs font-normal">
                    {{ t('destinations.existingRepo') }}
                  </Badge>
                  <!-- Retention badges (issue #130) — priority: needs review
                       > append-only > no retention configured. -->
                  <Badge v-if="dest.retention_needs_review" variant="destructive" class="text-xs font-normal">
                    {{ t('destinations.retentionNeedsReview') }}
                  </Badge>
                  <Badge v-else-if="dest.append_only" variant="outline" class="text-xs font-normal">
                    {{ t('destinations.appendOnly') }}
                  </Badge>
                  <Badge v-else-if="!dest.retention_enabled" variant="secondary" class="text-xs font-normal">
                    {{ t('destinations.noRetention') }}
                  </Badge>
                  <!-- Most recent integrity check failed (issue #307). -->
                  <Badge v-if="dest.last_check_status === 'failed'" variant="destructive" class="text-xs font-normal">
                    {{ t('destinations.integrityCheckFailed') }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                  <component :is="typeIcon(dest.type)" class="w-4 h-4" />
                  {{ typeLabel(dest.type) }}
                </div>
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-2">
                  <Badge :variant="dest.enabled ? 'default' : 'secondary'">
                    {{ dest.enabled ? t('common.enabled') : t('common.disabled') }}
                  </Badge>
                  <!-- Destination locks: the jobs holding the repository; links
                       to the oldest one (issues #290, #319). -->
                  <RouterLink v-if="dest.locks.length" :to="{ name: 'job-detail', params: { id: dest.locks[0].job_id } }"
                    :title="t('destinations.inUseSince', {
                      since: formatDate(dest.locks[0].since),
                      explanation: lockExplanation(dest.locks),
                    })"
                    @click.stop>
                    <Badge variant="outline" class="text-xs font-normal">{{ lockLabel(dest.locks) }}</Badge>
                  </RouterLink>
                </div>
              </TableCell>
              <TableCell class="text-sm tabular-nums" :class="dest.repo_size_bytes > 0 ? '' : 'text-muted-foreground'">
                {{ formatBytes(dest.repo_size_bytes) }}
              </TableCell>
              <TableCell class="text-sm text-muted-foreground">
                {{ new Date(dest.created_at).toLocaleDateString(locale) }}
              </TableCell>

              <!-- Actions dropdown -->
              <TableCell @click.stop>
                <!-- Every action changes the destination: admins only -->
                <DropdownMenu v-if="authStore.isAdmin">
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="w-8 h-8">
                      <MoreHorizontal class="w-4 h-4" />
                      <span class="sr-only">{{ t('destinations.openActions') }}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="openEditSheet(dest)">
                      <PencilLine class="w-4 h-4 mr-2" />
                      {{ t('common.edit') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="openCloneSheet(dest)">
                      <Copy class="w-4 h-4 mr-2" />
                      {{ t('policies.duplicate') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="openImportDialog(dest)">
                      <Archive class="w-4 h-4 mr-2" />
                      {{ t('destinations.importSnapshots') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator v-if="authStore.isAdmin" />
                    <DropdownMenuItem v-if="authStore.isAdmin" class="text-destructive focus:text-destructive"
                      @click="openDeleteDialog(dest)">
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
        {{ t('destinations.showing', {
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
  <DestinationSheet :destination="editingDestination" :clone-from="cloningDestination" :open="sheetOpen"
    @update:open="sheetOpen = $event" @saved="onSaved" />

  <!-- Import snapshots from an existing repository into this destination -->
  <ImportSnapshotsDialog :destination="destinationToImport" :open="importDialogOpen"
    @update:open="importDialogOpen = $event" @imported="onSaved" />

  <!-- Delete confirmation dialog -->
  <AlertDialog :open="deleteDialogOpen" @update:open="deleteDialogOpen = $event">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('destinations.deleteTitle') }}</AlertDialogTitle>
        <AlertDialogDescription>
          <span v-if="destinationToDelete">
            {{ t('destinations.deleteBody', { name: destinationToDelete.name }) }}
          </span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="deleteLoading">{{ t('common.cancel') }}</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          :disabled="deleteLoading" @click="confirmDelete">
          {{ deleteLoading ? t('destinations.deleting') : t('common.delete') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>