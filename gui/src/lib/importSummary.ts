import type { ImportDestinationResponse } from '@/types'
import { i18n } from '@/i18n'

interface ImportSummary {
  // tone drives the icon: an error for snapshots that could not be recorded,
  // neutral for an empty repository, success otherwise.
  tone: 'success' | 'neutral' | 'error'
  headline: string
  detail: string
}

// summariseImport turns an import result into the text shown to the user.
// It is deliberately explicit about every case so the UI never claims snapshots
// were imported when none were: an empty repository, snapshots already known,
// and a failed insert all read differently.
export function summariseImport(r: ImportDestinationResponse): ImportSummary {
  const { t } = i18n.global

  if (r.failed > 0) {
    return {
      tone: 'error',
      headline: t('importSnapshots.failedHeadline', r.failed, { named: { n: r.failed } }),
      detail: t('importSnapshots.failedDetail', {
        found: r.found,
        imported: r.imported,
        failed: r.failed,
      }),
    }
  }
  if (r.found === 0) {
    return {
      tone: 'neutral',
      headline: t('importSnapshots.emptyHeadline'),
      detail: t('importSnapshots.emptyDetail'),
    }
  }
  if (r.imported === 0) {
    return {
      tone: 'success',
      headline: t('importSnapshots.upToDateHeadline'),
      detail: t('importSnapshots.upToDateDetail', r.found, { named: { found: r.found } }),
    }
  }
  return {
    tone: 'success',
    headline: t('importSnapshots.importedHeadline', r.imported, { named: { n: r.imported } }),
    detail:
      r.skipped > 0
        ? t('importSnapshots.importedDetail', {
            found: r.found,
            imported: r.imported,
            skipped: r.skipped,
          })
        : t('importSnapshots.importedDetailNoSkipped', {
            found: r.found,
            imported: r.imported,
          }),
  }
}
