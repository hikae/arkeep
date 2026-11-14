import { i18n } from '@/i18n'

// Human-readable labels for common cron expressions. Custom schedules fall
// back to the raw expression.
export function scheduleLabel(cron: string): string {
  const { t } = i18n.global
  if (!cron) return t('policies.schedule.notScheduled')
  switch (cron) {
    case '0 * * * *': return t('policies.schedule.hourly')
    case '0 2 * * *': return t('policies.schedule.dailyAt', { time: '02:00' })
    case '0 3 * * *': return t('policies.schedule.dailyAt', { time: '03:00' })
    case '0 0 * * *': return t('policies.schedule.dailyAtMidnight')
    case '0 2 * * 0': return t('policies.schedule.weeklySun')
    case '0 2 * * 1': return t('policies.schedule.weeklyMon')
    case '0 3 * * 0': return t('policies.schedule.weeklySunAt', { time: '03:00' })
    case '0 2 1 * *': return t('policies.schedule.monthly')
    case '0 3 1 * *': return t('policies.schedule.monthlyAt', { time: '03:00' })
    case '@daily': return t('policies.schedule.daily')
    case '@weekly': return t('policies.schedule.weekly')
    case '@monthly': return t('policies.schedule.monthly')
    case '@hourly': return t('policies.schedule.hourly')
    default: return cron
  }
}
