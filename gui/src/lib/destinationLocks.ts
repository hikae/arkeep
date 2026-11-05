import type { DestinationLock } from '@/types'
import { i18n } from '@/i18n'

// A destination is held exclusively by a retention sweep or integrity check,
// or shared by any number of backups (issue #319).
function isExclusive(locks: DestinationLock[]): boolean {
  return locks.some((l) => l.mode === 'exclusive')
}

// lockLabel is the badge text for a destination's locks.
export function lockLabel(locks: DestinationLock[]): string {
  const { t } = i18n.global
  if (isExclusive(locks)) return t('destinationLocks.busy')
  return t('destinationLocks.backupsRunning', locks.length, { named: { n: locks.length } })
}

// lockExplanation says what the locks mean for other jobs on the destination.
export function lockExplanation(locks: DestinationLock[]): string {
  const { t } = i18n.global
  return isExclusive(locks)
    ? t('destinationLocks.exclusiveExplanation')
    : t('destinationLocks.sharedExplanation')
}
