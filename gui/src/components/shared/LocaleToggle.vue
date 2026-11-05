<script setup lang="ts">
// LocaleToggle — language picker for the public pages (login, setup, errors).
// Signed-in users get the same choices from the user menu in NavUser.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  setLocale,
  type AppLocale,
} from '@/i18n'

const { t, locale } = useI18n()

const current = computed(() => locale.value as AppLocale)

function choose(value: unknown): void {
  setLocale(value as AppLocale)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="gap-1.5 text-muted-foreground hover:text-foreground"
        :aria-label="t('locale.switch')">
        <Globe class="size-4" />
        <span class="text-xs font-medium">{{ LOCALE_LABELS[current] }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-36">
      <DropdownMenuRadioGroup :model-value="current" @update:model-value="choose">
        <DropdownMenuRadioItem v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">
          {{ LOCALE_LABELS[code] }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
