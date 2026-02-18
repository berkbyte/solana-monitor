// Base configuration shared across all variants
import type { PanelConfig, MapLayers } from '@/types';

// Shared exports (re-exported by all variants)
export { SECTORS, COMMODITIES, MARKET_SYMBOLS } from '../markets';

// API URLs - Solana Terminal endpoints
export const API_URLS = {
  // Solana network
  solanaNetwork: '/api/solana-network',
  tokenData: (action: string, params?: string) =>
    `/api/token-data?action=${action}${params ? `&${params}` : ''}`,
  defiData: (action: string, params?: string) =>
    `/api/defi-data?action=${action}${params ? `&${params}` : ''}`,
  tokenBrief: (mint: string) =>
    `/api/token-brief?mint=${encodeURIComponent(mint)}`,
  // Kept from original
  finnhub: (symbols: string[]) =>
    `/api/finnhub?symbols=${symbols.map(s => encodeURIComponent(s)).join(',')}`,
  yahooFinance: (symbol: string) =>
    `/api/yahoo-finance?symbol=${encodeURIComponent(symbol)}`,
  coingecko:
    '/api/coingecko?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
  polymarket: '/api/polymarket?closed=false&order=volume&ascending=false&limit=100',
  // Tech/dev
  githubTrending: (language: string = 'rust', since: string = 'daily') =>
    `/api/github-trending?language=${encodeURIComponent(language)}&since=${since}`,
  hackernews: (type: string = 'top', limit: number = 30) =>
    `/api/hackernews?type=${type}&limit=${limit}`,
};

// Refresh intervals - Solana Terminal (faster for on-chain data)
export const REFRESH_INTERVALS = {
  feeds: 3 * 60 * 1000,           // News feeds: 3 min
  markets: 60 * 1000,             // Market data: 1 min
  crypto: 30 * 1000,              // Crypto prices: 30s
  solanaNetwork: 10 * 1000,       // Network status: 10s
  tokenRadar: 5 * 60 * 1000,          // Token radar: 5 min (real discovery)
  whaleWatch: 15 * 1000,          // Whale movements: 15s
  defi: 5 * 60 * 1000,            // DeFi TVL: 5 min
  priorityFees: 10 * 1000,        // Fee levels: 10s
  mev: 60 * 1000,                 // MEV stats: 1 min
  liquidStaking: 5 * 60 * 1000,   // LST data: 5 min
  nft: 5 * 60 * 1000,             // NFT data: 5 min
  xInsights: 5 * 60 * 1000,        // X Insights: 5 min
  predictions: 5 * 60 * 1000,
  githubTrending: 30 * 60 * 1000,
  hackernews: 5 * 60 * 1000,
};

// Monitor colors - Solana brand
export const MONITOR_COLORS = [
  '#14F195',  // Solana green
  '#9945FF',  // Solana purple
  '#FF6B35',  // Orange
  '#00D4FF',  // Cyan
  '#FFD700',  // Gold
  '#FF4444',  // Red alert
  '#44FFDD',  // Teal
  '#FF44FF',  // Magenta
  '#88FF44',  // Lime
  '#4488FF',  // Blue
];

// Storage keys - Solana Terminal
export const STORAGE_KEYS = {
  panels: 'solanaterminal-panels',
  monitors: 'solanaterminal-monitors',
  mapLayers: 'solanaterminal-layers',
  disabledFeeds: 'solanaterminal-disabled-feeds',
  watchedWallets: 'solanaterminal-wallets',
  tokenWatchlist: 'solanaterminal-watchlist',
  globeMode: 'solanaterminal-globe-mode',
} as const;

// Type definitions for variant configs
export interface VariantConfig {
  name: string;
  description: string;
  panels: Record<string, PanelConfig>;
  mapLayers: MapLayers;
  mobileMapLayers: MapLayers;
}
