<script setup lang="ts">
import { watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const route = useRoute()
const { t } = useI18n()

// Keep the tab title in sync with both the current route and the UI language.
watchEffect(() => {
  const breadcrumbs = route.matched
    .map((r) => r.meta.breadcrumb as string | undefined)
    .filter(Boolean) as string[]

  document.title = breadcrumbs.length > 0
    ? `Arkeep | ${t(breadcrumbs[breadcrumbs.length - 1])}`
    : 'Arkeep'
})
</script>

<template>
  <RouterView />
</template>
