// SolanaDeckGlobe — deck.gl + MapLibre GL globe with 4 visualization modes
// Replaces the Canvas 2D SolanaGlobe with GPU-accelerated WebGL rendering
//
// Modes:
//   1. Validators — ScatterplotLayer + HeatmapLayer for stake distribution
//   2. DePIN      — ScatterplotLayer for Helium/Render/IoNet/Hivemapper nodes
//   3. Risk       — HeatmapLayer + ScatterplotLayer for DC concentration
//   4. DeFi       — ScatterplotLayer + TextLayer for protocol TVL bubbles

import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

import type { GlobeMode } from './GlobeModeSwitcher';
import type { SolanaValidator, ValidatorCluster, DePINNode, MapLayers } from '@/types';
import { fetchValidatorGeoData, getDatacenterConcentration, getValidatorStats } from '@/services/validator-geo';
import { fetchDePINNodes, getDePINStats, DEPIN_NETWORK_INFO } from '@/services/depin-geo';


// ── Color palette ──────────────────────────────────────────────────────────
const COLORS = {
  solanaGreen: [20, 241, 149] as [number, number, number],
  solanaPurple: [153, 69, 255] as [number, number, number],
  cyan: [0, 209, 255] as [number, number, number],
  gold: [255, 215, 0] as [number, number, number],
  red: [255, 80, 80] as [number, number, number],
  orange: [255, 165, 0] as [number, number, number],
  pink: [255, 105, 180] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],

  // Client type colors
  jito: [255, 165, 0] as [number, number, number],        // orange
  solanaLabs: [20, 241, 149] as [number, number, number],  // green
  firedancer: [0, 209, 255] as [number, number, number],   // cyan

  // DePIN network colors
  'helium-iot': [20, 241, 149] as [number, number, number],
  'helium-mobile': [0, 255, 200] as [number, number, number],
  render: [255, 105, 180] as [number, number, number],
  ionet: [0, 209, 255] as [number, number, number],
  hivemapper: [255, 215, 0] as [number, number, number],
  grass: [120, 255, 80] as [number, number, number],
  geodnet: [255, 165, 0] as [number, number, number],
  nosana: [180, 100, 255] as [number, number, number],
  shadow: [200, 200, 220] as [number, number, number],

  // Risk
  riskLow: [20, 241, 149] as [number, number, number],
  riskMed: [255, 215, 0] as [number, number, number],
  riskHigh: [255, 80, 80] as [number, number, number],
};

// ── Data state ─────────────────────────────────────────────────────────────
interface GlobeData {
  validators: SolanaValidator[];
  clusters: ValidatorCluster[];
  depinNodes: DePINNode[];
  // DeFi bubbles
  defiBubbles: DeFiBubble[];
}

interface DeFiBubble {
  name: string;
  lat: number;
  lon: number;
  tvl: number;
  change24h: number;
  change7d: number;
  category: string;
  slug: string;
}

// ── DeFi category → map zone mapping ─────────────────────────────────────────
// Each category gets a geographic zone on the map for visual clustering.
// Protocols within a category are spread using golden-angle spiral placement.
// ── Category colors for DeFi legend/tooltip (kept for styling) ──
const CATEGORY_COLORS: Record<string, string> = {
  'Dexes': '#14F195', 'DEX': '#14F195', 'Dexs': '#14F195',
  'Lending': '#00D1FF',
  'Liquid Staking': '#FFD700', 'LST': '#FFD700',
  'Derivatives': '#FF69B4', 'Perps': '#FF69B4',
  'Yield': '#B464FF', 'Yield Aggregator': '#B464FF',
  'Bridge': '#FFA500',
  'CDP': '#00FFC8',
  'Oracle': '#C8C8DC',
  'NFT Marketplace': '#FF5050', 'NFT': '#FF5050', 'NFT Lending': '#FF5050',
  'Payments': '#78FF50',
  'Reserve Currency': '#E0E0FF',
  'Options': '#FF8844',
  'Launchpad': '#AADDFF',
  'RWA': '#DDFF88',
  'Insurance': '#88CCFF',
  'CEX': '#FF4444',
  'Risk Curators': '#C8A2FF',
  'Liquid Restaking': '#E5A100',
  'Basis Trading': '#44DDBB',
};
const DEFAULT_CAT_COLOR = '#888888';

// ── Real HQ / founding-team locations for known Solana DeFi protocols ──
// Key = DeFi Llama slug.  Coords = operational HQ city (NOT small-island
// registration addresses like Curaçao/Cayman/BVI/Seychelles — those tiny
// islands appear as ocean on globe maps).
const PROTOCOL_HQ: Record<string, { lat: number; lon: number }> = {
  // ─── CEX — Centralized Exchanges ───
  'binance-cex':            { lat: 25.20,  lon: 55.27 },   // Dubai, UAE
  'okx':                    { lat: 1.28,   lon: 103.85 },   // Singapore (ops HQ; reg. Seychelles)
  'bitfinex':               { lat: 22.28,  lon: 114.17 },   // Hong Kong (iFinex ops; reg. BVI)
  'bybit':                  { lat: 25.20,  lon: 55.30 },   // Dubai, UAE
  'bitget':                 { lat: 1.30,   lon: 103.82 },   // Singapore (ops HQ; reg. Seychelles)
  'htx':                    { lat: 1.35,   lon: 103.82 },   // Singapore (formerly Huobi)
  'gate':                   { lat: 22.32,  lon: 114.17 },   // Hong Kong (ops; reg. Cayman)
  'mexc':                   { lat: 1.30,   lon: 103.85 },   // Singapore
  'deribit':                { lat: 52.08,  lon: 5.12 },     // Utrecht, Netherlands
  'kucoin':                 { lat: 1.27,   lon: 103.84 },   // Singapore (ops; reg. Seychelles)
  'hashkey-exchange':       { lat: 22.28,  lon: 114.16 },   // Hong Kong
  'bitkub':                 { lat: 13.76,  lon: 100.50 },   // Bangkok, Thailand
  'bitstamp':               { lat: 49.61,  lon: 6.13 },     // Luxembourg City (EU HQ)
  'bitmex':                 { lat: 47.37,  lon: 8.55 },     // Zurich, Switzerland (ops; reg. Seychelles)
  'swissborg':              { lat: 46.52,  lon: 6.63 },     // Lausanne, Switzerland
  'bingx':                  { lat: 1.29,   lon: 103.85 },   // Singapore
  'osl-hk':                 { lat: 22.28,  lon: 114.17 },   // Hong Kong
  'indodax':                { lat: -6.21,  lon: 106.85 },   // Jakarta, Indonesia
  'phemex':                 { lat: 1.30,   lon: 103.84 },   // Singapore
  'backpack':               { lat: 1.35,   lon: 103.82 },   // Singapore (Armani Ferrante)

  // ─── Liquid Staking ───
  'lido':                   { lat: 47.37,  lon: 8.54 },     // Zurich, Switzerland (Lido DAO)
  'doublezero-staked-sol':  { lat: 30.27,  lon: -97.74 },   // Austin, TX (Jump/DoubleZero team)
  'jito-liquid-staking':    { lat: 40.75,  lon: -73.99 },   // New York (Jito Labs)
  'sanctum-validator-lsts': { lat: 1.30,   lon: 103.82 },   // Singapore (Sanctum)
  'jupiter-staked-sol':     { lat: 1.35,   lon: 103.87 },   // Singapore (Jupiter / Meow)
  'binance-staked-sol':     { lat: 25.20,  lon: 55.25 },   // Dubai (Binance)
  'marinade-liquid-staking':{ lat: 50.08,  lon: 14.43 },   // Prague, Czech Republic

  // ─── RWA ───
  'blackrock-buidl':        { lat: 40.76,  lon: -73.97 },   // New York (BlackRock 50 Hudson Yards)
  'ondo-yield-assets':      { lat: 40.76,  lon: -73.98 },   // New York (Ondo Finance)
  'superstate-ustb':        { lat: 37.78,  lon: -122.41 },  // San Francisco
  'ondo-global-markets':    { lat: 40.76,  lon: -73.96 },   // New York (Ondo Finance)
  'hastra':                 { lat: 25.20,  lon: 55.28 },    // Dubai

  // ─── Lending ───
  'maple':                  { lat: -33.87, lon: 151.21 },   // Sydney, Australia
  'kamino-lend':            { lat: 38.72,  lon: -9.14 },    // Lisbon, Portugal (Kamino team)
  'jupiter-lend':           { lat: 1.35,   lon: 103.85 },   // Singapore (Jupiter)

  // ─── Risk Curators ───
  'sentora':                { lat: 37.78,  lon: -122.40 },  // San Francisco (formerly Solend)
  'gauntlet':               { lat: 40.75,  lon: -74.00 },   // New York

  // ─── Bridge ───
  'portal':                 { lat: 37.79,  lon: -122.40 },  // San Francisco (Wormhole/xLabs)
  'solvbtc':                { lat: 1.30,   lon: 103.83 },   // Singapore (Solv Protocol)
  'aster-bridge':           { lat: 35.68,  lon: 139.69 },   // Tokyo, Japan (Astar Network)
  'unit':                   { lat: 51.51,  lon: -0.12 },    // London

  // ─── Dexes ───
  'raydium-amm':            { lat: 1.30,   lon: 103.85 },   // Singapore
  'pancakeswap-amm-v3':     { lat: 1.35,   lon: 103.82 },   // Singapore
  'meteora-dlmm':           { lat: 1.32,   lon: 103.80 },   // Singapore (Ben Chow)
  'orca-dex':               { lat: 47.61,  lon: -122.33 },  // Seattle, WA

  // ─── Derivatives ───
  'jupiter-perpetual-exchange': { lat: 1.35, lon: 103.82 }, // Singapore (Jupiter / Meow)
  'drift-trade':            { lat: -33.86, lon: 151.21 },   // Sydney, Australia

  // ─── Liquid Restaking ───
  'renzo':                  { lat: 37.78,  lon: -122.39 },  // San Francisco

  // ─── Basis Trading ───
  'solstice-usx':           { lat: 1.30,   lon: 103.82 },   // Singapore
  'bouncebit-cedefi-yield': { lat: 1.35,   lon: 103.85 },   // Singapore
};

// Assign coordinates: use real HQ if known, else spread by category fallback
function assignCategoryPosition(protocols: Array<{ name: string; slug: string; tvl: number; change24h: number; change7d: number; category: string }>): DeFiBubble[] {
  // Track per-city overlap to nudge colliding pins
  const cityHits = new Map<string, number>();

  return protocols.map(p => {
    const hq = PROTOCOL_HQ[p.slug];
    let lat: number, lon: number;

    if (hq) {
      // Real HQ — add tiny jitter if multiple protocols share same city
      const cityKey = `${Math.round(hq.lat)},${Math.round(hq.lon)}`;
      const idx = cityHits.get(cityKey) || 0;
      cityHits.set(cityKey, idx + 1);
      const angle = idx * 137.508 * (Math.PI / 180);
      const r = idx * 0.35; // ~0.35° per extra protocol in same city
      lat = hq.lat + r * Math.sin(angle);
      lon = hq.lon + r * Math.cos(angle);
    } else {
      // Unknown protocol — place in ocean by category hash to avoid land overlap
      const hash = p.name.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
      lat = -20 + (hash % 30);          // -20 to +10 (South Pacific)
      lon = -160 + ((hash * 7) % 40);   // -160 to -120
    }

    return {
      name: p.name,
      slug: p.slug,
      lat,
      lon,
      tvl: p.tvl,
      change24h: p.change24h,
      change7d: p.change7d,
      category: p.category,
    };
  });
}

let defiLocationsCache: DeFiBubble[] | null = null;
let defiCacheTs = 0;

async function fetchDefiLocations(): Promise<DeFiBubble[]> {
  const now = Date.now();
  if (defiLocationsCache && now - defiCacheTs < 300_000) return defiLocationsCache;

  try {
    // Use proxy to avoid CORS
    const res = await fetch('/api/defi-data', { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      if (data.protocols && data.protocols.length > 0) {
        const protocols = data.protocols.map((p: any) => ({
          name: p.name,
          slug: p.slug || '',
          tvl: p.tvl || 0,
          change24h: p.change24h || 0,
          change7d: p.change7d || 0,
          category: p.category || 'Other',
        }));
        const locations = assignCategoryPosition(protocols);
        defiLocationsCache = locations;
        defiCacheTs = now;
        console.log(`[DeFi] Loaded ${locations.length} protocols from proxy`);
        return locations;
      }
    }
  } catch (e) {
    console.warn('[DeFi] Proxy fetch failed:', (e as Error).message);
  }

  // Fallback: direct fetch (may fail due to CORS)
  try {
    const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const allProtocols: any[] = await res.json();
      const solana = allProtocols
        .filter(p => p.chains?.includes('Solana'))
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 50)
        .map(p => ({
          name: p.name,
          slug: p.slug || '',
          tvl: p.tvl || 0,
          change24h: p.change_1d || 0,
          change7d: p.change_7d || 0,
          category: p.category || 'Other',
        }));
      const locations = assignCategoryPosition(solana);
      defiLocationsCache = locations;
      defiCacheTs = now;
      console.log(`[DeFi] Loaded ${locations.length} protocols (direct)`);
      return locations;
    }
  } catch {
    // Both paths failed
  }

  console.warn('[DeFi] All fetch paths failed, returning empty');
  return defiLocationsCache || [];
}

// ── MapLibre dark style (original worldmonitor basemap — CARTO dark_all) ────
// Uses the exact same tile source as the original DeckGLMap.ts from the fork.
// CARTO dark_all includes country names, borders, labels, ocean — no extra layers needed.
const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
};

// ============================================================================
// MAIN GLOBE CLASS
// ============================================================================
export class SolanaDeckGlobe {
  private container: HTMLElement;
  private mapDiv: HTMLElement;
  private map: maplibregl.Map | null = null;
  private deckOverlay: MapboxOverlay | null = null;
  private currentMode: GlobeMode = 'validators';
  private data: GlobeData = {
    validators: [],
    clusters: [],
    depinNodes: [],
    defiBubbles: [], // populated by fetchDefiLocations()
  };
  private statsOverlay: HTMLElement;
  private legendOverlay: HTMLElement;
  private tooltipEl: HTMLElement;
  private filterPanel: HTMLElement;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  // ── Validator filters ─────────────────────────────────────────────────
  private showDelinquent = false;
  private clientFilters: Record<string, boolean> = {
    jito: true,
    firedancer: true,
    'solana-labs': true,
    unknown: true,
  };

  // ── DePIN filters ─────────────────────────────────────────────────────
  private showOfflineDePIN = false;
  private depinNetworkFilters: Record<string, boolean> = {
    'helium-iot': true,
    'helium-mobile': true,
    render: true,
    ionet: true,
    hivemapper: true,
    grass: true,
    geodnet: true,
    nosana: true,
    shadow: true,
  };

  // ── Risk filters ──────────────────────────────────────────────────────
  private showRiskHeatmap = true;
  private showRiskClusters = true;
  private showRiskDelinquent = true;
  private riskLevelFilters: Record<string, boolean> = {
    safe: true,
    warning: true,
    'high-risk': true,
  };

  // ── DeFi filters ──────────────────────────────────────────────────────
  private defiCategoryFilters: Record<string, boolean> = {};
  private defiShowLabels = true;
  private defiMinTvl = 0; // show all by default

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('deckgl-mode');

    // Create map wrapper
    this.mapDiv = document.createElement('div');
    this.mapDiv.className = 'deckgl-map-wrapper';
    this.mapDiv.id = 'deckgl-basemap';
    this.container.appendChild(this.mapDiv);

    // Stats overlay
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.className = 'deckgl-stats-overlay';
    this.container.appendChild(this.statsOverlay);

    // Legend
    this.legendOverlay = document.createElement('div');
    this.legendOverlay.className = 'deckgl-legend';
    this.container.appendChild(this.legendOverlay);

    // Tooltip
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'deckgl-tooltip';
    this.tooltipEl.style.cssText = 'position: absolute; display: none; pointer-events: none; z-index: 1000;';
    this.container.appendChild(this.tooltipEl);

    // Filter panel (left side)
    this.filterPanel = document.createElement('div');
    this.filterPanel.className = 'deckgl-filter-panel';
    this.container.appendChild(this.filterPanel);
    this.buildFilterPanel();

    this.initMap();
    this.loadData();
  }

  // ── Initialize MapLibre + deck.gl ─────────────────────────────────────────
  private initMap(): void {
    this.map = new maplibregl.Map({
      container: this.mapDiv,
      style: DARK_STYLE,
      center: [20, 25],
      zoom: 1.5,
      minZoom: 1,
      maxZoom: 12,
      attributionControl: false,
    });

    // Add attribution
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Initialize deck.gl overlay
    this.deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });

    this.map.addControl(this.deckOverlay as unknown as maplibregl.IControl);

    this.map.on('load', () => {
      console.log('[DeckGlobe] MapLibre loaded');
      this.updateLayers();
      this.startAnimation();
    });

    this.map.on('error', (e: unknown) => {
      console.warn('[DeckGlobe] MapLibre error:', e);
    });
  }

  // ── Load data for all modes ───────────────────────────────────────────────
  private async loadData(): Promise<void> {
    try {
      const [validatorData, depinNodes, defiLocations] = await Promise.all([
        fetchValidatorGeoData(),
        fetchDePINNodes(),
        fetchDefiLocations(),
      ]);

      this.data.validators = validatorData.validators;
      this.data.clusters = validatorData.clusters;
      this.data.depinNodes = depinNodes;
      this.data.defiBubbles = defiLocations;

      console.log(`[DeckGlobe] Data loaded: ${this.data.validators.length} validators, ${this.data.depinNodes.length} DePIN nodes`);
      this.updateLayers();
      this.updateOverlays();
    } catch (err) {
      console.error('[DeckGlobe] Data load failed:', err);
    }
  }

  // ── Build deck.gl layers based on current mode ────────────────────────────
  private updateLayers(): void {
    if (!this.deckOverlay || this.isDestroyed) return;

    const layers = this.buildLayersForMode(this.currentMode);
    this.deckOverlay.setProps({ layers });
    this.updateOverlays();
  }

  private buildLayersForMode(mode: GlobeMode): Layer[] {
    switch (mode) {
      case 'validators': return this.buildValidatorLayers();
      case 'depin': return this.buildDePINLayers();
      case 'risk': return this.buildRiskLayers();
      case 'defi': return this.buildDeFiLayers();
      default: return this.buildValidatorLayers();
    }
  }

  // ── Filter helpers ────────────────────────────────────────────────────────
  private getFilteredValidators(): SolanaValidator[] {
    return this.data.validators.filter(v => {
      // Delinquent filter
      if (v.delinquent && !this.showDelinquent) return false;
      // Client type filter
      const ct = v.clientType || 'unknown';
      if (!this.clientFilters[ct]) return false;
      return true;
    });
  }

  // ── Build filter panel (left side) ────────────────────────────────────────
  private buildFilterPanel(): void {
    if (this.currentMode === 'depin') {
      this.buildDePINFilterPanel();
    } else if (this.currentMode === 'risk') {
      this.buildRiskFilterPanel();
    } else if (this.currentMode === 'defi') {
      this.buildDeFiFilterPanel();
    } else {
      this.buildValidatorFilterPanel();
    }
  }

  private buildValidatorFilterPanel(): void {
    const clientItems = [
      { key: 'jito', label: 'Jito', color: '#FFA500', icon: '●' },
      { key: 'firedancer', label: 'Firedancer', color: '#00D1FF', icon: '●' },
      { key: 'solana-labs', label: 'Agave', color: '#14F195', icon: '●' },
      { key: 'unknown', label: 'Unknown', color: '#888', icon: '●' },
    ];

    this.filterPanel.innerHTML = `
      <div class="filter-title">FILTERS</div>
      <div class="filter-section">
        <div class="filter-section-label">Client Type</div>
        ${clientItems.map(c => `
          <label class="filter-toggle" data-filter="client" data-key="${c.key}">
            <input type="checkbox" ${this.clientFilters[c.key] ? 'checked' : ''} />
            <span class="filter-dot" style="color:${c.color}">${c.icon}</span>
            <span class="filter-label">${c.label}</span>
            <span class="filter-count" id="filter-count-${c.key}">0</span>
          </label>
        `).join('')}
      </div>
      <div class="filter-section">
        <div class="filter-section-label">Status</div>
        <label class="filter-toggle" data-filter="delinquent">
          <input type="checkbox" ${this.showDelinquent ? 'checked' : ''} />
          <span class="filter-dot" style="color:#FF5050">●</span>
          <span class="filter-label">Include Delinquent</span>
          <span class="filter-count" id="filter-count-delinquent">0</span>
        </label>
      </div>
    `;

    // Wire up events
    this.filterPanel.querySelectorAll('label.filter-toggle').forEach(label => {
      const input = label.querySelector('input') as HTMLInputElement;
      const filterType = label.getAttribute('data-filter');
      input.addEventListener('change', () => {
        if (filterType === 'client') {
          const key = label.getAttribute('data-key')!;
          this.clientFilters[key] = input.checked;
        } else if (filterType === 'delinquent') {
          this.showDelinquent = input.checked;
        }
        this.updateLayers();
      });
    });
  }

  private buildDePINFilterPanel(): void {
    const networkItems = [
      { key: 'helium-iot', label: 'Helium IoT', color: '#14F195' },
      { key: 'helium-mobile', label: 'Helium Mobile', color: '#00FFC8' },
      { key: 'render', label: 'Render', color: '#FF69B4' },
      { key: 'ionet', label: 'io.net', color: '#00D1FF' },
      { key: 'hivemapper', label: 'Hivemapper', color: '#FFD700' },
      { key: 'grass', label: 'Grass', color: '#78FF50' },
      { key: 'geodnet', label: 'Geodnet', color: '#FFA500' },
      { key: 'nosana', label: 'Nosana', color: '#B464FF' },
      { key: 'shadow', label: 'Shadow', color: '#C8C8DC' },
    ];

    this.filterPanel.innerHTML = `
      <div class="filter-title">DePIN FILTERS</div>
      <div class="filter-section">
        <div class="filter-section-label">Networks</div>
        ${networkItems.map(n => `
          <label class="filter-toggle" data-filter="depin-network" data-key="${n.key}">
            <input type="checkbox" ${this.depinNetworkFilters[n.key] ? 'checked' : ''} />
            <span class="filter-dot" style="color:${n.color}">●</span>
            <span class="filter-label">${n.label}</span>
            <span class="filter-count" id="filter-count-depin-${n.key}">0</span>
          </label>
        `).join('')}
      </div>
      <div class="filter-section">
        <div class="filter-section-label">Status</div>
        <label class="filter-toggle" data-filter="depin-offline">
          <input type="checkbox" ${this.showOfflineDePIN ? 'checked' : ''} />
          <span class="filter-dot" style="color:#FF5050">●</span>
          <span class="filter-label">Include Offline</span>
          <span class="filter-count" id="filter-count-depin-offline">0</span>
        </label>
      </div>
    `;

    // Wire up events
    this.filterPanel.querySelectorAll('label.filter-toggle').forEach(label => {
      const input = label.querySelector('input') as HTMLInputElement;
      const filterType = label.getAttribute('data-filter');
      input.addEventListener('change', () => {
        if (filterType === 'depin-network') {
          const key = label.getAttribute('data-key')!;
          this.depinNetworkFilters[key] = input.checked;
        } else if (filterType === 'depin-offline') {
          this.showOfflineDePIN = input.checked;
        }
        this.updateLayers();
      });
    });
  }

  private updateFilterCounts(): void {
    const all = this.data.validators;
    // Client counts (among visible = respecting delinquent toggle)
    const visibleBase = this.showDelinquent ? all : all.filter(v => !v.delinquent);
    const counts: Record<string, number> = { jito: 0, firedancer: 0, 'solana-labs': 0, unknown: 0 };
    for (const v of visibleBase) {
      const ct = v.clientType || 'unknown';
      counts[ct] = (counts[ct] || 0) + 1;
    }
    for (const key of Object.keys(counts)) {
      const el = this.filterPanel.querySelector(`#filter-count-${key}`);
      if (el) el.textContent = String(counts[key]);
    }
    // Delinquent count
    const delEl = this.filterPanel.querySelector('#filter-count-delinquent');
    if (delEl) delEl.textContent = String(all.filter(v => v.delinquent).length);
  }

  private updateDePINFilterCounts(): void {
    const allDepin = this.data.depinNodes;
    const netCounts: Record<string, number> = {};
    let offlineCount = 0;
    for (const n of allDepin) {
      if (n.status === 'offline') { offlineCount++; continue; }
      netCounts[n.network] = (netCounts[n.network] || 0) + 1;
    }
    for (const key of Object.keys(this.depinNetworkFilters)) {
      const el = this.filterPanel.querySelector(`#filter-count-depin-${key}`);
      if (el) el.textContent = String(netCounts[key] || 0);
    }
    const offEl = this.filterPanel.querySelector('#filter-count-depin-offline');
    if (offEl) offEl.textContent = String(offlineCount);
  }

  // ── Risk filter panel ─────────────────────────────────────────────────────
  private buildRiskFilterPanel(): void {
    const riskItems = [
      { key: 'safe', label: 'Safe (<3%)', color: '#14F195' },
      { key: 'warning', label: 'Warning (3-10%)', color: '#FFD700' },
      { key: 'high-risk', label: 'High Risk (>10%)', color: '#FF5050' },
    ];

    this.filterPanel.innerHTML = `
      <div class="filter-title">RISK FILTERS</div>
      <div class="filter-section">
        <div class="filter-section-label">Risk Level</div>
        ${riskItems.map(r => `
          <label class="filter-toggle" data-filter="risk-level" data-key="${r.key}">
            <input type="checkbox" ${this.riskLevelFilters[r.key] ? 'checked' : ''} />
            <span class="filter-dot" style="color:${r.color}">●</span>
            <span class="filter-label">${r.label}</span>
            <span class="filter-count" id="filter-count-risk-${r.key}">0</span>
          </label>
        `).join('')}
      </div>
      <div class="filter-section">
        <div class="filter-section-label">Layers</div>
        <label class="filter-toggle" data-filter="risk-heatmap">
          <input type="checkbox" ${this.showRiskHeatmap ? 'checked' : ''} />
          <span class="filter-dot" style="color:#FF8800">◉</span>
          <span class="filter-label">Heatmap</span>
        </label>
        <label class="filter-toggle" data-filter="risk-clusters">
          <input type="checkbox" ${this.showRiskClusters ? 'checked' : ''} />
          <span class="filter-dot" style="color:#FFD700">●</span>
          <span class="filter-label">Cluster Markers</span>
        </label>
        <label class="filter-toggle" data-filter="risk-delinquent">
          <input type="checkbox" ${this.showRiskDelinquent ? 'checked' : ''} />
          <span class="filter-dot" style="color:#FF0000">●</span>
          <span class="filter-label">Delinquent</span>
          <span class="filter-count" id="filter-count-risk-delinquent">0</span>
        </label>
      </div>
    `;

    // Wire up events
    this.filterPanel.querySelectorAll('label.filter-toggle').forEach(label => {
      const input = label.querySelector('input') as HTMLInputElement;
      const filterType = label.getAttribute('data-filter');
      input.addEventListener('change', () => {
        if (filterType === 'risk-level') {
          const key = label.getAttribute('data-key')!;
          this.riskLevelFilters[key] = input.checked;
        } else if (filterType === 'risk-heatmap') {
          this.showRiskHeatmap = input.checked;
        } else if (filterType === 'risk-clusters') {
          this.showRiskClusters = input.checked;
        } else if (filterType === 'risk-delinquent') {
          this.showRiskDelinquent = input.checked;
        }
        this.updateLayers();
      });
    });
  }

  private updateRiskFilterCounts(): void {
    const clusters = this.data.clusters.filter(c => c.count >= 3);
    let safe = 0, warning = 0, highRisk = 0;
    for (const c of clusters) {
      if (c.stakeConcentration > 0.10) highRisk++;
      else if (c.stakeConcentration > 0.03) warning++;
      else safe++;
    }
    const safeEl = this.filterPanel.querySelector('#filter-count-risk-safe');
    if (safeEl) safeEl.textContent = String(safe);
    const warnEl = this.filterPanel.querySelector('#filter-count-risk-warning');
    if (warnEl) warnEl.textContent = String(warning);
    const hrEl = this.filterPanel.querySelector('#filter-count-risk-high-risk');
    if (hrEl) hrEl.textContent = String(highRisk);
    const delEl = this.filterPanel.querySelector('#filter-count-risk-delinquent');
    if (delEl) delEl.textContent = String(this.data.validators.filter(v => v.delinquent).length);
  }

  // ── Risk cluster filter helper ───────────────────────────────────────────
  private getFilteredRiskClusters(): ValidatorCluster[] {
    return this.data.clusters.filter(c => {
      if (c.count < 3) return false;
      if (c.stakeConcentration > 0.10) return this.riskLevelFilters['high-risk'];
      if (c.stakeConcentration > 0.03) return this.riskLevelFilters['warning'];
      return this.riskLevelFilters['safe'];
    });
  }

  // ── DeFi filter panel ─────────────────────────────────────────────────────
  private buildDeFiFilterPanel(): void {
    // Discover categories from loaded data
    const cats = new Set<string>();
    for (const d of this.data.defiBubbles) cats.add(d.category);
    const catList = [...cats].sort();

    // Initialize category filters on first load (all enabled)
    if (Object.keys(this.defiCategoryFilters).length === 0) {
      for (const c of catList) this.defiCategoryFilters[c] = true;
    }
    // Also enable any new categories
    for (const c of catList) {
      if (this.defiCategoryFilters[c] === undefined) this.defiCategoryFilters[c] = true;
    }

    const catItems = catList.map(cat => {
      return { key: cat, label: cat, color: CATEGORY_COLORS[cat] || DEFAULT_CAT_COLOR };
    });

    this.filterPanel.innerHTML = `
      <div class="filter-title">DeFi FILTERS</div>
      <div class="filter-section">
        <div class="filter-section-label">Categories</div>
        ${catItems.map(c => `
          <label class="filter-toggle" data-filter="defi-cat" data-key="${c.key}">
            <input type="checkbox" ${this.defiCategoryFilters[c.key] ? 'checked' : ''} />
            <span class="filter-dot" style="color:${c.color}">●</span>
            <span class="filter-label">${c.label}</span>
            <span class="filter-count" id="filter-count-defi-${c.key.replace(/\s+/g, '-')}">0</span>
          </label>
        `).join('')}
      </div>
      <div class="filter-section">
        <div class="filter-section-label">Display</div>
        <label class="filter-toggle" data-filter="defi-labels">
          <input type="checkbox" ${this.defiShowLabels ? 'checked' : ''} />
          <span class="filter-dot" style="color:#ffffff">A</span>
          <span class="filter-label">Protocol Labels</span>
        </label>
      </div>
    `;

    // Wire up events
    this.filterPanel.querySelectorAll('label.filter-toggle').forEach(label => {
      const input = label.querySelector('input') as HTMLInputElement;
      const filterType = label.getAttribute('data-filter');
      input.addEventListener('change', () => {
        if (filterType === 'defi-cat') {
          const key = label.getAttribute('data-key')!;
          this.defiCategoryFilters[key] = input.checked;
        } else if (filterType === 'defi-labels') {
          this.defiShowLabels = input.checked;
        }
        this.updateLayers();
      });
    });
  }

  private updateDeFiFilterCounts(): void {
    const all = this.data.defiBubbles;
    const catCounts: Record<string, number> = {};
    for (const d of all) {
      catCounts[d.category] = (catCounts[d.category] || 0) + 1;
    }
    for (const cat of Object.keys(this.defiCategoryFilters)) {
      const el = this.filterPanel.querySelector(`#filter-count-defi-${cat.replace(/\s+/g, '-')}`);
      if (el) el.textContent = String(catCounts[cat] || 0);
    }
  }

  // ── DeFi filter helper ────────────────────────────────────────────────────
  private getFilteredDeFiBubbles(): DeFiBubble[] {
    return this.data.defiBubbles.filter(d => {
      if (!this.defiCategoryFilters[d.category]) return false;
      if (d.tvl < this.defiMinTvl) return false;
      return true;
    });
  }

  // ── DePIN filter helper ──────────────────────────────────────────────────
  private getFilteredDePINNodes(): DePINNode[] {
    return this.data.depinNodes.filter(n => {
      // Network filter
      if (!this.depinNetworkFilters[n.network]) return false;
      // Offline filter
      if (n.status === 'offline' && !this.showOfflineDePIN) return false;
      return true;
    });
  }

  // ── MODE 1: VALIDATORS ────────────────────────────────────────────────────
  private buildValidatorLayers(): Layer[] {
    const layers: Layer[] = [];
    const filtered = this.getFilteredValidators();
    const activeFiltered = filtered.filter(v => !v.delinquent);

    // Stake heatmap — subtle background glow showing concentration
    if (activeFiltered.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: 'validator-heatmap',
          data: activeFiltered,
          getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
          getWeight: (d: SolanaValidator) => Math.sqrt(d.activatedStake) / 800,
          radiusPixels: 35,
          intensity: 0.8,
          threshold: 0.08,
          colorRange: [
            [20, 241, 149, 15],   // barely visible green
            [20, 241, 149, 40],
            [153, 69, 255, 70],   // purple mid
            [255, 215, 0, 100],   // gold high
            [255, 80, 80, 140],   // red concentration
          ],
          opacity: 0.35,
        })
      );
    }

    // Validator dots — small, clean pinpoints colored by client type
    layers.push(
      new ScatterplotLayer({
        id: 'validator-dots',
        data: filtered,
        getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
        getRadius: (d: SolanaValidator) => {
          const base = Math.log10(Math.max(d.activatedStake, 1) + 1) * 0.8;
          return Math.max(1.5, Math.min(base, 6));
        },
        getFillColor: (d: SolanaValidator) => {
          if (d.delinquent) return [...COLORS.red, 220] as [number, number, number, number];
          switch (d.clientType) {
            case 'jito': return [...COLORS.jito, 200] as [number, number, number, number];
            case 'firedancer': return [...COLORS.cyan, 220] as [number, number, number, number];
            default: return [...COLORS.solanaGreen, 180] as [number, number, number, number];
          }
        },
        getLineColor: [255, 255, 255, 20],
        lineWidthMinPixels: 0.3,
        stroked: true,
        radiusUnits: 'pixels' as const,
        radiusMinPixels: 1.5,
        radiusMaxPixels: 8,
        pickable: true,
        onHover: (info: { object?: SolanaValidator; x?: number; y?: number }) => this.handleHover(info),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 100],
      })
    );

    // Delinquent pulse ring — only when delinquent filter is on
    if (this.showDelinquent) {
      const delinquent = filtered.filter(v => v.delinquent);
      if (delinquent.length > 0) {
        const pulseSize = 1 + Math.sin(Date.now() / 300) * 0.25;
        layers.push(
          new ScatterplotLayer({
            id: 'delinquent-pulse',
            data: delinquent,
            getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
            getRadius: () => 5 * pulseSize,
            getFillColor: [255, 0, 0, 0],
            getLineColor: [255, 80, 80, 80],
            lineWidthMinPixels: 1,
            stroked: true,
            filled: false,
            radiusUnits: 'pixels' as const,
          })
        );
      }
    }

    return layers;
  }

  // ── MODE 2: DePIN ─────────────────────────────────────────────────────────
  private buildDePINLayers(): Layer[] {
    const layers: Layer[] = [];
    const filtered = this.getFilteredDePINNodes();

    const networkColor = (n: DePINNode): [number, number, number, number] => {
      const alpha = n.status === 'active' ? 180 : n.status === 'relay' ? 100 : 50;
      const colorKey = n.network as keyof typeof COLORS;
      const rgb = COLORS[colorKey] || COLORS.white;
      return [...rgb, alpha];
    };

    // DePIN heatmap (density) — only active filtered nodes
    const activeFiltered = filtered.filter(n => n.status === 'active');
    if (activeFiltered.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: 'depin-heatmap',
          data: activeFiltered,
          getPosition: (d: DePINNode) => [d.lon, d.lat],
          getWeight: () => 1,
          radiusPixels: 40,
          intensity: 2,
          threshold: 0.03,
          colorRange: [
            [20, 241, 149, 20],
            [20, 241, 149, 60],
            [0, 209, 255, 100],
            [153, 69, 255, 150],
            [255, 105, 180, 200],
          ],
          opacity: 0.4,
        })
      );
    }

    // Individual nodes — filtered
    layers.push(
      new ScatterplotLayer({
        id: 'depin-nodes',
        data: filtered,
        getPosition: (d: DePINNode) => [d.lon, d.lat],
        getRadius: (d: DePINNode) => {
          if (d.status === 'offline') return 2;
          return d.network === 'render' ? 5 : 3;
        },
        getFillColor: (d: DePINNode) => networkColor(d),
        radiusUnits: 'pixels' as const,
        radiusMinPixels: 1.5,
        radiusMaxPixels: 8,
        pickable: true,
        onHover: (info: { object?: DePINNode; x?: number; y?: number }) => this.handleHover(info),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
      })
    );

    return layers;
  }

  // ── MODE 3: RISK ──────────────────────────────────────────────────────────
  private buildRiskLayers(): Layer[] {
    const layers: Layer[] = [];
    const filteredClusters = this.getFilteredRiskClusters();

    // Concentration heatmap (stake amount = weight)
    if (this.showRiskHeatmap) {
      layers.push(
        new HeatmapLayer({
          id: 'risk-heatmap',
          data: this.data.clusters,
          getPosition: (d: ValidatorCluster) => [d.lon, d.lat],
          getWeight: (d: ValidatorCluster) => d.stakeConcentration * 100,
          radiusPixels: 60,
          intensity: 3,
          threshold: 0.05,
          colorRange: [
            [20, 241, 149, 30],   // safe (green)
            [255, 215, 0, 80],    // warning (gold)
            [255, 165, 0, 140],   // elevated (orange)
            [255, 80, 80, 200],   // high risk (red)
            [200, 0, 0, 255],     // critical (dark red)
          ],
          opacity: 0.7,
        })
      );
    }

    // Cluster size markers (bigger = more concentrated = more risky)
    if (this.showRiskClusters && filteredClusters.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'risk-clusters',
          data: filteredClusters,
          getPosition: (d: ValidatorCluster) => [d.lon, d.lat],
          getRadius: (d: ValidatorCluster) => Math.sqrt(d.count) * 4 + 5,
          getFillColor: (d: ValidatorCluster) => {
            if (d.stakeConcentration > 0.10) return [...COLORS.riskHigh, 180] as [number, number, number, number];
            if (d.stakeConcentration > 0.03) return [...COLORS.riskMed, 160] as [number, number, number, number];
            return [...COLORS.riskLow, 140] as [number, number, number, number];
          },
          getLineColor: (d: ValidatorCluster) =>
            d.stakeConcentration > 0.10 ? [255, 0, 0, 200] : [255, 255, 255, 40],
          lineWidthMinPixels: 1,
          stroked: true,
          radiusUnits: 'pixels' as const,
          radiusMinPixels: 5,
          radiusMaxPixels: 40,
          pickable: true,
          onHover: (info: { object?: ValidatorCluster; x?: number; y?: number }) => this.handleHover(info),
          autoHighlight: true,
        })
      );
    }

    // Delinquent validators overlay
    if (this.showRiskDelinquent) {
      const delinquent = this.data.validators.filter(v => v.delinquent);
      if (delinquent.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'delinquent-markers',
            data: delinquent,
            getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
            getRadius: 5,
            getFillColor: [255, 0, 0, 200],
            getLineColor: [255, 80, 80, 255],
            lineWidthMinPixels: 1,
            stroked: true,
            radiusUnits: 'pixels' as const,
            pickable: true,
            onHover: (info: { object?: SolanaValidator; x?: number; y?: number }) => this.handleHover(info),
          })
        );
      }
    }

    return layers;
  }

  // ── MODE 5: DeFi ──────────────────────────────────────────────────────────
  private buildDeFiLayers(): Layer[] {
    const layers: Layer[] = [];
    const filtered = this.getFilteredDeFiBubbles();
    const withTvl = filtered.filter(d => d.tvl > 0);

    // Helper: get category color for a protocol
    const getCatColor = (d: DeFiBubble): [number, number, number, number] => {
      const hex = CATEGORY_COLORS[d.category] || DEFAULT_CAT_COLOR;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b, 180];
    };

    // TVL bubbles — colored by category, sized by TVL
    if (withTvl.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'defi-bubbles',
          data: withTvl,
          getPosition: (d: DeFiBubble) => [d.lon, d.lat],
          getRadius: (d: DeFiBubble) => {
            const maxTvl = Math.max(...withTvl.map(x => x.tvl), 1);
            const norm = d.tvl / maxTvl;
            return 8 + norm * 35;
          },
          getFillColor: (d: DeFiBubble) => getCatColor(d),
          getLineColor: (d: DeFiBubble) => {
            if (d.change24h > 3) return [20, 241, 149, 200] as [number, number, number, number];
            if (d.change24h < -3) return [255, 80, 80, 200] as [number, number, number, number];
            return [255, 255, 255, 60] as [number, number, number, number];
          },
          lineWidthMinPixels: 1.5,
          stroked: true,
          radiusUnits: 'pixels' as const,
          radiusMinPixels: 6,
          radiusMaxPixels: 50,
          pickable: true,
          onHover: (info: { object?: DeFiBubble; x?: number; y?: number }) => this.handleHover(info),
          autoHighlight: true,
          highlightColor: [255, 255, 255, 60],
        })
      );
    }

    // Protocol name labels
    if (this.defiShowLabels) {
      layers.push(
        new TextLayer({
          id: 'defi-labels',
          data: filtered,
          getPosition: (d: DeFiBubble) => [d.lon, d.lat],
          getText: (d: DeFiBubble) => d.name,
          getSize: (d: DeFiBubble) => d.tvl > 500_000_000 ? 14 : d.tvl > 50_000_000 ? 12 : 10,
          getColor: [255, 255, 255, 220],
          getTextAnchor: 'middle' as const,
          getAlignmentBaseline: 'bottom' as const,
          getPixelOffset: [0, -15],
          fontFamily: 'monospace',
          fontWeight: 'bold',
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 200],
          billboard: true,
        })
      );

      // Category + TVL labels (smaller, below)
      if (withTvl.length > 0) {
        layers.push(
          new TextLayer({
            id: 'defi-category-labels',
            data: withTvl,
            getPosition: (d: DeFiBubble) => [d.lon, d.lat],
            getText: (d: DeFiBubble) => {
              const tvlStr = d.tvl >= 1e9
                ? `$${(d.tvl / 1e9).toFixed(1)}B`
                : d.tvl >= 1e6
                ? `$${(d.tvl / 1e6).toFixed(0)}M`
                : `$${(d.tvl / 1e3).toFixed(0)}K`;
              const change = d.change24h >= 0 ? `+${d.change24h.toFixed(1)}%` : `${d.change24h.toFixed(1)}%`;
              return `${tvlStr} · ${change}`;
            },
            getSize: 9,
            getColor: (d: DeFiBubble) =>
              d.change24h >= 0 ? [20, 241, 149, 180] : [255, 80, 80, 180],
            getTextAnchor: 'middle' as const,
            getAlignmentBaseline: 'top' as const,
            getPixelOffset: [0, 15],
            fontFamily: 'monospace',
            outlineWidth: 2,
            outlineColor: [0, 0, 0, 180],
            billboard: true,
          })
        );
      }
    }

    return layers;
  }

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  private handleHover(info: { object?: unknown; x?: number; y?: number }): void {
    if (!info.object || info.x == null || info.y == null) {
      this.tooltipEl.style.display = 'none';
      return;
    }

    const obj = info.object;
    let html = '';

    if (this.isValidator(obj)) {
      const v = obj as SolanaValidator;
      const stakeStr = v.activatedStake >= 1_000_000
        ? `${(v.activatedStake / 1_000_000).toFixed(2)}M SOL`
        : v.activatedStake >= 1_000
        ? `${(v.activatedStake / 1_000).toFixed(1)}K SOL`
        : `${v.activatedStake.toLocaleString()} SOL`;
      const clientLabel = v.clientType === 'jito' ? '🟠 Jito'
        : v.clientType === 'firedancer' ? '🔵 Firedancer'
        : v.clientType === 'solana-labs' ? '🟢 Solana Labs/Agave'
        : '⚪ Unknown';
      html = `
        <strong>${v.name || v.pubkey.slice(0, 8)}...${v.pubkey.slice(-4)}</strong><br>
        <span style="font-size:9px;opacity:0.7">${v.pubkey}</span><br>
        📍 ${v.city || 'Unknown'}${v.country ? `, ${v.country}` : ''}
        ${v.datacenter ? `<br>🏢 DC: ${v.datacenter}` : ''}<br>
        💰 Stake: ${stakeStr}<br>
        🖥️ Client: ${clientLabel}<br>
        📦 Version: ${v.version || 'unknown'}<br>
        📊 Commission: ${v.commission}%
        ${(v.skipRate || 0) > 0 ? ` · Skip: ${v.skipRate!.toFixed(1)}%` : ''}
        ${(v.apy || 0) > 0 ? `<br>📈 APY: ${v.apy!.toFixed(2)}%` : ''}
        ${v.delinquent ? '<br><span style="color:#ff5050;font-weight:bold">⚠ DELINQUENT</span>' : ''}
      `;
    } else if (this.isDePINNode(obj)) {
      const n = obj as DePINNode;
      html = `
        <strong>${n.network.toUpperCase()} Node</strong><br>
        Status: ${n.status}<br>
        Reward: ${n.rewardToken}${n.dailyRewards ? ` · ${n.dailyRewards.toFixed(2)}/day` : ''}<br>
        Uptime: ${(n.uptimePercent || 0).toFixed(1)}%
      `;
    } else if (this.isCluster(obj)) {
      const c = obj as ValidatorCluster;
      html = `
        <strong>${c.datacenter || c.country}</strong><br>
        Validators: ${c.count}<br>
        Stake: ${(c.stakeConcentration * 100).toFixed(1)}% of total
        ${c.stakeConcentration > 0.10 ? '<br><span style="color:#ff5050">⚠ HIGH CONCENTRATION</span>' : ''}
      `;
    } else if (this.isDeFiBubble(obj)) {
      const d = obj as DeFiBubble;
      const tvlStr = d.tvl >= 1e9
        ? `$${(d.tvl / 1e9).toFixed(2)}B`
        : d.tvl >= 1e6
        ? `$${(d.tvl / 1e6).toFixed(1)}M`
        : `$${(d.tvl / 1e3).toFixed(0)}K`;
      const change24 = d.change24h >= 0 ? `+${d.change24h.toFixed(1)}%` : `${d.change24h.toFixed(1)}%`;
      const change7d = d.change7d !== undefined
        ? (d.change7d >= 0 ? `+${d.change7d.toFixed(1)}%` : `${d.change7d.toFixed(1)}%`)
        : '';
      const changeColor24 = d.change24h >= 0 ? '#14F195' : '#FF5050';
      html = `
        <strong>${d.name}</strong><br>
        <span style="opacity:0.7">${d.category}</span><br>
        TVL: <span style="color:#FFD700">${tvlStr}</span><br>
        24h: <span style="color:${changeColor24}">${change24}</span>${change7d ? ` · 7d: ${change7d}` : ''}
      `;
    }

    if (html) {
      this.tooltipEl.innerHTML = html;
      this.tooltipEl.style.display = 'block';
      this.tooltipEl.style.left = `${info.x + 12}px`;
      this.tooltipEl.style.top = `${info.y - 12}px`;
    }
  }

  // ── Type guards ──────────────────────────────────────────────────────────
  private isValidator(obj: unknown): obj is SolanaValidator {
    return typeof obj === 'object' && obj !== null && 'pubkey' in obj && 'activatedStake' in obj;
  }
  private isDePINNode(obj: unknown): obj is DePINNode {
    return typeof obj === 'object' && obj !== null && 'network' in obj && 'rewardToken' in obj;
  }
  private isCluster(obj: unknown): obj is ValidatorCluster {
    return typeof obj === 'object' && obj !== null && 'stakeConcentration' in obj && 'validators' in obj;
  }
  private isDeFiBubble(obj: unknown): obj is DeFiBubble {
    return typeof obj === 'object' && obj !== null && 'tvl' in obj && 'category' in obj;
  }

  // ── Update stats & legend overlays ────────────────────────────────────────
  private updateOverlays(): void {
    this.updateStats();
    this.updateLegend();
  }

  private updateStats(): void {
    // Update filter counts & show/hide filter panel per mode
    if (this.currentMode === 'validators') {
      this.updateFilterCounts();
      this.filterPanel.style.display = '';
    } else if (this.currentMode === 'depin') {
      this.updateDePINFilterCounts();
      this.filterPanel.style.display = '';
    } else if (this.currentMode === 'risk') {
      this.updateRiskFilterCounts();
      this.filterPanel.style.display = '';
    } else if (this.currentMode === 'defi') {
      this.updateDeFiFilterCounts();
      this.filterPanel.style.display = '';
    } else {
      this.filterPanel.style.display = 'none';
    }

    switch (this.currentMode) {
      case 'validators': {
        const filtered = this.getFilteredValidators();
        const stats = getValidatorStats(filtered);
        const stakeStr = stats.totalStakeSOL >= 1e6
          ? `${(stats.totalStakeSOL / 1e6).toFixed(1)}M`
          : stats.totalStakeSOL >= 1e3
          ? `${(stats.totalStakeSOL / 1e3).toFixed(0)}K`
          : `${stats.totalStakeSOL.toLocaleString()}`;

        // Client breakdown with percentages
        const jito = stats.clientBreakdown['jito'] || 0;
        const fd = stats.clientBreakdown['firedancer'] || 0;
        const labs = stats.clientBreakdown['solana-labs'] || 0;
        const unk = stats.clientBreakdown['unknown'] || 0;
        const totalC = jito + fd + labs + unk || 1;
        const jitoPct = ((jito / totalC) * 100).toFixed(1);
        const fdPct = fd > 0 ? ((fd / totalC) * 100).toFixed(1) : '0';
        const labsPct = ((labs / totalC) * 100).toFixed(1);

        // Top countries — show flag + code
        const FLAG: Record<string, string> = {
          US: '🇺🇸', DE: '🇩🇪', FI: '🇫🇮', NL: '🇳🇱', FR: '🇫🇷', CA: '🇨🇦',
          GB: '🇬🇧', SG: '🇸🇬', JP: '🇯🇵', AU: '🇦🇺', BE: '🇧🇪', IE: '🇮🇪',
          PL: '🇵🇱', UA: '🇺🇦', RU: '🇷🇺', IN: '🇮🇳', KR: '🇰🇷', HK: '🇭🇰',
        };
        const topCountries = stats.countryBreakdown.slice(0, 5)
          .map(c => {
            const flag = FLAG[c.country] || '🌍';
            return `${flag} ${c.country}: ${c.count} <span style="opacity:0.6">(${c.stakePercent}%)</span>`;
          }).join('<br>');

        // Top versions
        const topVersions = stats.versionBreakdown.slice(0, 3)
          .map(v => `v${v.version}: ${v.count}`)
          .join(' · ');

        this.statsOverlay.innerHTML = `
          <span style="font-size:11px;color:#14F195;font-weight:600">⬡ VALIDATORS: ${stats.total.toLocaleString()}</span><br>
          <span style="color:#aaa">Active:</span> ${stats.active.toLocaleString()} · <span style="color:#ff5050">Delinquent: ${stats.delinquent}</span><br>
          <span style="color:#aaa">Stake:</span> <span style="color:#FFD700">${stakeStr} SOL</span><br>
          <span style="color:#aaa">Nakamoto:</span> <span style="color:#FFD700">${stats.nakamoto}</span> · <span style="color:#aaa">Top-10:</span> ${stats.top10StakePct}%<br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          <span style="color:#FFA500">● Jito: ${jito}</span> (${jitoPct}%)${fd > 0 ? ` · <span style="color:#00D1FF">● FD: ${fd}</span> (${fdPct}%)` : ''} · <span style="color:#14F195">● Agave: ${labs}</span> (${labsPct}%)</span>${unk > 0 ? `<br><span style="color:#888">● Unknown: ${unk}</span>` : ''}<br>
          <span style="color:#aaa">Avg Commission:</span> ${stats.avgCommission}%${stats.avgSkipRate > 0 ? ` · <span style="color:#aaa">Skip:</span> ${stats.avgSkipRate}%` : ''}<br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          ${topCountries}</span><br>
          <span style="font-size:8px;opacity:0.5">${topVersions}</span>
        `;
        break;
      }
      case 'depin': {
        const filtered = this.getFilteredDePINNodes();
        const dStats = getDePINStats(filtered);
        const totalFiltered = filtered.length;
        const activeFiltered = filtered.filter(n => n.status === 'active').length;
        const fmt = (n: number): string => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1_000 ? (n / 1_000).toFixed(0) + 'K' : String(n);
        const enabledNets = Object.entries(this.depinNetworkFilters).filter(([, v]) => v).length;
        const rows = Object.entries(dStats)
          .filter(([key]) => this.depinNetworkFilters[key])
          .map(([key, s]) => {
            const info = DEPIN_NETWORK_INFO[key];
            if (!info) return '';
            const colorKey = key as keyof typeof COLORS;
            const rgb = COLORS[colorKey] || COLORS.white;
            const color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            return `<span style="color:${color}">● ${info.label}</span>: ${s.active}/${s.total} <span style="opacity:0.5;font-size:8px">(${fmt(s.realCount)} real)</span>`;
          }).filter(Boolean);
        this.statsOverlay.innerHTML = `
          <span style="font-size:11px;color:#14F195;font-weight:600">⬡ DePIN NODES: ${totalFiltered.toLocaleString()}</span><br>
          <span style="color:#aaa">Active:</span> ${activeFiltered.toLocaleString()} · <span style="color:#aaa">Networks:</span> ${enabledNets}/9<br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          ${rows.join('<br>')}</span>
        `;
        break;
      }
      case 'risk': {
        const topDCs = getDatacenterConcentration(this.data.clusters);
        const riskStats = getValidatorStats(this.data.validators);
        const allClusters = this.data.clusters;
        const significantClusters = allClusters.filter(c => c.count >= 3);

        // Risk level counts
        const highRiskClusters = significantClusters.filter(c => c.stakeConcentration > 0.10);
        const warningClusters = significantClusters.filter(c => c.stakeConcentration > 0.03 && c.stakeConcentration <= 0.10);
        const safeClusters = significantClusters.filter(c => c.stakeConcentration <= 0.03);

        // Top-5 cluster stake concentration
        const top5Stake = allClusters.slice(0, 5).reduce((s, c) => s + c.totalStake, 0);
        const totalStake = this.data.validators.reduce((s, v) => s + v.activatedStake, 0);
        const top5Pct = totalStake > 0 ? ((top5Stake / totalStake) * 100).toFixed(1) : '0';

        // High-risk stake
        const hrStake = highRiskClusters.reduce((s, c) => s + c.totalStake, 0);
        const hrPct = totalStake > 0 ? ((hrStake / totalStake) * 100).toFixed(1) : '0';

        // Country geo concentration
        const FLAG: Record<string, string> = {
          US: '\u{1F1FA}\u{1F1F8}', DE: '\u{1F1E9}\u{1F1EA}', FI: '\u{1F1EB}\u{1F1EE}',
          NL: '\u{1F1F3}\u{1F1F1}', FR: '\u{1F1EB}\u{1F1F7}', CA: '\u{1F1E8}\u{1F1E6}',
          GB: '\u{1F1EC}\u{1F1E7}', SG: '\u{1F1F8}\u{1F1EC}', JP: '\u{1F1EF}\u{1F1F5}',
          AU: '\u{1F1E6}\u{1F1FA}', BE: '\u{1F1E7}\u{1F1EA}', IE: '\u{1F1EE}\u{1F1EA}',
          PL: '\u{1F1F5}\u{1F1F1}', UA: '\u{1F1FA}\u{1F1E6}', IN: '\u{1F1EE}\u{1F1F3}',
          KR: '\u{1F1F0}\u{1F1F7}', HK: '\u{1F1ED}\u{1F1F0}',
        };
        const topCountries = riskStats.countryBreakdown.slice(0, 4)
          .map(c => {
            const flag = FLAG[c.country] || '\u{1F30D}';
            return `${flag} ${c.country}: ${c.stakePercent}%`;
          }).join(' · ');

        // Top DCs
        const topDCRows = topDCs.slice(0, 3).map(d => {
          const color = d.stakePercent > 10 ? '#FF5050' : d.stakePercent > 3 ? '#FFD700' : '#14F195';
          return `<span style="color:${color}">●</span> ${d.dc}: <span style="color:${color}">${d.stakePercent}%</span> <span style="opacity:0.5">(${d.count} val)</span>`;
        }).join('<br>');

        this.statsOverlay.innerHTML = `
          <span style="font-size:11px;color:#FF5050;font-weight:600">\u26A0 RISK ANALYSIS</span><br>
          <span style="color:#aaa">Clusters:</span> ${significantClusters.length} <span style="opacity:0.5;font-size:9px">(3+ validators)</span><br>
          <span style="color:#FF5050">\u25CF High:</span> ${highRiskClusters.length} \u00B7 <span style="color:#FFD700">\u25CF Warn:</span> ${warningClusters.length} \u00B7 <span style="color:#14F195">\u25CF Safe:</span> ${safeClusters.length}<br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          <span style="color:#aaa">Nakamoto Coeff:</span> <span style="color:#FFD700">${riskStats.nakamoto}</span> \u00B7 <span style="color:#aaa">Top-10 Stake:</span> ${riskStats.top10StakePct}%<br>
          <span style="color:#aaa">Top-5 Clusters:</span> ${top5Pct}% of stake \u00B7 <span style="color:#FF5050">HR Stake:</span> ${hrPct}%<br>
          <span style="color:#ff5050">Delinquent:</span> ${riskStats.delinquent}</span><br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          <span style="color:#aaa;font-size:10px">TOP DATACENTERS</span><br>
          ${topDCRows}</span><br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:3px 0;padding-top:3px">
          <span style="color:#aaa;font-size:10px">GEO CONCENTRATION</span><br>
          ${topCountries}</span>
        `;
        break;
      }
      case 'defi': {
        const filtered = this.getFilteredDeFiBubbles();
        const withTvl = filtered.filter(d => d.tvl > 0);
        const totalTvl = withTvl.reduce((s, d) => s + d.tvl, 0);

        // Top 3 protocols by TVL (compact)
        const top3 = [...withTvl].sort((a, b) => b.tvl - a.tvl).slice(0, 3);
        const top5Rows = top3.map((d, i) => {
          const tvlStr = d.tvl >= 1e9 ? `$${(d.tvl / 1e9).toFixed(1)}B` : `$${(d.tvl / 1e6).toFixed(0)}M`;
          const chg = d.change24h >= 0 ? `<span style="color:#14F195">+${d.change24h.toFixed(1)}%</span>` : `<span style="color:#FF5050">${d.change24h.toFixed(1)}%</span>`;
          const catClr = CATEGORY_COLORS[d.category] || DEFAULT_CAT_COLOR;
          return `<span style="color:${catClr}">${i + 1}.</span> ${d.name}: <span style="color:#FFD700">${tvlStr}</span> ${chg}`;
        }).join('<br>');

        // Category breakdown
        const catMap = new Map<string, { tvl: number; count: number }>();
        for (const d of withTvl) {
          const e = catMap.get(d.category) || { tvl: 0, count: 0 };
          e.tvl += d.tvl; e.count++;
          catMap.set(d.category, e);
        }
        const catRows = [...catMap.entries()]
          .sort((a, b) => b[1].tvl - a[1].tvl)
          .slice(0, 4)
          .map(([cat, s]) => {
            const catClr = CATEGORY_COLORS[cat] || DEFAULT_CAT_COLOR;
            const pct = totalTvl > 0 ? ((s.tvl / totalTvl) * 100).toFixed(1) : '0';
            const tvlStr = s.tvl >= 1e9 ? `$${(s.tvl / 1e9).toFixed(1)}B` : `$${(s.tvl / 1e6).toFixed(0)}M`;
            return `<span style="color:${catClr}">●</span> ${cat}: ${tvlStr} <span style="opacity:0.5">(${pct}%)</span>`;
          }).join('<br>');

        // Overall 24h trend
        const gainers = withTvl.filter(d => d.change24h > 0).length;
        const losers = withTvl.filter(d => d.change24h < 0).length;

        const totalTvlStr = totalTvl >= 1e9 ? `$${(totalTvl / 1e9).toFixed(2)}B` : `$${(totalTvl / 1e6).toFixed(0)}M`;

        this.statsOverlay.innerHTML = `
          <span style="font-size:10px;color:#B464FF;font-weight:600">◆ SOLANA DeFi</span><br>
          <span style="color:#aaa">Protocols:</span> ${withTvl.length} · <span style="color:#aaa">TVL:</span> <span style="color:#FFD700">${totalTvlStr}</span><br>
          <span style="color:#14F195">▲${gainers}</span> · <span style="color:#FF5050">▼${losers}</span> · <span style="color:#aaa">Flat ${withTvl.length - gainers - losers}</span><br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:2px 0;padding-top:2px">
          <span style="color:#aaa;font-size:9px">TOP PROTOCOLS</span><br>
          ${top5Rows}</span><br>
          <span style="border-top:1px solid rgba(255,255,255,0.12);display:block;margin:2px 0;padding-top:2px">
          <span style="color:#aaa;font-size:9px">CATEGORIES</span><br>
          ${catRows}</span>
        `;
        break;
      }
    }
  }

  private updateLegend(): void {
    switch (this.currentMode) {
      case 'validators':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">CLIENT</span>
          ${this.legendItem('#14F195', 'Solana Labs')}
          ${this.legendItem('#FFA500', 'Jito')}
          ${this.legendItem('#00D1FF', 'Firedancer')}
          ${this.legendItem('#FF5050', 'Delinquent')}
        `;
        break;
      case 'depin':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">DePIN NETWORKS</span>
          ${this.legendItem('#14F195', 'Helium IoT')}
          ${this.legendItem('#00FFC8', 'Helium Mobile')}
          ${this.legendItem('#FF69B4', 'Render')}
          ${this.legendItem('#00D1FF', 'io.net')}
          ${this.legendItem('#FFD700', 'Hivemapper')}
          ${this.legendItem('#78FF50', 'Grass')}
          ${this.legendItem('#FFA500', 'Geodnet')}
          ${this.legendItem('#B464FF', 'Nosana')}
          ${this.legendItem('#C8C8DC', 'Shadow')}
        `;
        break;
      case 'risk':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">RISK LEVEL</span>
          ${this.legendItem('#14F195', 'Safe (<3% stake)')}
          ${this.legendItem('#FFD700', 'Warning (3-10%)')}
          ${this.legendItem('#FF5050', 'High Risk (>10%)')}
          <span class="legend-label-title" style="margin-top:4px;display:block">LAYERS</span>
          ${this.legendItem('#FF8800', 'Concentration Heatmap')}
          ${this.legendItem('#FF0000', 'Delinquent Validators')}
        `;
        break;
      case 'defi': {
        // Build legend dynamically from active categories
        const activeCats = new Set<string>();
        for (const d of this.data.defiBubbles) {
          if (this.defiCategoryFilters[d.category]) activeCats.add(d.category);
        }
        const catLegend = [...activeCats]
          .map(cat => {
            return this.legendItem(CATEGORY_COLORS[cat] || DEFAULT_CAT_COLOR, cat);
          }).join('');

        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">CATEGORIES</span>
          ${catLegend}
          <span class="legend-label-title" style="margin-top:4px;display:block">BORDER (24H)</span>
          ${this.legendItem('#14F195', 'Up >3%')}
          ${this.legendItem('#FF5050', 'Down >3%')}
        `;
        break;
      }
    }
  }

  private legendItem(color: string, label: string): string {
    return `
      <span class="legend-item">
        <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill="${color}"/></svg>
        <span class="legend-label">${label}</span>
      </span>
    `;
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  private startAnimation(): void {
    if (this.animationTimer) return;
    // Currently no modes need animation; kept for future use
    this.animationTimer = setInterval(() => {
      if (this.isDestroyed) return;
    }, 200);
  }

  // ── Mode switching ────────────────────────────────────────────────────────
  public setMode(mode: GlobeMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    console.log(`[DeckGlobe] Mode switched to: ${mode}`);

    // Rebuild filter panel for the new mode
    this.buildFilterPanel();

    this.updateLayers();
  }

  public getMode(): GlobeMode {
    return this.currentMode;
  }

  // ── Update map layers config ──────────────────────────────────────────────
  public setMapLayers(_layers: MapLayers): void {
    // MapLayers are now controlled by mode switching
    // This method kept for interface compatibility
    this.updateLayers();
  }

  // ── Refresh data ──────────────────────────────────────────────────────────
  public async refresh(): Promise<void> {
    await this.loadData();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  public destroy(): void {
    this.isDestroyed = true;

    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }

    if (this.deckOverlay) {
      try {
        this.deckOverlay.finalize();
      } catch {
        // ignore cleanup errors
      }
      this.deckOverlay = null;
    }

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.statsOverlay.remove();
    this.legendOverlay.remove();
    this.tooltipEl.remove();
    this.filterPanel.remove();
    this.mapDiv.remove();
    this.container.classList.remove('deckgl-mode');
  }
}
