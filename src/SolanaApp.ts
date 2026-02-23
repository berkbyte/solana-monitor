// SolanaApp.ts — Main application class for Solana Terminal
// Replaces the original World Monitor App.ts with Solana-specific panels and data flows
import type { PanelConfig, MapLayers } from '@/types';
import {
  FEEDS,
  REFRESH_INTERVALS,
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
} from '@/config';
import {
  fetchCategoryFeeds,
  initDB,
} from '@/services';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { debounce, loadFromStorage, saveToStorage, isMobileDevice, setTheme, getCurrentTheme } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { fetchNetworkStatus } from '@/services/solana-rpc';
import { fetchTrendingTokens } from '@/services/token-radar';
import { fetchDeFiOverview } from '@/services/defi-overview';

import { fetchMevStats } from '@/services/mev-jito';
import { fetchLiquidStaking } from '@/services/liquid-staking';
import { fetchNFTData } from '@/services/nft-tracker';
import { fetchGovernanceData } from '@/services/governance';
import { analyzeTokenCA } from '@/services/token-analyze';
import { fetchSentimentReport } from '@/services/x-sentiment';

import {
  Panel,
  MobileWarningModal,
  NewsPanel,
  InsightsPanel,
  LiveChartsPanel,
  ETFFlowsPanel,
  NetworkStatusPanel,
  TokenRadarPanel,

  DeFiOverviewPanel,
  MevDashboardPanel,
  LiquidStakingPanel,
  NFTTrackerPanel,
  GovernancePanel,
  TokenAnalyzePanel,
  GlobeModeSwitcher,
} from '@/components';
import { SolanaDeckGlobe } from '@/components/SolanaDeckGlobe';
import { isDesktopRuntime } from '@/services/runtime';

declare const __APP_VERSION__: string;

export class App {
  private container: HTMLElement;
  private readonly PANEL_ORDER_KEY = 'panel-order';
  private panels: Record<string, Panel> = {};
  private newsPanels: Record<string, NewsPanel> = {};
  private panelSettings: Record<string, PanelConfig>;
  private mapLayers: MapLayers;
  private globeModeSwitcher: GlobeModeSwitcher | null = null;
  private solanaGlobe: SolanaDeckGlobe | null = null;
  private inFlight: Set<string> = new Set();
  private isMobile: boolean;
  private refreshTimeoutIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isDestroyed = false;
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private boundIdleResetHandler: (() => void) | null = null;
  private isIdle = false;
  private readonly IDLE_PAUSE_MS = 2 * 60 * 1000;
  private readonly isDesktopApp = isDesktopRuntime();

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;

    this.isMobile = isMobileDevice();

    const defaultLayers = this.isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;

    this.mapLayers = loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, defaultLayers);
    this.panelSettings = loadFromStorage<Record<string, PanelConfig>>(
      STORAGE_KEYS.panels,
      DEFAULT_PANELS
    );
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  public async init(): Promise<void> {
    await initDB();
    await mlWorker.init();

    this.renderLayout();
    this.setupMobileWarning();
    this.setupEventListeners();

    await this.loadAllData();
    this.setupRefreshIntervals();
  }

  // =========================================================================
  // LAYOUT
  // =========================================================================

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="mobile-desktop-notice">
        <span>🖥</span> For the best experience, use desktop
        <button class="mobile-notice-close" id="mobileNoticeClose">✕</button>
      </div>
      <div class="header">
        <div class="header-left">
          <span class="logo">SOLANA MONITOR</span>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>LIVE</span>
          </div>
          <a href="https://x.com/solanamonitor" target="_blank" rel="noopener" class="header-x-link" title="Follow @solanamonitor on X">
            <svg class="header-x-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span>@solanamonitor</span>
          </a>
          <button class="header-ca-btn" id="headerCABtn" title="Click to copy CA">
            <img class="header-bags-icon" src="https://play-lh.googleusercontent.com/X90KzHNIA8GEeYNvR6CqEP50-GDqhmBkMunu6MH0UfhNXcWyhOqniwQmypH9yXVH-2jc=w240-h480-rw" alt="Bags" width="18" height="18" />
            <span class="header-ca-label">CA</span>
            <span class="header-ca-addr" id="headerCAAddr">ERPGD6N8n8m3G1UN1H3fDCHF65g73EoKYWqETD4MBAGS</span>
          </button>
          <a class="header-bags-link" href="https://bags.fm/ERPGD6N8n8m3G1UN1H3fDCHF65g73EoKYWqETD4MBAGS" target="_blank" rel="noopener" title="View on Bags.fm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
        <div class="header-right">
          <span class="header-opensource-label">Open-source & Free</span>
          <a class="header-github-link" href="https://github.com/berkbyte/solana-monitor" target="_blank" rel="noopener" title="Open source on GitHub">
            <svg class="header-github-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>Github</span>
          </a>
          <button class="theme-toggle-btn" id="headerThemeToggle" title="Toggle dark/light mode">
            ${getCurrentTheme() === 'dark'
              ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
              : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
          </button>
          ${this.isDesktopApp ? '' : '<button class="fullscreen-btn" id="fullscreenBtn" title="Fullscreen">⛶</button>'}
        </div>
      </div>
      <div class="main-content">
        <div class="map-section" id="mapSection">
          <div class="panel-header">
            <div class="panel-header-left">
              <span class="panel-title">Solana Globe</span>
            </div>
            <div id="globeModeSwitcherMount"></div>
          </div>
          <div class="map-container" id="mapContainer"></div>
          <div class="map-resize-handle" id="mapResizeHandle"></div>
        </div>
        <div class="panels-grid" id="panelsGrid"></div>
      </div>
      <div class="modal-overlay" id="settingsModal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Panels</span>
            <button class="modal-close" id="modalClose">×</button>
          </div>
          <div class="panel-toggle-grid" id="panelToggles"></div>
        </div>
      </div>
    `;

    this.createPanels();
    this.renderPanelToggles();
    this.setupGlobeModeSwitcher();
  }

  // =========================================================================
  // GLOBE MODE SWITCHER
  // =========================================================================

  private setupGlobeModeSwitcher(): void {
    this.globeModeSwitcher = new GlobeModeSwitcher();
    const mount = document.getElementById('globeModeSwitcherMount');
    if (mount) {
      mount.appendChild(this.globeModeSwitcher.getElement());
    }

    // Mount the deck.gl + MapLibre globe
    const mapContainer = document.getElementById('mapContainer');
    if (mapContainer) {
      this.solanaGlobe = new SolanaDeckGlobe(mapContainer);
    }

    this.globeModeSwitcher.setOnModeChange((mode) => {
      console.log(`[Globe] Mode changed: ${mode}`);
      this.solanaGlobe?.setMode(mode);

      // Update map layers based on mode
      const modeLayerMap: Record<string, Partial<MapLayers>> = {
        validators: { validators: true, stakeHeatmap: true, dcClusters: true, depinHelium: false, whaleFlows: false },
        depin: { validators: false, depinHelium: true, depinRender: true, depinIonet: true, whaleFlows: false },
        flow: { validators: false, whaleFlows: true, depinHelium: false },
        risk: { validators: false, dcClusters: true, dcRisk: true, delinquent: true, depinHelium: false },
        defi: { validators: false, whaleFlows: false, depinHelium: false },
      };

      const updates = modeLayerMap[mode];
      if (updates) {
        Object.assign(this.mapLayers, updates);
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
      }
    });
  }

  // =========================================================================
  // PANEL CREATION
  // =========================================================================

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;

    // Map placeholder — MapContainer removed (legacy geo dependencies)
    // Solana validator globe will be re-implemented here

    // ============================
    // SOLANA-SPECIFIC PANELS
    // ============================

    // Network Status — TPS, epoch, validators, fees
    const networkStatus = new NetworkStatusPanel();
    this.panels['network-status'] = networkStatus;

    // Token Radar — trending tokens with rug scores
    const tokenRadar = new TokenRadarPanel();
    this.panels['token-radar'] = tokenRadar;

    // DeFi Overview — TVL, protocols, LSTs
    const defiOverview = new DeFiOverviewPanel();
    this.panels['defi-overview'] = defiOverview;

    // MEV & Jito Dashboard
    const mevDashboard = new MevDashboardPanel();
    this.panels['mev-dashboard'] = mevDashboard;

    // Liquid Staking
    const liquidStaking = new LiquidStakingPanel();
    this.panels['liquid-staking'] = liquidStaking;

    // NFT Tracker
    const nftTracker = new NFTTrackerPanel();
    this.panels['nft-tracker'] = nftTracker;

    // Governance
    const governance = new GovernancePanel();
    this.panels['governance'] = governance;

    // ============================
    // KEPT PANELS (from original)
    // ============================

    // Live Charts (DexScreener embeds)
    const liveChartsPanel = new LiveChartsPanel();
    this.panels['live-charts'] = liveChartsPanel;

    // AI Insights
    const insightsPanel = new InsightsPanel();
    this.panels['insights'] = insightsPanel;

    // ETF Flows
    this.panels['etf-flows'] = new ETFFlowsPanel();

    // Token Analyze panel
    const tokenAnalyzePanel = new TokenAnalyzePanel();
    this.panels['token-analyze'] = tokenAnalyzePanel;

    // Solana News feed
    const solanaNews = new NewsPanel('solana-news', 'Solana News');
    this.newsPanels['solana-news'] = solanaNews;
    this.panels['solana-news'] = solanaNews;

    // ============================
    // MOUNT PANELS TO GRID
    // ============================
    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();

    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      // Insert new panels after live-charts
      const insertIdx = Math.max(valid.indexOf('live-charts') + 1, 0);
      valid.splice(insertIdx, 0, ...missing);
      panelOrder = valid;
    }

    // Live Charts must be first (spans 2 cols × 2 rows)
    const liveChartsIdx = panelOrder.indexOf('live-charts');
    if (liveChartsIdx > 0) {
      panelOrder.splice(liveChartsIdx, 1);
      panelOrder.unshift('live-charts');
    }

    panelOrder.forEach((key: string) => {
      const panel = this.panels[key];
      if (panel) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      }
    });

    this.applyPanelSettings();
  }

  // =========================================================================
  // DATA LOADING
  // =========================================================================

  private async loadAllData(): Promise<void> {
    const tasks: Promise<void>[] = [
      this.loadSolanaNetwork(),
      this.loadTokenData(),
      this.loadDeFiData(),
      this.loadMevData(),
      this.loadLSTData(),
      this.loadNftData(),
      this.loadGovernanceData(),
      this.loadNews(),
    ];

    await Promise.allSettled(tasks);
    console.log('[SolanaApp] Initial data load complete');
  }

  // Solana network status (TPS, epoch, validators, fees)
  private async loadSolanaNetwork(): Promise<void> {
    if (this.inFlight.has('solana-network')) return;
    this.inFlight.add('solana-network');
    try {
      const status = await fetchNetworkStatus();

      // Helius fee levels → panel format
      const fl = status.feeLevels;

      const panel = this.panels['network-status'] as NetworkStatusPanel;
      panel?.update({
        tps: status.tps,
        slot: status.slot,
        epoch: status.epoch,
        epochProgress: status.epochProgress,
        validatorCount: status.validatorCount,
        delinquentCount: status.delinquentCount,
        totalStakeSOL: status.totalStake,
        feeLevels: fl,
        health: status.health,
        timestamp: status.timestamp,
      });


    } catch (e) {
      console.error('[SolanaApp] Failed to load network status:', e);
    } finally {
      this.inFlight.delete('solana-network');
    }
  }

  // Token data (prices, trending, new pairs)
  private async loadTokenData(): Promise<void> {
    if (this.inFlight.has('token-data')) return;
    this.inFlight.add('token-data');
    try {
      const tokens = await fetchTrendingTokens();
      const tokenPanel = this.panels['token-radar'] as TokenRadarPanel;
      if (tokenPanel && tokens.length > 0) {
        tokenPanel.update(tokens);
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load token data:', e);
    } finally {
      this.inFlight.delete('token-data');
    }
  }

  // DeFi data (TVL, protocols, liquid staking)
  private async loadDeFiData(): Promise<void> {
    if (this.inFlight.has('defi-data')) return;
    this.inFlight.add('defi-data');
    try {
      const overview = await fetchDeFiOverview();
      const defiPanel = this.panels['defi-overview'] as DeFiOverviewPanel;
      if (defiPanel && overview) {
        defiPanel.update({
          totalTvl: overview.totalTvl,
          tvlChange24h: overview.tvlChange24h || 0,
          protocols: overview.topProtocols.map(p => ({
            name: p.name,
            slug: p.slug,
            tvl: p.tvl,
            tvlChange24h: p.tvlChange24h || 0,
            category: p.category || 'DeFi',
            chain: 'Solana',
            url: p.url,
          })),
          liquidStaking: overview.liquidStaking?.map(ls => ({
            name: ls.protocol,
            symbol: ls.token,
            tvl: ls.tvl,
            apy: ls.apy || 0,
            stakeShare: ls.stakeShare || 0,
          })) || [],
        });
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load DeFi data:', e);
    } finally {
      this.inFlight.delete('defi-data');
    }
  }

  // News from Solana feeds
  private async loadNews(): Promise<void> {
    if (this.inFlight.has('news')) return;
    this.inFlight.add('news');
    try {
      const items = await fetchCategoryFeeds(FEEDS, {});

      // Cluster news (async)
      const clusters = await clusterNewsHybrid(items);

      // Refresh live charts panel
      const liveCharts = this.panels['live-charts'] as LiveChartsPanel;
      if (liveCharts) {
        liveCharts.refresh();
      }

      // Feed InsightsPanel with clustered events
      const insightsPanel = this.panels['insights'] as InsightsPanel;
      if (insightsPanel && clusters.length > 0) {
        insightsPanel.updateInsights(clusters);
      }

      // Build source → category map from FEEDS config
      const sourceCategory = new Map<string, string>();
      for (const f of FEEDS) {
        if (f.category) sourceCategory.set(f.name, f.category);
      }

      // Solana-native source names (these always pass the filter)
      const SOLANA_NATIVE_SOURCES = new Set([
        'Solana News', 'Helius Blog', 'Jito Blog',
        'Jupiter Blog', 'Phantom Blog', 'SolanaFloor', 'The Solana Daily',
        'Solana Compass', 'Superteam Blog', 'Marinade Blog',
        'Drift Blog', 'Orca Blog', 'Magic Eden Blog',
      ]);

      // Solana-relevant keywords for filtering general crypto feeds
      const SOLANA_KEYWORDS = [
        'solana', 'sol ', '$sol', 'phantom', 'jupiter', 'jito', 'raydium',
        'marinade', 'orca', 'drift', 'pyth', 'helium', 'bonk', 'wif',
        'tensor', 'magic eden', 'metaplex', 'anchor', 'spl', 'bpf',
        'helius', 'sanctum', 'kamino', 'marginfi', 'meteora',
        'madlads', 'pump.fun', 'jupiter exchange', 'solflare',
        'wormhole', 'neon evm', 'shadow drive', 'render network',
        'hivemapper', 'compressed nft', 'blink', 'dialect',
        'firedancer', 'frankendancer', 'solana mobile', 'saga',
        'superteam', 'step finance', 'squads', 'tiplink',
      ];
      const isSolanaRelevant = (text: string): boolean => {
        const lower = text.toLowerCase();
        return SOLANA_KEYWORDS.some(kw => lower.includes(kw));
      };

      // Distribute news to category-specific panels
      for (const [cat, panel] of Object.entries(this.newsPanels)) {
        let filtered = items.filter(item => {
          const itemCat = sourceCategory.get(item.source);
          return itemCat === cat;
        });

        // For solana-news category, keep items from Solana-native sources + keyword-filtered general outlets
        if (cat === 'solana-news') {
          const solanaFiltered = filtered.filter(item =>
            SOLANA_NATIVE_SOURCES.has(item.source || '') ||
            isSolanaRelevant(item.title) ||
            isSolanaRelevant(item.source || '')
          );
          // If keyword filter returns items, use them; otherwise show all category items
          if (solanaFiltered.length > 0) {
            filtered = solanaFiltered;
          }
          // else: keep all filtered items from category (better than nothing)
        }

        // Only render if we have matching items (no fallback to all items)
        if (filtered.length > 0) {
          panel.renderNews(filtered);
        }
      }

      // Update panels done
    } catch (e) {
      console.error('[SolanaApp] Failed to load news:', e);
    } finally {
      this.inFlight.delete('news');
    }
  }

  // MEV & Jito stats
  private async loadMevData(): Promise<void> {
    if (this.inFlight.has('mev-data')) return;
    this.inFlight.add('mev-data');
    try {
      const stats = await fetchMevStats();
      const panel = this.panels['mev-dashboard'] as MevDashboardPanel;
      if (panel) {
        panel.update(stats);
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load MEV data:', e);
    } finally {
      this.inFlight.delete('mev-data');
    }
  }

  // Liquid Staking data
  private async loadLSTData(): Promise<void> {
    if (this.inFlight.has('lst-data')) return;
    this.inFlight.add('lst-data');
    try {
      const data = await fetchLiquidStaking();
      const panel = this.panels['liquid-staking'] as LiquidStakingPanel;
      if (panel) {
        panel.update(data);
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load LST data:', e);
    } finally {
      this.inFlight.delete('lst-data');
    }
  }

  // NFT Tracker data
  private async loadNftData(): Promise<void> {
    if (this.inFlight.has('nft-data')) return;
    this.inFlight.add('nft-data');
    try {
      const data = await fetchNFTData();
      const panel = this.panels['nft-tracker'] as NFTTrackerPanel;
      if (panel) {
        panel.update(data);
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load NFT data:', e);
    } finally {
      this.inFlight.delete('nft-data');
    }
  }

  // Governance proposals
  private async loadGovernanceData(): Promise<void> {
    if (this.inFlight.has('governance-data')) return;
    this.inFlight.add('governance-data');
    try {
      const data = await fetchGovernanceData();
      const panel = this.panels['governance'] as GovernancePanel;
      if (panel) {
        panel.update(data);
      }
    } catch (e) {
      console.error('[SolanaApp] Failed to load governance data:', e);
    } finally {
      this.inFlight.delete('governance-data');
    }
  }

  // =========================================================================
  // REFRESH INTERVALS
  // =========================================================================

  private scheduleRefresh(
    key: string,
    fn: () => Promise<void>,
    intervalMs: number,
    guard?: () => boolean
  ): void {
    const tick = async () => {
      if (this.isDestroyed) return;
      if (guard && !guard()) {
        this.refreshTimeoutIds.set(key, setTimeout(tick, intervalMs));
        return;
      }
      if (!this.isIdle) {
        try { await fn(); } catch (e) { console.error(`[Refresh] ${key} failed:`, e); }
      }
      this.refreshTimeoutIds.set(key, setTimeout(tick, intervalMs));
    };
    this.refreshTimeoutIds.set(key, setTimeout(tick, intervalMs));
  }

  private setupRefreshIntervals(): void {
    // Core Solana data — fast intervals
    this.scheduleRefresh('solana-network', () => this.loadSolanaNetwork(), REFRESH_INTERVALS.solanaNetwork);
    this.scheduleRefresh('token-data', () => this.loadTokenData(), REFRESH_INTERVALS.tokenRadar);
    this.scheduleRefresh('mev-data', () => this.loadMevData(), REFRESH_INTERVALS.mev);

    // DeFi & staking — moderate intervals
    this.scheduleRefresh('defi-data', () => this.loadDeFiData(), REFRESH_INTERVALS.defi);
    this.scheduleRefresh('lst-data', () => this.loadLSTData(), REFRESH_INTERVALS.liquidStaking);
    this.scheduleRefresh('nft-data', () => this.loadNftData(), REFRESH_INTERVALS.nft);
    this.scheduleRefresh('governance-data', () => this.loadGovernanceData(), REFRESH_INTERVALS.defi);

    // News and markets — moderate intervals
    this.scheduleRefresh('news', () => this.loadNews(), REFRESH_INTERVALS.feeds);
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  private setupEventListeners(): void {
    // Token analyze event from TokenAnalyzePanel
    this.container.addEventListener('token-analyze', async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mint) {
        const panel = this.panels['token-analyze'] as TokenAnalyzePanel;
        if (!panel) return;
        panel.setInputValue(detail.mint);
        panel.setLoading();

        // Run token analysis and X sentiment in parallel
        const analyzePromise = analyzeTokenCA(detail.mint);
        const sentimentPromise = fetchSentimentReport(detail.mint);

        // Handle token analysis
        try {
          const result = await analyzePromise;
          if (result) {
            panel.setAnalysis(result);
          } else {
            panel.setError('Token not found or no liquidity pairs available. Check the CA and try again.');
          }
        } catch (err) {
          panel.setError('Analysis failed. Please try again.');
          console.error('[TokenAnalyze] Error:', err);
        }

        // Handle sentiment (non-blocking)
        try {
          const sentiment = await sentimentPromise;
          panel.setSentimentReport(sentiment);
        } catch (err) {
          panel.setSentimentError('Sentiment analysis failed.');
          console.error('[XSentiment] Error:', err);
        }
      }
    });

    // Theme toggle
    const themeBtn = document.getElementById('headerThemeToggle');

    // Mobile desktop notice dismiss
    const mobileNoticeClose = document.getElementById('mobileNoticeClose');
    mobileNoticeClose?.addEventListener('click', () => {
      mobileNoticeClose.closest('.mobile-desktop-notice')?.classList.add('hidden');
    });

    themeBtn?.addEventListener('click', () => {
      const current = getCurrentTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
      themeBtn.innerHTML = next === 'dark'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
    });

    // CA copy button
    const caBtn = document.getElementById('headerCABtn');
    const caAddr = document.getElementById('headerCAAddr');
    caBtn?.addEventListener('click', () => {
      const addr = caAddr?.textContent?.trim();
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
        caBtn.classList.add('copied');
        const orig = caAddr!.textContent;
        caAddr!.textContent = 'Copied!';
        setTimeout(() => {
          caBtn.classList.remove('copied');
          caAddr!.textContent = orig!;
        }, 1000);
      }).catch(() => {});
    });

    // Settings modal
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const modalClose = document.getElementById('modalClose');
    settingsBtn?.addEventListener('click', () => settingsModal?.classList.add('visible'));
    modalClose?.addEventListener('click', () => settingsModal?.classList.remove('visible'));
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('visible');
    });

    // Fullscreen
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    fullscreenBtn?.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });

    // Keyboard shortcuts
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      // Reserve Cmd+K for future search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this.boundKeydownHandler);

    // Idle detection
    this.boundIdleResetHandler = () => {
      if (this.isIdle) {
        this.isIdle = false;
        console.log('[SolanaApp] User active — resuming updates');
      }
      if (this.idleTimeoutId) clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = setTimeout(() => {
        this.isIdle = true;
        console.log('[SolanaApp] User idle — pausing updates');
      }, this.IDLE_PAUSE_MS);
    };
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler!);
    });
    this.boundIdleResetHandler();

    // Resize handler
    this.boundResizeHandler = debounce(() => {
      this.isMobile = isMobileDevice();
    }, 300);
    window.addEventListener('resize', this.boundResizeHandler);
  }

  // =========================================================================
  // PANEL SETTINGS (TOGGLES)
  // =========================================================================

  private renderPanelToggles(): void {
    const grid = document.getElementById('panelToggles');
    if (!grid) return;

    grid.innerHTML = Object.entries(this.panelSettings)
      .filter(([key]) => key !== 'map')
      .map(([key, config]) => `
        <label class="panel-toggle">
          <input type="checkbox" data-panel="${escapeHtml(key)}" ${config.enabled ? 'checked' : ''} />
          <span>${escapeHtml(config.name)}</span>
        </label>
      `).join('');

    grid.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const key = input.dataset.panel;
      if (key && this.panelSettings[key]) {
        this.panelSettings[key].enabled = input.checked;
        saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
        this.applyPanelSettings();
      }
    });
  }

  private applyPanelSettings(): void {
    Object.entries(this.panelSettings).forEach(([key, config]) => {
      if (key === 'map') return;
      const panel = this.panels[key];
      if (panel) {
        const el = panel.getElement();
        el.style.display = config.enabled ? '' : 'none';
      }
    });
  }

  // =========================================================================
  // MOBILE WARNING
  // =========================================================================

  private setupMobileWarning(): void {
    if (this.isMobile) {
      new MobileWarningModal();
    }
  }

  // =========================================================================
  // DRAG AND DROP
  // =========================================================================

  private makeDraggable(element: HTMLElement, key: string): void {
    element.draggable = true;

    element.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', key);
      element.classList.add('dragging');
    });

    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      this.savePanelOrder();
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      element.classList.add('drag-over');
    });

    element.addEventListener('dragleave', () => {
      element.classList.remove('drag-over');
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');
      const draggedKey = e.dataTransfer?.getData('text/plain');
      if (!draggedKey || draggedKey === key) return;

      const grid = document.getElementById('panelsGrid');
      if (!grid) return;

      const draggedEl = grid.querySelector(`[data-panel="${draggedKey}"]`);
      if (draggedEl) {
        grid.insertBefore(draggedEl, element);
        this.savePanelOrder();
      }
    });
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  private savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  public destroy(): void {
    this.isDestroyed = true;

    for (const timeoutId of this.refreshTimeoutIds.values()) {
      clearTimeout(timeoutId);
    }
    this.refreshTimeoutIds.clear();

    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
    }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    if (this.idleTimeoutId) clearTimeout(this.idleTimeoutId);
    if (this.boundIdleResetHandler) {
      ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
        document.removeEventListener(event, this.boundIdleResetHandler!);
      });
    }

    // TODO: this.map?.destroy() when Solana globe is implemented
    this.globeModeSwitcher?.destroy();
    this.solanaGlobe?.destroy();
  }
}
