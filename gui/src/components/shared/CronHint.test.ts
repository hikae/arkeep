import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import CronHint from './CronHint.vue'

describe('CronHint', () => {
  it('describes a valid expression', () => {
    const w = mount(CronHint, { props: { expression: '0 2 * * 0' }, global: { plugins: [i18n] } })
    expect(w.get('[data-testid="cron-hint"]').text()).toBe('At 02:00, only on Sunday')
  })

  it('flags an expression the server would reject', () => {
    const w = mount(CronHint, { props: { expression: '0 2 *' }, global: { plugins: [i18n] } })
    const hint = w.get('[data-testid="cron-hint"]')
    expect(hint.text()).toBe('Not a valid cron expression')
    expect(hint.classes()).toContain('text-destructive')
  })

  it('renders nothing for an empty field', () => {
    const w = mount(CronHint, { props: { expression: '' }, global: { plugins: [i18n] } })
    expect(w.find('[data-testid="cron-hint"]').exists()).toBe(false)
  })
})
