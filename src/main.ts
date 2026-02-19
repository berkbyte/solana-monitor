import './styles/main.css';
import './styles/solana-terminal.css';
import './styles/mobile.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { inject } from '@vercel/analytics';
import { App } from './SolanaApp';
import { initMetaTags } from '@/services/meta-tags';
import { installRuntimeFetchPatch } from '@/services/runtime';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { applyStoredTheme } from '@/utils/theme-manager';

// Initialize Vercel Analytics
inject();

// Initialize dynamic meta tags
initMetaTags();

// Desktop runtime patches
installRuntimeFetchPatch();
void loadDesktopSecrets();

// Apply stored theme preference before app initialization
applyStoredTheme();

// Remove no-transition class after first paint
requestAnimationFrame(() => {
  document.documentElement.classList.remove('no-transition');
});

const app = new App('app');
app.init().catch(console.error);

// PWA registration (non-Tauri only)
if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          setInterval(async () => {
            if (!navigator.onLine) return;
            try { await registration.update(); } catch {}
          }, 60 * 60 * 1000);
        }
      },
      onOfflineReady() {
        console.log('[PWA] App ready for offline use');
      },
    });
  });
}

