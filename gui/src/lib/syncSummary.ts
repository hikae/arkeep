import type { SyncDestinationResponse } from '@/types'
import { i18n } from '@/i18n'

// summariseSync turns one or more snapshot sync results into the line shown to
// the user, so a sync that changed nothing reads differently from one that
// removed or added snapshots, and failures are never hidden.
export function summariseSync(results: SyncDestinationResponse[]): string {
  const total = results.reduce(
    (acc, r) => ({
      found: acc.found + r.found,
      imported: acc.imported + r.imported,
      removed: acc.removed + r.removed,
      failed: acc.failed + r.failed,
    }),
    { found: 0, imported: 0, removed: 0, failed: 0 },
  )

  const { t } = i18n.global
  const changes: string[] = []
  if (total.removed > 0) changes.push(t('syncSummary.removed', total.removed, { named: { n: total.removed } }))
  if (total.imported > 0) changes.push(t('syncSummary.added', total.imported, { named: { n: total.imported } }))
  if (total.failed > 0) changes.push(t('syncSummary.failed', total.failed, { named: { n: total.failed } }))

  const found = t(
    results.length === 1 ? 'syncSummary.foundInRepository' : 'syncSummary.foundInRepositories',
    total.found,
    { named: { n: total.found } },
  )
  return changes.length > 0
    ? t('syncSummary.complete', { changes: changes.join(t('common.listSeparator')), found })
    : t('syncSummary.upToDate', { found })
}
