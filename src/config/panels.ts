import type { PanelConfig, MapLayers } from '@/types';

// ============================================
// Solana Terminal — Main Dashboard
// ============================================
// Panel order matters! First panels appear at top of grid.
const FULL_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Solana Globe', enabled: true, priority: 1 },

  // ── Charts (wide: 2×2) ──
  'live-charts': { name: 'Live Charts', enabled: true, priority: 1 },

  // ── Core Activity ──
  'token-radar': { name: 'Token Radar', enabled: true, priority: 1 },
  'network-status': { name: 'Network Status', enabled: true, priority: 1 },
  'whale-watch': { name: 'Whale Watch', enabled: true, priority: 1 },
  'priority-fees': { name: 'Priority Fees', enabled: true, priority: 1 },

  // ── DeFi & Staking ──
  'defi-overview': { name: 'DeFi Overview', enabled: true, priority: 1 },
  'mev-dashboard': { name: 'MEV & Jito', enabled: true, priority: 1 },
  'liquid-staking': { name: 'Liquid Staking', enabled: true, priority: 1 },

  // ── Tools ──
  'token-analyze': { name: 'Token Analyze', enabled: true, priority: 1 },

  // ── Intelligence ──
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  'solana-news': { name: 'Solana News', enabled: true, priority: 1 },

  // ── Markets ──
  markets: { name: 'Crypto Markets', enabled: true, priority: 2 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'etf-flows': { name: 'Crypto ETF Tracker', enabled: true, priority: 2 },

  // ── Niche ──
  'nft-tracker': { name: 'NFT Tracker', enabled: true, priority: 2 },
  governance: { name: 'Governance', enabled: true, priority: 2 },

  // ── User ──
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const FULL_MAP_LAYERS: MapLayers = {
  validators: true,
  stakeHeatmap: true,
  dcClusters: true,
  delinquent: false,
  depinHelium: false,
  depinRender: false,
  depinIonet: false,
  whaleFlows: false,
  dcRisk: false,
};

const FULL_MOBILE_MAP_LAYERS: MapLayers = {
  validators: true,
  stakeHeatmap: true,
  dcClusters: false,
  delinquent: false,
  depinHelium: false,
  depinRender: false,
  depinIonet: false,
  whaleFlows: false,
  dcRisk: false,
};

// ============================================
// EXPORTS
// ============================================
export const DEFAULT_PANELS = FULL_PANELS;
export const DEFAULT_MAP_LAYERS = FULL_MAP_LAYERS;
export const MOBILE_DEFAULT_MAP_LAYERS = FULL_MOBILE_MAP_LAYERS;

// Panel palette — Solana brand colors
export const MONITOR_COLORS = [
  '#14F195', // Solana green
  '#9945FF', // Solana purple
  '#FF6B35', // Orange
  '#00D4FF', // Cyan
  '#FFD700', // Gold
  '#FF4444', // Red alert
  '#44FFDD', // Teal
  '#FF44FF', // Magenta
  '#88FF44', // Lime
  '#4488FF', // Blue
];

export const STORAGE_KEYS = {
  panels: 'solanaterminal-panels',
  monitors: 'solanaterminal-monitors',
  mapLayers: 'solanaterminal-layers',
  disabledFeeds: 'solanaterminal-disabled-feeds',
  watchedWallets: 'solanaterminal-wallets',
  tokenWatchlist: 'solanaterminal-watchlist',
} as const;
