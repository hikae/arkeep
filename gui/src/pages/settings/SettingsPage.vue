<script setup lang="ts">
import { Bell, Hourglass, KeyRound, Mail, RefreshCcw, ScrollText } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
    <div class="flex flex-col gap-6 p-6">

        <!-- Page header -->
        <div>
            <h1 class="text-2xl font-semibold tracking-tight">{{ t('settings.title') }}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
                {{ t('settings.subtitle') }}
            </p>
        </div>

        <div class="flex gap-8 min-h-0">

            <!-- Left nav -->
            <aside class="w-52 shrink-0">
                <nav class="flex flex-col gap-1">
                    <RouterLink :to="{ name: 'settings-oidc' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <KeyRound class="size-4 shrink-0" />
                        {{ t('nav.openidConnect') }}
                    </RouterLink>
                    <RouterLink :to="{ name: 'settings-smtp' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <Mail class="size-4 shrink-0" />
                        {{ t('nav.smtp') }}
                    </RouterLink>
                    <RouterLink :to="{ name: 'settings-notifications' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <Bell class="size-4 shrink-0" />
                        {{ t('nav.notifications') }}
                    </RouterLink>
                    <RouterLink :to="{ name: 'settings-logs' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <ScrollText class="size-4 shrink-0" />
                        {{ t('nav.logRetention') }}
                    </RouterLink>
                    <RouterLink :to="{ name: 'settings-jobs-queue' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <Hourglass class="size-4 shrink-0" />
                        {{ t('nav.jobQueue') }}
                    </RouterLink>
                    <RouterLink :to="{ name: 'settings-snapshot-sync' }"
                        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        active-class="bg-accent text-accent-foreground">
                        <RefreshCcw class="size-4 shrink-0" />
                        {{ t('nav.snapshotSync') }}
                    </RouterLink>
                </nav>
            </aside>

            <!-- Sub-page content -->
            <div class="flex-1 min-w-0">
                <RouterView />
            </div>

        </div>
    </div>
</template>
