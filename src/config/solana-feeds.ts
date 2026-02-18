// Solana Terminal feed configuration
// Crypto & Solana-focused RSS feeds replacing geopolitical sources

import type { Feed } from '@/types';

// Helper to create RSS proxy URL (Vercel)
const rss = (url: string) => `/api/rss-proxy?url=${encodeURIComponent(url)}`;

// Source tier system for Solana/Crypto prioritization
// Tier 1: Official Solana sources, established exchanges, wire services
// Tier 2: Major crypto outlets
// Tier 3: Specialty/ecosystem sources
// Tier 4: Aggregators, CT, blogs
export const SOURCE_TIERS: Record<string, number> = {
  // Tier 1 — Official & Institutional
  'Solana Foundation': 1,
  'Solana News': 1,
  'Solana Labs Blog': 1,
  'Jupiter Blog': 1,
  'Helius Blog': 1,
  'Jito Blog': 1,
  'Phantom Blog': 1,
  'CoinDesk': 1,
  'Bloomberg Crypto': 1,

  // Tier 2 — Major Crypto Outlets & Solana Aggregators
  'The Block': 2,
  'Blockworks': 2,
  'Decrypt': 2,
  'CoinTelegraph': 2,
  'Unchained': 2,
  'The Defiant': 2,
  'DL News': 2,
  'Messari': 2,
  'SolanaFloor': 2,
  'The Solana Daily': 2,
  'Solana Compass': 2,
  'Superteam Blog': 2,

  // Tier 3 — Ecosystem & Specialty
  'Solana FM': 3,
  'Step Finance Blog': 3,
  'Marinade Blog': 3,
  'Magic Eden Blog': 3,
  'Tensor Blog': 3,
  'Drift Blog': 3,
  'Orca Blog': 3,
  'Bankless': 3,
  'Delphi Digital': 3,

  // Tier 4 — Aggregators & Community
  'Hacker News': 4,
  'r/solana': 4,
  'Solana Twitter': 4,
};

export function getSourceTier(source: string): number {
  return SOURCE_TIERS[source] || 4;
}

export type SourceType = 'official' | 'news' | 'research' | 'community' | 'aggregator';

export const SOURCE_TYPES: Record<string, SourceType> = {
  'Solana Foundation': 'official',
  'Solana Labs Blog': 'official',
  'Jupiter Blog': 'official',
  'Helius Blog': 'official',
  'CoinDesk': 'news',
  'The Block': 'news',
  'Blockworks': 'news',
  'Decrypt': 'news',
  'Messari': 'research',
  'Delphi Digital': 'research',
  'r/solana': 'community',
  'Hacker News': 'aggregator',
};

export function getSourceType(source: string): SourceType {
  return SOURCE_TYPES[source] || 'news';
}

export interface SourceRiskProfile {
  propagandaRisk: number; // 0-1
  stateAffiliated: boolean;
  shillRisk: boolean; // paid promotion suspected
}

export function getSourcePropagandaRisk(_source: string): SourceRiskProfile {
  // In crypto, "propaganda risk" is more about shill risk
  return { propagandaRisk: 0, stateAffiliated: false, shillRisk: false };
}

// Solana-relevant alert keywords (replaces geopolitical keywords)
export const ALERT_KEYWORDS: Record<string, string[]> = {
  critical: [
    'exploit', 'hack', 'drained', 'rug pull', 'rugged', 'vulnerability',
    'network halt', 'outage', 'emergency', 'critical vulnerability',
    'depeg', 'insolvent', 'frozen', 'compromised',
  ],
  high: [
    'whale alert', 'flash crash', 'liquidation', 'massive sell',
    'dump', 'bridge exploit', 'security incident', 'MEV attack',
    'sandwich attack', 'front-run', 'oracle manipulation',
    'token freeze', 'mint exploit',
  ],
  medium: [
    'airdrop', 'token launch', 'new listing', 'governance vote',
    'upgrade', 'migration', 'partnership', 'integration',
    'TVL surge', 'volume spike', 'breakout',
  ],
  low: [
    'update', 'release', 'milestone', 'anniversary', 'community',
    'tutorial', 'guide', 'analysis', 'report',
  ],
};

export const ALERT_EXCLUSIONS: string[] = [
  'sponsored', 'advertisement', 'promoted',
];

// ============================================
// FEED DEFINITIONS
// ============================================

const SOLANA_FEEDS: Feed[] = [
  // ── Tier 1 — Solana-native sources (her haber zaten Solana ile ilgili) ──
  { name: 'Solana News', url: rss('https://solana.com/news/rss.xml'), category: 'solana-news', tier: 1 },
  { name: 'Solana Foundation', url: rss('https://solana.com/news/rss.xml'), category: 'solana-news', tier: 1 },
  { name: 'Helius Blog', url: rss('https://www.helius.dev/blog/rss.xml'), category: 'solana-news', tier: 1 },
  { name: 'Jito Blog', url: rss('https://www.jito.network/blog/rss.xml'), category: 'solana-news', tier: 1 },
  { name: 'Jupiter Blog', url: rss('https://station.jup.ag/blog/rss.xml'), category: 'solana-news', tier: 1 },
  { name: 'Phantom Blog', url: rss('https://phantom.app/blog/rss.xml'), category: 'solana-news', tier: 1 },

  // ── Tier 2 — Solana-focused aggregators / ecosystem ──
  { name: 'SolanaFloor', url: rss('https://solanafloor.com/feed'), category: 'solana-news', tier: 2 },
  { name: 'The Solana Daily', url: rss('https://thesolanadaily.substack.com/feed'), category: 'solana-news', tier: 2 },
  { name: 'Solana Compass', url: rss('https://solanacompass.com/feed'), category: 'solana-news', tier: 2 },
  { name: 'Superteam Blog', url: rss('https://superteam.fun/blog/rss.xml'), category: 'solana-news', tier: 2 },

  // ── Tier 2 — Major crypto outlets (genel haberler, filtre ile Solana seçilir) ──
  { name: 'CoinDesk', url: rss('https://www.coindesk.com/arc/outboundfeeds/rss/'), category: 'solana-news', tier: 2 },
  { name: 'CoinTelegraph', url: rss('https://cointelegraph.com/rss'), category: 'solana-news', tier: 2 },
  { name: 'The Block', url: rss('https://www.theblock.co/rss.xml'), category: 'solana-news', tier: 2 },
  { name: 'Blockworks', url: rss('https://blockworks.co/feed'), category: 'solana-news', tier: 2 },
  { name: 'Decrypt', url: rss('https://decrypt.co/feed'), category: 'solana-news', tier: 2 },
  { name: 'DL News', url: rss('https://www.dlnews.com/arc/outboundfeeds/rss/'), category: 'solana-news', tier: 2 },
  { name: 'Unchained', url: rss('https://unchainedcrypto.com/feed/'), category: 'solana-news', tier: 2 },

  // DeFi & Markets
  { name: 'The Defiant', url: rss('https://thedefiant.io/feed'), category: 'defi', tier: 2 },
  { name: 'DeFi Llama News', url: rss('https://defillama.com/rss'), category: 'defi', tier: 3 },
  { name: 'Bankless', url: rss('https://www.bankless.com/feed'), category: 'defi', tier: 3 },

  // Research & Analysis
  { name: 'Messari', url: rss('https://messari.io/rss'), category: 'research', tier: 2 },

  // Developer & Infrastructure
  { name: 'Solana Dev Blog', url: rss('https://solana.com/news/rss.xml'), category: 'solana-dev', tier: 1 },

  // GitHub — Solana ecosystem releases
  { name: 'Solana GitHub', url: rss('https://github.com/solana-labs/solana/releases.atom'), category: 'github', tier: 1 },
  { name: 'Anchor GitHub', url: rss('https://github.com/coral-xyz/anchor/releases.atom'), category: 'github', tier: 2 },
  { name: 'Jito GitHub', url: rss('https://github.com/jito-foundation/jito-solana/releases.atom'), category: 'github', tier: 2 },
  { name: 'Metaplex GitHub', url: rss('https://github.com/metaplex-foundation/mpl-token-metadata/releases.atom'), category: 'github', tier: 3 },
];

// Intel sources for Solana — key data points for AI analysis
const SOLANA_INTEL_SOURCES: Feed[] = [
  { name: 'Solana Status', url: 'https://status.solana.com/api/v2/incidents.json', category: 'status', tier: 1 },
];

// Export feeds
export const FEEDS = SOLANA_FEEDS;
export const INTEL_SOURCES = SOLANA_INTEL_SOURCES;
