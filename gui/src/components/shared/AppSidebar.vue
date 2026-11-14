<script setup lang="ts">
import type { SidebarProps } from "@/components/ui/sidebar"

import {
    Archive,
    ClipboardList,
    HardDrive,
    LayoutDashboard,
    ScrollText,
    Server,
    Settings,
    Shield,
    Users,
} from "@lucide/vue"

import NavMain from "@/components/shared/NavMain.vue"
import NavUser from "@/components/shared/NavUser.vue"
import UpgradeIndicator from "@/components/shared/UpgradeIndicator.vue"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore } from "@/stores/auth"
import { useUpdateStore } from "@/stores/update"
import { computed, onMounted } from "vue"
import { useI18n } from "vue-i18n"

interface NavSection {
    title: string
    items: NavItem[]
}

interface NavItem {
    title: string
    url: string
    icon: typeof LayoutDashboard
    adminOnly?: boolean
}

const auth = useAuthStore();
const updateStore = useUpdateStore();
const { t } = useI18n();

onMounted(() => updateStore.fetch())

const props = withDefaults(defineProps<SidebarProps>(), {
    collapsible: "icon",
    variant: "inset",
})

const nav: NavSection[] = [
    {
        title: 'nav.sections.overview',
        items: [
            { title: 'nav.dashboard', url: '/dashboard', icon: LayoutDashboard },
        ],
    },
    {
        title: 'nav.sections.infrastructure',
        items: [
            { title: 'nav.agents', url: '/agents', icon: Server },
            { title: 'nav.policies', url: '/policies', icon: Shield },
            { title: 'nav.destinations', url: '/destinations', icon: HardDrive },
        ],
    },
    {
        title: 'nav.sections.data',
        items: [
            { title: 'nav.snapshots', url: '/snapshots', icon: Archive },
            { title: 'nav.jobs', url: '/jobs', icon: ClipboardList },
        ],
    },
    {
        title: 'nav.sections.operations',
        items: [
            { title: 'nav.users', url: '/users', icon: Users, adminOnly: true },
            { title: 'nav.settings', url: '/settings', icon: Settings, adminOnly: true },
            { title: 'nav.auditLog', url: '/audit', icon: ScrollText, adminOnly: true },
        ],
    },
]

const visibleNav = computed<NavSection[]>(() =>
    nav.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.adminOnly || auth.isAdmin),
    })).filter((section) => section.items.length > 0),
)

const userInitials = computed(() =>
    (auth.user?.display_name ?? '')
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?',
)
</script>

<template>
    <Sidebar v-bind="props">
        <SidebarHeader>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" as-child>
                        <RouterLink to="/dashboard">
                            <img src="/icons/pwa-192x192.png" class="size-8 rounded-lg shrink-0" alt="Arkeep" />
                            <div class="grid flex-1 text-sm leading-tight text-left">
                                <span class="font-medium truncate">Arkeep</span>
                            </div>
                        </RouterLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
            <NavMain :items="visibleNav" />
        </SidebarContent>
        <SidebarFooter>
            <NavUser :user="{
                display_name: auth.user?.display_name ?? '',
                email: auth.user?.email ?? '',
                user_initials: userInitials
            }" />
            <!-- Version card: fades and collapses when sidebar goes to icon mode.
                 Uses the same duration/easing as the sidebar's own transitions. -->
            <div class="overflow-hidden transition-[max-height,opacity] duration-200 ease-linear
                        max-h-16 opacity-100
                        group-data-[collapsible=icon]:max-h-0 group-data-[collapsible=icon]:opacity-0">
                <Card class="py-2">
                    <CardContent class="px-3">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-muted-foreground">{{ t('common.server') }}</span>
                            <div class="flex gap-1.5">
                                {{ updateStore.serverVersion ? `v${updateStore.serverVersion}` : t('common.versionNotAvailable')
                                }}
                                <UpgradeIndicator :show="updateStore.updateAvailable"
                                    :version="updateStore.latestVersion" tooltip-side="top" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <!-- Collapsed icon: only rendered when an update is available;
                 fades in when sidebar is collapsed, hidden when expanded. -->
            <div v-if="updateStore.updateAvailable" class="flex justify-center overflow-hidden transition-[max-height,opacity] duration-200 ease-linear
                        max-h-0 opacity-0
                        group-data-[collapsible=icon]:max-h-8 group-data-[collapsible=icon]:opacity-100">
                <UpgradeIndicator :show="true" :version="updateStore.latestVersion" tooltip-side="top" />
            </div>
        </SidebarFooter>
    </Sidebar>
</template>
