import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { liveUpdatesUnavailable } from '@/services/websocket'
import { i18n } from '@/i18n'
import RefreshButton from './RefreshButton.vue'

describe('RefreshButton', () => {
  afterEach(() => {
    liveUpdatesUnavailable.value = false
  })

  it('refreshes the page with its loading state', async () => {
    const refresh = vi.fn()
    const wrapper = mount(RefreshButton, { props: { refresh }, global: { plugins: [i18n] } })
    await wrapper.get('button[aria-label="Refresh"]').trigger('click')
    expect(refresh).toHaveBeenCalledWith({})
  })

  it('is disabled while the page loads', () => {
    const wrapper = mount(RefreshButton, { props: { refresh: vi.fn(), loading: true }, global: { plugins: [i18n] } })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('warns that live updates are unavailable on a live page only', async () => {
    liveUpdatesUnavailable.value = true
    const live = mount(RefreshButton, { props: { refresh: vi.fn(), live: true }, global: { plugins: [i18n] } })
    const plain = mount(RefreshButton, { props: { refresh: vi.fn() }, global: { plugins: [i18n] } })
    expect(live.find('[data-test="live-updates-unavailable"]').exists()).toBe(true)
    expect(plain.find('[data-test="live-updates-unavailable"]').exists()).toBe(false)

    liveUpdatesUnavailable.value = false
    await live.vm.$nextTick()
    expect(live.find('[data-test="live-updates-unavailable"]').exists()).toBe(false)
  })
})
