<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { describeCron } from '@/lib/cron'

// Plain-language reading of the cron expression typed in the field above it
// (issue #520). Renders nothing for an empty field; the server stays the
// authority on validity.
const { t } = useI18n()

const props = defineProps<{ expression: string }>()

const description = computed(() => describeCron(props.expression ?? ''))
</script>

<template>
    <p v-if="description" class="text-xs text-muted-foreground" data-testid="cron-hint">{{ description }}</p>
    <p v-else-if="expression?.trim()" class="text-xs text-destructive" data-testid="cron-hint">
        {{ t('cron.invalid') }}
    </p>
</template>
