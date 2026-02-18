import { Panel } from './Panel';

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

interface ChartTab {
  id: string;           // unique tab id
  label: string;        // display name
  pairAddress: string;  // on-chain pool address (for GeckoTerminal embed)
  ca?: string;          // token mint / contract address
}

type ChartMode = 'price' | 'mcap';

const STORAGE_KEY = 'solanaterminal-live-charts';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_MINT = 'HYvUDMu6jwPSiK3X91JjCU91wtrdbuVvjN2QnueCpump';

/* ------------------------------------------------------------------ */
/*  LiveChartsPanel                                                    */
/* ------------------------------------------------------------------ */

export class LiveChartsPanel extends Panel {
  private tabs: ChartTab[] = [];
  private activeTabId = '';
  private chartMode: ChartMode = 'price';
  private tabBar: HTMLElement | null = null;
  private chartContainer: HTMLElement | null = null;
  private inputOverlay: HTMLElement | null = null;

  constructor() {
    super({ id: 'live-charts', title: 'Live Charts', showCount: false, trackActivity: false });
    this.element.classList.add('panel-wide');
    this.loadFromStorage();
    this.buildUI();
    this.resolveAndRender();
  }

  /* ====================== PERSISTENCE ====================== */

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: ChartTab[] = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) {
          this.tabs = saved;
          // Ensure project token tab exists (added after initial release)
          if (!this.tabs.some(t => t.ca === TOKEN_MINT)) {
            this.tabs.splice(1, 0, { id: 'token-default', label: 'SOLMON / SOL', pairAddress: '', ca: TOKEN_MINT });
          }
          this.activeTabId = saved[0]!.id;
          return;
        }
      }
    } catch { /* ignore */ }

    // Default: SOL + project token charts (pairAddress resolved async)
    this.tabs = [
      { id: 'sol-default', label: 'SOL / USD', pairAddress: '', ca: SOL_MINT },
      { id: 'token-default', label: 'SOLMON / SOL', pairAddress: '', ca: TOKEN_MINT },
    ];
    this.activeTabId = 'sol-default';
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tabs));
    } catch { /* ignore */ }
  }

  /* ====================== RESOLVE PAIR ADDRESSES ====================== */

  private async resolveAndRender(): Promise<void> {
    let changed = false;
    for (const tab of this.tabs) {
      const needsResolve = !tab.pairAddress || tab.pairAddress === SOL_MINT;
      if (needsResolve && tab.ca) {
        const result = await this.fetchMostLiquidPair(tab.ca);
        if (result) {
          tab.pairAddress = result.pairAddress;
          if (tab.id !== 'sol-default') tab.label = result.label;
          changed = true;
        }
      }
    }
    if (changed) this.saveToStorage();
    this.renderTabBar();
    this.renderActiveChart();
  }

  /* ====================== UI BUILD ====================== */

  private buildUI(): void {
    const content = this.element.querySelector('.panel-content') as HTMLElement;
    if (!content) return;
    content.innerHTML = '';
    content.style.padding = '0';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';

    // Tab bar
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'live-charts-tab-bar';
    content.appendChild(this.tabBar);

    // Chart container
    this.chartContainer = document.createElement('div');
    this.chartContainer.className = 'live-charts-container';
    this.chartContainer.innerHTML = `
      <div class="live-charts-loading">Loading chart…</div>
    `;
    content.appendChild(this.chartContainer);

    // Input overlay (hidden)
    this.inputOverlay = document.createElement('div');
    this.inputOverlay.className = 'live-charts-input-overlay';
    this.inputOverlay.style.display = 'none';
    this.inputOverlay.innerHTML = `
      <div class="live-charts-input-box">
        <div class="live-charts-input-title">Add Chart</div>
        <div class="live-charts-input-desc">Paste a Solana token contract address (CA) to load its chart</div>
        <input type="text" class="live-charts-ca-input" placeholder="Token CA (e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)" spellcheck="false" autocomplete="off" />
        <div class="live-charts-input-actions">
          <button class="live-charts-input-cancel">Cancel</button>
          <button class="live-charts-input-confirm">Load Chart</button>
        </div>
        <div class="live-charts-input-error" style="display:none"></div>
      </div>
    `;
    content.appendChild(this.inputOverlay);

    // Wire overlay events
    const cancelBtn = this.inputOverlay.querySelector('.live-charts-input-cancel') as HTMLButtonElement;
    const confirmBtn = this.inputOverlay.querySelector('.live-charts-input-confirm') as HTMLButtonElement;
    const caInput = this.inputOverlay.querySelector('.live-charts-ca-input') as HTMLInputElement;

    cancelBtn.addEventListener('click', () => this.hideAddOverlay());
    confirmBtn.addEventListener('click', () => this.handleAddChart(caInput));
    caInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleAddChart(caInput);
      if (e.key === 'Escape') this.hideAddOverlay();
    });

    this.renderTabBar();
  }

  /* ====================== TAB BAR ====================== */

  private renderTabBar(): void {
    if (!this.tabBar) return;
    this.tabBar.innerHTML = '';

    // Chart tabs
    for (const tab of this.tabs) {
      const btn = document.createElement('button');
      btn.className = `live-charts-tab${tab.id === this.activeTabId ? ' active' : ''}`;

      const label = document.createElement('span');
      label.className = 'live-charts-tab-label';
      label.textContent = tab.label;
      btn.appendChild(label);

      const close = document.createElement('span');
      close.className = 'live-charts-tab-close';
      close.textContent = '×';
      close.title = 'Close tab';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });
      btn.appendChild(close);

      btn.addEventListener('click', () => this.switchTab(tab.id));
      this.tabBar.appendChild(btn);
    }

    // Add chart button (right after last tab)
    const addBtn = document.createElement('button');
    addBtn.className = 'live-charts-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add a new chart by token CA';
    addBtn.addEventListener('click', () => this.showAddOverlay());
    this.tabBar.appendChild(addBtn);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this.tabBar.appendChild(spacer);

    // Price / MCap toggle
    const priceBtn = document.createElement('button');
    priceBtn.className = `live-charts-mode-btn${this.chartMode === 'price' ? ' active' : ''}`;
    priceBtn.textContent = 'Price';
    priceBtn.addEventListener('click', () => this.setChartMode('price'));
    this.tabBar.appendChild(priceBtn);

    const mcapBtn = document.createElement('button');
    mcapBtn.className = `live-charts-mode-btn${this.chartMode === 'mcap' ? ' active' : ''}`;
    mcapBtn.textContent = 'MCap';
    mcapBtn.addEventListener('click', () => this.setChartMode('mcap'));
    this.tabBar.appendChild(mcapBtn);
  }

  /* ====================== TAB / MODE ACTIONS ====================== */

  private switchTab(tabId: string): void {
    if (tabId === this.activeTabId) return;
    this.activeTabId = tabId;
    this.renderTabBar();
    this.renderActiveChart();
  }

  private closeTab(tabId: string): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.activeTabId = '';
    } else if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[Math.min(idx, this.tabs.length - 1)]!.id;
    }
    this.renderTabBar();
    this.renderActiveChart();
    this.saveToStorage();
  }

  private setChartMode(mode: ChartMode): void {
    if (this.chartMode === mode) return;
    this.chartMode = mode;
    this.renderTabBar();
    this.renderActiveChart();
  }

  /* ====================== ADD CHART OVERLAY ====================== */

  private showAddOverlay(): void {
    if (!this.inputOverlay) return;
    this.inputOverlay.style.display = 'flex';
    const input = this.inputOverlay.querySelector('.live-charts-ca-input') as HTMLInputElement;
    const errEl = this.inputOverlay.querySelector('.live-charts-input-error') as HTMLElement;
    if (input) { input.value = ''; input.focus(); }
    if (errEl) errEl.style.display = 'none';
  }

  private hideAddOverlay(): void {
    if (!this.inputOverlay) return;
    this.inputOverlay.style.display = 'none';
  }

  private async handleAddChart(input: HTMLInputElement): Promise<void> {
    const ca = input.value.trim();
    if (!ca) return;

    const errEl = this.inputOverlay?.querySelector('.live-charts-input-error') as HTMLElement | null;
    const confirmBtn = this.inputOverlay?.querySelector('.live-charts-input-confirm') as HTMLButtonElement | null;

    if (ca.length < 32 || ca.length > 48) {
      if (errEl) { errEl.textContent = 'Invalid address — must be a Solana token CA'; errEl.style.display = 'block'; }
      return;
    }

    if (this.tabs.some(t => t.ca === ca || t.pairAddress === ca)) {
      const existing = this.tabs.find(t => t.ca === ca || t.pairAddress === ca)!;
      this.switchTab(existing.id);
      this.hideAddOverlay();
      return;
    }

    if (confirmBtn) { confirmBtn.textContent = 'Loading...'; confirmBtn.disabled = true; }
    if (errEl) errEl.style.display = 'none';

    try {
      const result = await this.fetchMostLiquidPair(ca);
      if (!result) {
        if (errEl) { errEl.textContent = 'No pairs found for this token'; errEl.style.display = 'block'; }
        return;
      }

      const newTab: ChartTab = {
        id: `chart-${Date.now()}`,
        label: result.label,
        pairAddress: result.pairAddress,
        ca,
      };

      this.tabs.push(newTab);
      this.activeTabId = newTab.id;
      this.renderTabBar();
      this.renderActiveChart();
      this.saveToStorage();
      this.hideAddOverlay();
    } catch {
      if (errEl) { errEl.textContent = 'Failed to fetch chart data. Try again.'; errEl.style.display = 'block'; }
    } finally {
      if (confirmBtn) { confirmBtn.textContent = 'Load Chart'; confirmBtn.disabled = false; }
    }
  }

  /* ====================== DEXSCREENER API ====================== */

  private async fetchMostLiquidPair(mint: string): Promise<{ pairAddress: string; label: string } | null> {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;

    const sorted = pairs
      .filter((p: Record<string, unknown>) => (p.chainId as string) === 'solana')
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (((b.liquidity as { usd?: number })?.usd) || 0) -
          (((a.liquidity as { usd?: number })?.usd) || 0),
      );

    const best = sorted[0];
    if (!best) return null;

    const baseSymbol = (best.baseToken as { symbol?: string })?.symbol || 'TOKEN';
    const quoteSymbol = (best.quoteToken as { symbol?: string })?.symbol || 'USD';
    return {
      pairAddress: best.pairAddress as string,
      label: `${baseSymbol} / ${quoteSymbol}`,
    };
  }

  /* ====================== CHART RENDERING ====================== */

  private buildEmbedUrl(poolAddress: string): string {
    // GeckoTerminal chart-only embed: info=0 hides token info, swaps=0 hides trades
    const base = `https://www.geckoterminal.com/solana/pools/${poolAddress}`;
    const params = `embed=1&info=0&swaps=0`;
    const chartType = this.chartMode === 'mcap' ? '&chart_type=market_cap' : '&chart_type=price';
    return `${base}?${params}${chartType}`;
  }

  private renderActiveChart(): void {
    if (!this.chartContainer) return;
    this.chartContainer.innerHTML = '';

    if (this.tabs.length === 0 || !this.activeTabId) {
      this.chartContainer.innerHTML = `
        <div class="live-charts-loading" style="flex-direction:column;gap:8px;">
          <span style="font-size:14px;color:var(--text-dim)">No charts open</span>
          <span style="font-size:12px;color:var(--text-muted)">Click + to add a chart</span>
        </div>
      `;
      return;
    }

    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab || !tab.pairAddress) {
      this.chartContainer.innerHTML = `
        <div class="live-charts-loading">Loading chart…</div>
      `;
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'live-charts-iframe';
    iframe.src = this.buildEmbedUrl(tab.pairAddress);
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.allow = 'clipboard-write';
    iframe.setAttribute('loading', 'lazy');

    this.chartContainer.appendChild(iframe);
  }

  /* ====================== PUBLIC API ====================== */

  public refresh(): void {
    // Charts are self-contained iframes; nothing to refresh
  }

  public destroy(): void {
    if (this.chartContainer) this.chartContainer.innerHTML = '';
  }
}
