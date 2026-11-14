<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { formatBytes, formatDate, formatDuration } from '@/lib/jobUtils'
import type { Snapshot } from '@/types'

// ---------------------------------------------------------------------------
// Props & emits
// ---------------------------------------------------------------------------

const props = defineProps<{
    open: boolean
    snapshot: Snapshot | null
}>()

const { t } = useI18n()

const emit = defineEmits<{
    'update:open': [value: boolean]
}>()

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface Row {
    label: string
    value: string
    mono?: boolean
}

interface Section {
    title: string
    rows: Row[]
}

function count(n: number): string {
    return n.toLocaleString()
}

// sections lists what is known about the snapshot. The backup and file
// figures come from the restic summary, so they are left out when it is
// unknown; what the snapshot added after compression is always recorded.
const sections = computed<Section[]>(() => {
    const s = props.snapshot
    if (!s) return []
    const sum = s.summary
    const out: Section[] = [{
        title: t('snapshotDetails.sections.snapshot'),
        rows: [
            { label: t('snapshotDetails.rows.snapshotId'), value: s.restic_snapshot_id, mono: true },
            { label: t('snapshotDetails.rows.policy'), value: s.policy_name || '—' },
            { label: t('snapshotDetails.rows.destination'), value: s.destination_name || '—' },
            { label: t('snapshotDetails.rows.created'), value: formatDate(s.created_at) },
        ],
    }]
    if (sum) {
        out.push({
            title: t('snapshotDetails.sections.backup'),
            rows: [
                { label: t('snapshotDetails.rows.started'), value: formatDate(sum.backup_start) },
                { label: t('snapshotDetails.rows.duration'), value: formatDuration(sum.backup_start, sum.backup_end) },
            ],
        })
    }
    out.push({
        title: t('snapshotDetails.sections.data'),
        rows: [
            ...(sum ? [
                { label: t('snapshotDetails.rows.processed'), value: formatBytes(sum.total_bytes_processed) },
                { label: t('snapshotDetails.rows.added'), value: formatBytes(sum.data_added) },
            ] : []),
            { label: t('snapshotDetails.rows.stored'), value: formatBytes(s.size_bytes) },
        ],
    })
    if (sum) {
        out.push({
            title: t('snapshotDetails.sections.files'),
            rows: [
                { label: t('snapshotDetails.rows.processed'), value: count(sum.total_files_processed) },
                { label: t('snapshotDetails.rows.new'), value: count(sum.files_new) },
                { label: t('snapshotDetails.rows.changed'), value: count(sum.files_changed) },
                { label: t('snapshotDetails.rows.unmodified'), value: count(sum.files_unmodified) },
            ],
        })
    }
    return out
})
</script>

<template>
    <Sheet :open="props.open" @update:open="emit('update:open', $event)">
        <SheetContent class="sm:max-w-md flex flex-col">
            <SheetHeader>
                <SheetTitle>{{ t('snapshotDetails.title') }}</SheetTitle>
                <SheetDescription>
                    <span class="font-mono">{{ snapshot?.restic_snapshot_id?.slice(0, 8) }}</span>
                    {{ t('snapshotDetails.subtitleSuffix') }}
                </SheetDescription>
            </SheetHeader>

            <div class="flex flex-col gap-6 px-4 pb-6 flex-1 overflow-y-auto">
                <p v-if="snapshot && !snapshot.summary" data-testid="no-summary"
                    class="text-sm text-muted-foreground">
                    {{ t('snapshotDetails.noSummary') }}
                </p>

                <section v-for="section in sections" :key="section.title">
                    <h3 class="mb-2 text-sm font-medium">{{ section.title }}</h3>
                    <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                        <template v-for="row in section.rows" :key="row.label">
                            <dt class="text-muted-foreground">{{ row.label }}</dt>
                            <dd class="text-right" :class="row.mono ? 'font-mono text-xs break-all' : ''">
                                {{ row.value }}
                            </dd>
                        </template>
                    </dl>
                </section>
            </div>
        </SheetContent>
    </Sheet>
</template>
