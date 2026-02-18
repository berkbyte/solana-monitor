// Globe Mode Switcher — clickable UI for switching between globe visualization modes
// User requirement: "Sadece tuşlarla değil, tıklayarak butonlarla da geçilmeli"
import { escapeHtml } from '../utils/sanitize';

export type GlobeMode = 'validators' | 'depin' | 'flow' | 'risk' | 'defi';

interface GlobeModeConfig {
  id: GlobeMode;
  label: string;
  icon: string;
  shortcut: string;
  description: string;
}

const GLOBE_MODES: GlobeModeConfig[] = [
  { id: 'validators', label: 'Validators', icon: '🌐', shortcut: '1', description: 'Validator nodes, stake distribution, Nakamoto coefficient' },
  { id: 'depin', label: 'DePIN', icon: '📡', shortcut: '2', description: 'Helium, Render, IoNet physical infrastructure' },
  { id: 'flow', label: 'Flow', icon: '⚡', shortcut: '3', description: 'Real-time transaction flows, whale movements' },
  { id: 'risk', label: 'Risk', icon: '⚠️', shortcut: '4', description: 'Datacenter concentration, geographic risk' },
  { id: 'defi', label: 'DeFi', icon: '🏦', shortcut: '5', description: 'DeFi protocol activity, TVL by region' },
];

export class GlobeModeSwitcher {
  private element: HTMLElement;
  private currentMode: GlobeMode = 'validators';
  private onModeChange: ((mode: GlobeMode) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'globe-mode-switcher';
    this.render();
    this.setupKeyboardShortcuts();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public setOnModeChange(callback: (mode: GlobeMode) => void): void {
    this.onModeChange = callback;
  }

  public getMode(): GlobeMode {
    return this.currentMode;
  }

  public setMode(mode: GlobeMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.updateActive();
    this.onModeChange?.(mode);
  }

  private render(): void {
    this.element.innerHTML = `
      <div class="globe-mode-bar">
        ${GLOBE_MODES.map(mode => `
          <button
            class="globe-mode-btn ${mode.id === this.currentMode ? 'active' : ''}"
            data-mode="${escapeHtml(mode.id)}"
            title="${escapeHtml(mode.description)} [${mode.shortcut}]"
          >
            <span class="globe-mode-icon">${mode.icon}</span>
            <span class="globe-mode-label">${escapeHtml(mode.label)}</span>
            <span class="globe-mode-key">${mode.shortcut}</span>
          </button>
        `).join('')}
      </div>
    `;

    this.element.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.globe-mode-btn') as HTMLElement;
      if (!btn) return;
      const mode = btn.dataset.mode as GlobeMode;
      if (mode) this.setMode(mode);
    });
  }

  private updateActive(): void {
    this.element.querySelectorAll('.globe-mode-btn').forEach(btn => {
      const el = btn as HTMLElement;
      el.classList.toggle('active', el.dataset.mode === this.currentMode);
    });
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const mode = GLOBE_MODES.find(m => m.shortcut === e.key);
      if (mode) {
        e.preventDefault();
        this.setMode(mode.id);
      }
    });
  }

  public destroy(): void {
    this.element.remove();
  }
}
