// SolanaDeckGlobe — deck.gl + MapLibre GL globe with 5 visualization modes
// Replaces the Canvas 2D SolanaGlobe with GPU-accelerated WebGL rendering
//
// Modes:
//   1. Validators — ScatterplotLayer + HeatmapLayer for stake distribution
//   2. DePIN      — ScatterplotLayer for Helium/Render/IoNet/Hivemapper nodes
//   3. Flow       — ArcLayer for whale movements, animated pulse
//   4. Risk       — HeatmapLayer + ScatterplotLayer for DC concentration
//   5. DeFi       — ScatterplotLayer + TextLayer for protocol TVL bubbles

import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer, ArcLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

import type { GlobeMode } from './GlobeModeSwitcher';
import type { SolanaValidator, ValidatorCluster, DePINNode, MapLayers } from '@/types';
import { fetchValidatorGeoData, computeNakamoto, getDatacenterConcentration } from '@/services/validator-geo';
import { fetchDePINNodes, getDePINStats } from '@/services/depin-geo';

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
  helium: [20, 241, 149] as [number, number, number],
  render: [255, 105, 180] as [number, number, number],
  ionet: [0, 209, 255] as [number, number, number],
  hivemapper: [255, 215, 0] as [number, number, number],

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
  // Flow data (whale arcs)
  flowArcs: FlowArc[];
  // DeFi bubbles
  defiBubbles: DeFiBubble[];
}

interface FlowArc {
  id: string;
  sourceLat: number;
  sourceLon: number;
  targetLat: number;
  targetLon: number;
  amount: number;
  color: [number, number, number];
  label: string;
}

interface DeFiBubble {
  name: string;
  lat: number;
  lon: number;
  tvl: number;
  change24h: number;
  category: string;
}

// ── DeFi protocol locations — TVLs fetched from DeFi Llama at runtime ───────
// Coordinates are static (headquarters / main user base), TVLs are updated
const DEFI_PROTOCOL_COORDS: Array<{ name: string; slug: string; lat: number; lon: number; category: string }> = [
  { name: 'Jupiter', slug: 'jupiter', lat: 1.3521, lon: 103.8198, category: 'DEX' },
  { name: 'Raydium', slug: 'raydium', lat: 22.3193, lon: 114.1694, category: 'DEX' },
  { name: 'Marinade', slug: 'marinade-finance', lat: 48.2082, lon: 16.3738, category: 'LST' },
  { name: 'Jito', slug: 'jito', lat: 40.7128, lon: -74.0060, category: 'LST' },
  { name: 'Drift', slug: 'drift', lat: -33.8688, lon: 151.2093, category: 'Perps' },
  { name: 'Kamino', slug: 'kamino', lat: 51.5074, lon: -0.1278, category: 'Lending' },
  { name: 'MarginFi', slug: 'marginfi', lat: 37.7749, lon: -122.4194, category: 'Lending' },
  { name: 'Orca', slug: 'orca', lat: 47.6062, lon: -122.3321, category: 'DEX' },
  { name: 'Meteora', slug: 'meteora', lat: 3.1390, lon: 101.6869, category: 'DEX' },
  { name: 'Sanctum', slug: 'sanctum', lat: 34.0522, lon: -118.2437, category: 'LST' },
  { name: 'Tensor', slug: 'tensor', lat: 52.5200, lon: 13.4050, category: 'NFT' },
  { name: 'Phoenix', slug: 'phoenix', lat: 33.4484, lon: -112.0740, category: 'DEX' },
  { name: 'Solend', slug: 'solend', lat: 25.7617, lon: -80.1918, category: 'Lending' },
  { name: 'Pyth', slug: 'pyth-network', lat: 41.8781, lon: -87.6298, category: 'Oracle' },
];

let defiLocationsCache: DeFiBubble[] | null = null;
let defiCacheTs = 0;

async function fetchDefiLocations(): Promise<DeFiBubble[]> {
  const now = Date.now();
  if (defiLocationsCache && now - defiCacheTs < 300_000) return defiLocationsCache;

  const tvlMap = new Map<string, { tvl: number; change24h: number }>();
  try {
    const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const protocols: Array<{ name: string; slug: string; tvl?: number; change_1d?: number; chains?: string[] }> = await res.json();
      for (const p of protocols) {
        if (p.chains?.includes('Solana') || p.chains?.includes('solana')) {
          tvlMap.set(p.slug?.toLowerCase() || p.name.toLowerCase(), {
            tvl: p.tvl || 0,
            change24h: p.change_1d || 0,
          });
        }
      }
    }
  } catch {
    // Use zeros
  }

  const locations: DeFiBubble[] = DEFI_PROTOCOL_COORDS.map(coord => {
    const data = tvlMap.get(coord.slug) || tvlMap.get(coord.name.toLowerCase());
    return {
      name: coord.name,
      lat: coord.lat,
      lon: coord.lon,
      tvl: data?.tvl || 0,
      change24h: data?.change24h || 0,
      category: coord.category,
    };
  });

  defiLocationsCache = locations;
  defiCacheTs = now;
  return locations;
}

// ── Flow arc generator — uses static exchange routes (no fake random data) ──
function generateFlowArcs(): FlowArc[] {
  // Known major exchange/DeFi hubs with their geographic locations
  // These represent the routes between major SOL trading venues
  const routes: Array<{
    from: { name: string; lat: number; lon: number };
    to: { name: string; lat: number; lon: number };
    color: [number, number, number];
  }> = [
    { from: { name: 'Binance', lat: 1.3521, lon: 103.8198 }, to: { name: 'Coinbase', lat: 37.7749, lon: -122.4194 }, color: COLORS.gold },
    { from: { name: 'Jupiter', lat: 1.3521, lon: 103.8198 }, to: { name: 'Raydium', lat: 22.3193, lon: 114.1694 }, color: COLORS.solanaGreen },
    { from: { name: 'Coinbase', lat: 37.7749, lon: -122.4194 }, to: { name: 'Kraken', lat: 37.7749, lon: -122.4194 }, color: COLORS.cyan },
    { from: { name: 'Jito Stake', lat: 40.7128, lon: -74.0060 }, to: { name: 'DeFi EU', lat: 51.5074, lon: -0.1278 }, color: COLORS.orange },
    { from: { name: 'DeFi Asia', lat: 35.6762, lon: 139.6503 }, to: { name: 'DeFi EU', lat: 50.1109, lon: 8.6821 }, color: COLORS.pink },
    { from: { name: 'Binance', lat: 1.3521, lon: 103.8198 }, to: { name: 'DeFi US', lat: 40.7128, lon: -74.0060 }, color: COLORS.gold },
    { from: { name: 'Jupiter', lat: 1.3521, lon: 103.8198 }, to: { name: 'Drift', lat: -33.8688, lon: 151.2093 }, color: COLORS.solanaGreen },
    { from: { name: 'Marinade', lat: 48.2082, lon: 16.3738 }, to: { name: 'Jito Stake', lat: 40.7128, lon: -74.0060 }, color: COLORS.solanaPurple },
    { from: { name: 'DeFi US', lat: 37.7749, lon: -122.4194 }, to: { name: 'DeFi Asia', lat: 35.6762, lon: 139.6503 }, color: COLORS.white },
    { from: { name: 'Coinbase', lat: 37.7749, lon: -122.4194 }, to: { name: 'Binance', lat: 1.3521, lon: 103.8198 }, color: COLORS.cyan },
  ];

  return routes.map((route, i) => ({
    id: `flow-${i}`,
    sourceLat: route.from.lat,
    sourceLon: route.from.lon,
    targetLat: route.to.lat,
    targetLon: route.to.lon,
    amount: 0, // actual amounts unknown — will be populated if whale data available
    color: route.color,
    label: `${route.from.name} → ${route.to.name}`,
  }));
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
    flowArcs: [],
    defiBubbles: [], // populated by fetchDefiLocations()
  };
  private statsOverlay: HTMLElement;
  private legendOverlay: HTMLElement;
  private tooltipEl: HTMLElement;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private flowPhase = 0;
  private isDestroyed = false;

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
    this.statsOverlay.className = 'deckgl-timestamp';
    this.statsOverlay.style.cssText = 'top: auto; bottom: 10px; right: 10px; left: auto; transform: none; text-align: right; line-height: 1.6; font-size: 10px;';
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
      this.data.flowArcs = generateFlowArcs();
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
      case 'flow': return this.buildFlowLayers();
      case 'risk': return this.buildRiskLayers();
      case 'defi': return this.buildDeFiLayers();
      default: return this.buildValidatorLayers();
    }
  }

  // ── MODE 1: VALIDATORS ────────────────────────────────────────────────────
  private buildValidatorLayers(): Layer[] {
    const layers: Layer[] = [];

    // Stake heatmap
    if (this.data.validators.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: 'validator-heatmap',
          data: this.data.validators.filter(v => !v.delinquent),
          getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
          getWeight: (d: SolanaValidator) => Math.sqrt(d.activatedStake) / 500,
          radiusPixels: 50,
          intensity: 1.5,
          threshold: 0.05,
          colorRange: [
            [20, 241, 149, 25],   // dim green
            [20, 241, 149, 80],
            [153, 69, 255, 120],  // purple mid
            [255, 215, 0, 180],   // gold high
            [255, 80, 80, 220],   // red concentration
          ],
          opacity: 0.6,
        })
      );
    }

    // Validator dots (colored by client type)
    layers.push(
      new ScatterplotLayer({
        id: 'validator-dots',
        data: this.data.validators,
        getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
        getRadius: (d: SolanaValidator) => {
          const base = Math.sqrt(d.activatedStake) / 80;
          return Math.max(3, Math.min(base, 25));
        },
        getFillColor: (d: SolanaValidator) => {
          if (d.delinquent) return [...COLORS.red, 200] as [number, number, number, number];
          switch (d.clientType) {
            case 'jito': return [...COLORS.jito, 180] as [number, number, number, number];
            case 'firedancer': return [...COLORS.cyan, 200] as [number, number, number, number];
            default: return [...COLORS.solanaGreen, 160] as [number, number, number, number];
          }
        },
        getLineColor: (d: SolanaValidator) =>
          d.delinquent ? [255, 0, 0, 255] : [255, 255, 255, 40],
        lineWidthMinPixels: 0.5,
        stroked: true,
        radiusUnits: 'pixels' as const,
        radiusMinPixels: 2,
        radiusMaxPixels: 30,
        pickable: true,
        onHover: (info: { object?: SolanaValidator; x?: number; y?: number }) => this.handleHover(info),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
      })
    );

    // Delinquent pulse ring
    const delinquent = this.data.validators.filter(v => v.delinquent);
    if (delinquent.length > 0) {
      const pulseSize = 1 + Math.sin(this.flowPhase * 3) * 0.3;
      layers.push(
        new ScatterplotLayer({
          id: 'delinquent-pulse',
          data: delinquent,
          getPosition: (d: SolanaValidator) => [d.lon!, d.lat!],
          getRadius: () => 12 * pulseSize,
          getFillColor: [255, 0, 0, 0],
          getLineColor: [255, 80, 80, 120],
          lineWidthMinPixels: 2,
          stroked: true,
          filled: false,
          radiusUnits: 'pixels' as const,
        })
      );
    }

    return layers;
  }

  // ── MODE 2: DePIN ─────────────────────────────────────────────────────────
  private buildDePINLayers(): Layer[] {
    const layers: Layer[] = [];

    const networkColor = (n: DePINNode): [number, number, number, number] => {
      const alpha = n.status === 'active' ? 180 : n.status === 'relay' ? 100 : 50;
      switch (n.network) {
        case 'helium': return [...COLORS.helium, alpha];
        case 'render': return [...COLORS.render, alpha];
        case 'ionet': return [...COLORS.ionet, alpha];
        case 'hivemapper': return [...COLORS.hivemapper, alpha];
        default: return [...COLORS.white, alpha];
      }
    };

    // DePIN heatmap (density)
    layers.push(
      new HeatmapLayer({
        id: 'depin-heatmap',
        data: this.data.depinNodes.filter(n => n.status === 'active'),
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

    // Individual nodes
    layers.push(
      new ScatterplotLayer({
        id: 'depin-nodes',
        data: this.data.depinNodes,
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

  // ── MODE 3: FLOW ──────────────────────────────────────────────────────────
  private buildFlowLayers(): Layer[] {
    const layers: Layer[] = [];

    // Flow arcs
    layers.push(
      new ArcLayer({
        id: 'flow-arcs',
        data: this.data.flowArcs,
        getSourcePosition: (d: FlowArc) => [d.sourceLon, d.sourceLat],
        getTargetPosition: (d: FlowArc) => [d.targetLon, d.targetLat],
        getSourceColor: (d: FlowArc) => [...d.color, 200] as [number, number, number, number],
        getTargetColor: (d: FlowArc) => [...d.color, 80] as [number, number, number, number],
        getWidth: (d: FlowArc) => Math.max(1, Math.log10(d.amount) - 2),
        getHeight: 0.4,
        greatCircle: true,
        widthMinPixels: 1,
        widthMaxPixels: 6,
        pickable: true,
        onHover: (info: { object?: FlowArc; x?: number; y?: number }) => this.handleHover(info),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
      })
    );

    // Source/target dots
    const endpoints = this.data.flowArcs.flatMap(arc => [
      { lon: arc.sourceLon, lat: arc.sourceLat, color: arc.color, label: 'source' },
      { lon: arc.targetLon, lat: arc.targetLat, color: arc.color, label: 'target' },
    ]);

    const pulseSize = 1 + Math.sin(this.flowPhase * 4) * 0.3;

    layers.push(
      new ScatterplotLayer({
        id: 'flow-endpoints',
        data: endpoints,
        getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
        getRadius: () => 6 * pulseSize,
        getFillColor: (d: { color: [number, number, number] }) => [...d.color, 160] as [number, number, number, number],
        radiusUnits: 'pixels' as const,
        radiusMinPixels: 3,
        radiusMaxPixels: 10,
      })
    );

    // TPS pulse ring at center (animated)
    const tpsPulsePhase = Math.sin(this.flowPhase * 5) * 0.5 + 0.5;
    layers.push(
      new ScatterplotLayer({
        id: 'tps-pulse',
        data: [{ lon: 0, lat: 0 }],
        getPosition: () => [0, 0],
        getRadius: () => 30 + tpsPulsePhase * 20,
        getFillColor: [20, 241, 149, 0],
        getLineColor: [20, 241, 149, Math.round(40 + tpsPulsePhase * 40)],
        lineWidthMinPixels: 1,
        stroked: true,
        filled: false,
        radiusUnits: 'pixels' as const,
      })
    );

    return layers;
  }

  // ── MODE 4: RISK ──────────────────────────────────────────────────────────
  private buildRiskLayers(): Layer[] {
    const layers: Layer[] = [];

    // Concentration heatmap (stake amount = weight)
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

    // Cluster size markers (bigger = more concentrated = more risky)
    layers.push(
      new ScatterplotLayer({
        id: 'risk-clusters',
        data: this.data.clusters.filter(c => c.count >= 3),
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

    // Delinquent validators overlay
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

    return layers;
  }

  // ── MODE 5: DeFi ──────────────────────────────────────────────────────────
  private buildDeFiLayers(): Layer[] {
    const layers: Layer[] = [];

    // TVL bubbles
    layers.push(
      new ScatterplotLayer({
        id: 'defi-bubbles',
        data: this.data.defiBubbles.filter(d => d.tvl > 0),
        getPosition: (d: DeFiBubble) => [d.lon, d.lat],
        getRadius: (d: DeFiBubble) => Math.sqrt(d.tvl) / 5000 + 8,
        getFillColor: (d: DeFiBubble) => {
          if (d.change24h > 3) return [...COLORS.solanaGreen, 160] as [number, number, number, number];
          if (d.change24h > 0) return [...COLORS.cyan, 140] as [number, number, number, number];
          if (d.change24h > -3) return [...COLORS.gold, 140] as [number, number, number, number];
          return [...COLORS.red, 140] as [number, number, number, number];
        },
        getLineColor: [255, 255, 255, 60],
        lineWidthMinPixels: 1,
        stroked: true,
        radiusUnits: 'pixels' as const,
        radiusMinPixels: 8,
        radiusMaxPixels: 50,
        pickable: true,
        onHover: (info: { object?: DeFiBubble; x?: number; y?: number }) => this.handleHover(info),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
      })
    );

    // Protocol name labels
    layers.push(
      new TextLayer({
        id: 'defi-labels',
        data: this.data.defiBubbles,
        getPosition: (d: DeFiBubble) => [d.lon, d.lat],
        getText: (d: DeFiBubble) => d.name,
        getSize: (d: DeFiBubble) => d.tvl > 500_000_000 ? 14 : 11,
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

    // Category labels (smaller, below)
    layers.push(
      new TextLayer({
        id: 'defi-category-labels',
        data: this.data.defiBubbles.filter(d => d.tvl > 0),
        getPosition: (d: DeFiBubble) => [d.lon, d.lat],
        getText: (d: DeFiBubble) => {
          const tvlStr = d.tvl >= 1e9
            ? `$${(d.tvl / 1e9).toFixed(1)}B`
            : `$${(d.tvl / 1e6).toFixed(0)}M`;
          const change = d.change24h >= 0 ? `+${d.change24h.toFixed(1)}%` : `${d.change24h.toFixed(1)}%`;
          return `${d.category} · ${tvlStr} · ${change}`;
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
        ? `${(v.activatedStake / 1_000_000).toFixed(1)}M SOL`
        : `${(v.activatedStake / 1_000).toFixed(0)}K SOL`;
      html = `
        <strong>${v.name || v.pubkey.slice(0, 8)}...</strong><br>
        ${v.city || ''} ${v.country || ''}<br>
        Stake: ${stakeStr}<br>
        Client: ${v.clientType || 'unknown'} ${v.version || ''}<br>
        Commission: ${v.commission}% · Skip: ${(v.skipRate || 0).toFixed(1)}%
        ${v.delinquent ? '<br><span style="color:#ff5050">⚠ DELINQUENT</span>' : ''}
      `;
    } else if (this.isDePINNode(obj)) {
      const n = obj as DePINNode;
      html = `
        <strong>${n.network.toUpperCase()} Node</strong><br>
        Status: ${n.status}<br>
        Reward: ${n.rewardToken}${n.dailyRewards ? ` · ${n.dailyRewards.toFixed(2)}/day` : ''}<br>
        Uptime: ${(n.uptimePercent || 0).toFixed(1)}%
      `;
    } else if (this.isFlowArc(obj)) {
      const f = obj as FlowArc;
      const amountStr = f.amount >= 100_000
        ? `${(f.amount / 1_000).toFixed(0)}K SOL`
        : `${f.amount.toFixed(0)} SOL`;
      html = `<strong>${f.label}</strong><br>${amountStr}`;
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
        : `$${(d.tvl / 1e6).toFixed(0)}M`;
      html = `
        <strong>${d.name}</strong><br>
        Category: ${d.category}<br>
        TVL: ${tvlStr}<br>
        24h: ${d.change24h >= 0 ? '+' : ''}${d.change24h.toFixed(1)}%
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
  private isFlowArc(obj: unknown): obj is FlowArc {
    return typeof obj === 'object' && obj !== null && 'sourceLat' in obj && 'targetLat' in obj;
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
    switch (this.currentMode) {
      case 'validators': {
        const total = this.data.validators.length;
        const delinquent = this.data.validators.filter(v => v.delinquent).length;
        const nakamoto = computeNakamoto(this.data.validators);
        const jito = this.data.validators.filter(v => v.clientType === 'jito').length;
        const fd = this.data.validators.filter(v => v.clientType === 'firedancer').length;
        this.statsOverlay.innerHTML = `
          VALIDATORS: ${total.toLocaleString()}<br>
          NAKAMOTO: ${nakamoto}<br>
          DELINQUENT: <span style="color:var(--red,#ff5050)">${delinquent}</span><br>
          JITO: ${jito} · FD: ${fd}
        `;
        break;
      }
      case 'depin': {
        const stats = getDePINStats(this.data.depinNodes);
        this.statsOverlay.innerHTML = `
          HELIUM: ${stats.helium.active}/${stats.helium.total}<br>
          RENDER: ${stats.render.active}/${stats.render.total}<br>
          IoNET: ${stats.ionet.active}/${stats.ionet.total}<br>
          HIVEMAPPER: ${stats.hivemapper.active}/${stats.hivemapper.total}
        `;
        break;
      }
      case 'flow': {
        this.statsOverlay.innerHTML = `
          ACTIVE FLOWS: ${this.data.flowArcs.length}<br>
          TOTAL VOLUME: ${(this.data.flowArcs.reduce((s, a) => s + a.amount, 0) / 1e6).toFixed(1)}M SOL<br>
          LIVE TRACKING
        `;
        break;
      }
      case 'risk': {
        const top = getDatacenterConcentration(this.data.clusters);
        const topDc = top[0];
        this.statsOverlay.innerHTML = `
          CLUSTERS: ${this.data.clusters.length}<br>
          TOP DC: ${topDc?.dc || 'N/A'} (${topDc?.stakePercent || 0}%)<br>
          DELINQUENT: ${this.data.validators.filter(v => v.delinquent).length}
        `;
        break;
      }
      case 'defi': {
        const totalTvl = this.data.defiBubbles.reduce((s, d) => s + d.tvl, 0);
        this.statsOverlay.innerHTML = `
          PROTOCOLS: ${this.data.defiBubbles.length}<br>
          TOTAL TVL: $${(totalTvl / 1e9).toFixed(1)}B<br>
          ECOSYSTEM: SOLANA
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
          <span class="legend-label-title">NETWORK</span>
          ${this.legendItem('#14F195', 'Helium')}
          ${this.legendItem('#FF69B4', 'Render')}
          ${this.legendItem('#00D1FF', 'IoNet')}
          ${this.legendItem('#FFD700', 'Hivemapper')}
        `;
        break;
      case 'flow':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">FLOW</span>
          ${this.legendItem('#FFD700', 'CEX')}
          ${this.legendItem('#14F195', 'DEX/DeFi')}
          ${this.legendItem('#FF69B4', 'Whale')}
          ${this.legendItem('#FF5050', 'Liquidation')}
        `;
        break;
      case 'risk':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">RISK</span>
          ${this.legendItem('#14F195', 'Safe')}
          ${this.legendItem('#FFD700', 'Warning')}
          ${this.legendItem('#FF5050', 'High Risk')}
        `;
        break;
      case 'defi':
        this.legendOverlay.innerHTML = `
          <span class="legend-label-title">TVL 24H</span>
          ${this.legendItem('#14F195', 'Strong Up')}
          ${this.legendItem('#00D1FF', 'Up')}
          ${this.legendItem('#FFD700', 'Flat')}
          ${this.legendItem('#FF5050', 'Down')}
        `;
        break;
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

  // ── Animation loop (for flow/pulse effects) ───────────────────────────────
  private startAnimation(): void {
    if (this.animationTimer) return;
    // Only animate flow mode (arcs need pulse). Validators/risk are static.
    this.animationTimer = setInterval(() => {
      if (this.isDestroyed) return;
      this.flowPhase += 0.05;

      // Only rebuild layers for flow mode which has genuine animations
      if (this.currentMode === 'flow') {
        this.updateLayers();
      }
    }, 200); // 5fps — sufficient for arc pulse, saves GPU
  }

  // ── Mode switching ────────────────────────────────────────────────────────
  public setMode(mode: GlobeMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    console.log(`[DeckGlobe] Mode switched to: ${mode}`);

    // Regenerate flow arcs when entering flow mode
    if (mode === 'flow') {
      this.data.flowArcs = generateFlowArcs();
    }

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
    this.mapDiv.remove();
    this.container.classList.remove('deckgl-mode');
  }
}
