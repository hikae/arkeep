<script setup lang="ts">
// OIDCCallbackPage.vue — Handles the server-side OIDC redirect.
//
// After a successful OAuth2 exchange the server redirects here:
//   /auth/callback?token=<access_token>&expires_in=<seconds>
// or, when it refuses the sign-in, /auth/callback?error=<reason>.
//
// This page stores the token in memory (via the auth store), replaces the
// URL so the token is not left in browser history or exposed via Referer,
// then navigates to the dashboard (or the originally-intended destination).

import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle, Loader2, Moon, Sun } from '@lucide/vue'
import { useTheme } from '@/composables/useTheme'
import LocaleToggle from '@/components/shared/LocaleToggle.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isDark, cycle, modeLabel } = useTheme()
const { t } = useI18n()

const error = ref<string | null>(null)

onMounted(async () => {
  // The server redirects here with ?error=<reason> when it refuses the
  // sign-in (e.g. an existing account it will not link automatically).
  const refused = route.query.error
  if (typeof refused === 'string' && refused) {
    error.value = t('auth.oidc.refused', { reason: refused })
    return
  }

  const token = route.query.token
  const expiresIn = route.query.expires_in

  if (typeof token !== 'string' || !token) {
    error.value = t('auth.oidc.missingToken')
    return
  }

  const expiresInSeconds = typeof expiresIn === 'string' ? parseInt(expiresIn, 10) : 900

  try {
    await auth.setTokenAndFetchUser(token, expiresInSeconds)

    // Remove the token from the URL immediately to prevent leakage via
    // browser history or the Referer header on subsequent navigations.
    // Validate the redirect target to prevent open-redirect attacks:
    // only allow paths that start with "/" and not "//" (protocol-relative URLs).
    const rawRedirect = route.query.redirect
    const redirectTo =
      typeof rawRedirect === 'string' && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
        ? rawRedirect
        : '/dashboard'
    await router.replace(redirectTo)
  } catch {
    error.value = t('auth.oidc.profileFailed')
  }
})
</script>

<template>
    <div class="relative flex flex-col items-center justify-center w-full p-6 min-h-svh md:p-10">
        <!-- Background grid -->
        <div class="absolute inset-0 z-0" :style="{
            backgroundImage: `
                linear-gradient(to right, ${isDark ? '#3f3f46' : '#d1d5db'} 1px, transparent 1px),
                linear-gradient(to bottom, ${isDark ? '#3f3f46' : '#d1d5db'} 1px, transparent 1px)
            `,
            backgroundSize: '32px 32px',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)',
            maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)',
        }" />

        <!-- Theme and language toggles -->
        <div class="absolute z-10 top-4 right-4 flex items-center gap-2">
            <LocaleToggle />
            <Button variant="ghost" size="icon"
                class="text-muted-foreground hover:text-foreground"
                :aria-label="modeLabel" @click="cycle()">
                <Sun v-if="isDark" class="size-4" />
                <Moon v-else class="size-4" />
            </Button>
        </div>

        <!-- Card -->
        <div class="relative z-10 w-full max-w-sm">
            <Card>
                <CardContent class="flex flex-col items-center gap-4 py-10">
                    <template v-if="error">
                        <AlertCircle class="size-8 text-destructive" />
                        <div class="text-center space-y-1">
                            <p class="text-sm font-medium">{{ t('auth.oidc.failed') }}</p>
                            <p class="text-xs text-muted-foreground">{{ error }}</p>
                        </div>
                        <Button variant="outline" size="sm" as-child>
                            <a href="/login">{{ t('auth.oidc.backToLogin') }}</a>
                        </Button>
                    </template>
                    <template v-else>
                        <Loader2 class="size-8 animate-spin text-muted-foreground" />
                        <div class="text-center space-y-1">
                            <p class="text-sm font-medium">{{ t('auth.oidc.signingIn') }}</p>
                            <p class="text-xs text-muted-foreground">{{ t('auth.oidc.pleaseWait') }}</p>
                        </div>
                    </template>
                </CardContent>
            </Card>
        </div>
    </div>

    <!-- Footer -->
    <p class="fixed bottom-0 left-0 right-0 text-center text-xs text-muted-foreground pb-6">
        {{ t('auth.footer') }}
    </p>
</template>
