<script setup lang="ts">
import { CircleArrowUp, ExternalLink } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';

defineProps<{
    show: boolean
    version: string | null
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}>()

const { t } = useI18n()
</script>

<template>
    <HoverCard v-if="show" :open-delay="100">
        <HoverCardTrigger as-child>
            <CircleArrowUp class="size-4 text-primary shrink-0 cursor-pointer outline-none" :aria-label="t('upgrade.updateAvailable')" />
        </HoverCardTrigger>
        <HoverCardContent :side="tooltipSide ?? 'top'" class="w-72 animate-none">
            <div class="flex flex-col space-y-3">
                <div class="flex items-center space-x-3">
                    <img src="/icons/pwa-192x192.png" class="size-8 rounded-lg shrink-0" alt="Arkeep" />
                    <div>
                        <p class="text-sm font-semibold leading-none">{{ t('upgrade.updateAvailable') }}</p>
                        <p class="text-xs text-primary mt-1">v{{ version }}</p>
                    </div>
                </div>
                <p class="text-sm text-muted-foreground leading-relaxed">
                    {{ t('upgrade.description') }}
                </p>
                <a href="https://github.com/arkeep-io/arkeep/releases" target="_blank" rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                    <ExternalLink class="size-3" />
                    {{ t('upgrade.downloadChangelog') }}
                </a>
            </div>
        </HoverCardContent>
    </HoverCard>
</template>
