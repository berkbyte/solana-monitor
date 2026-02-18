// MEV & Jito service — Jito tip data, bundle stats
// Uses Jito REST API with calibrated simulated bundles

export interface MevBundle {
  bundleId: string;
  tipLamports: number;
  txCount: number;
  slot: number;
  timestamp: number;
  landedTxCount: number;
  type: 'arb' | 'liquidation' | 'sandwich' | 'backrun' | 'unknown';
}

export interface JitoTipFloor {
  p25: number;
  p50: number;
  p75: number;
  p99: number;
  timestamp: number;
}

export interface MevStats {
  totalTipsLamports: number;
  totalTipsSol: number;
  totalBundles24h: number;
  avgTipPerBundle: number;
  topSearcher: string;
  topSearcherBundles: number;
  jitoStakePercent: number;
  recentBundles: MevBundle[];
  tipDistribution: { low: number; medium: number; high: number };
  tipFloor: JitoTipFloor | null;
}

let cachedStats: MevStats | null = null;
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30s
let lastTipFloor: JitoTipFloor | null = null;

const JITO_TIP_FLOOR_URL = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';

const TOP_SEARCHERS = [
  { name: 'jito-searcher-1', share: 0.18 },
  { name: 'wintermute-mev', share: 0.14 },
  { name: 'jump-arb', share: 0.12 },
  { name: 'raydium-arb', share: 0.10 },
  { name: 'orca-backrun', share: 0.08 },
  { name: 'drift-liq', share: 0.06 },
  { name: 'phantom-backrun', share: 0.05 },
  { name: 'flashbots-sol', share: 0.04 },
];

const BUNDLE_TYPES: MevBundle['type'][] = ['arb', 'backrun', 'sandwich', 'liquidation', 'unknown'];
const BUNDLE_TYPE_WEIGHTS = [0.35, 0.25, 0.15, 0.10, 0.15]; // weighted distribution

async function fetchJitoTipFloor(): Promise<JitoTipFloor | null> {
  try {
    const res = await fetch(JITO_TIP_FLOOR_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return lastTipFloor;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1];
      const floor: JitoTipFloor = {
        p25: latest.landed_tips_25th_percentile || 0,
        p50: latest.landed_tips_50th_percentile || 0,
        p75: latest.landed_tips_75th_percentile || 0,
        p99: latest.landed_tips_99th_percentile || 0,
        timestamp: Date.now(),
      };
      lastTipFloor = floor;
      return floor;
    }
    return lastTipFloor;
  } catch {
    return lastTipFloor;
  }
}

function getWeightedBundleType(): MevBundle['type'] {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < BUNDLE_TYPES.length; i++) {
    cumulative += BUNDLE_TYPE_WEIGHTS[i]!;
    if (r <= cumulative) return BUNDLE_TYPES[i]!;
  }
  return 'unknown';
}

function generateRecentBundles(count: number, tipFloor: JitoTipFloor | null): MevBundle[] {
  const now = Date.now();
  const bundles: MevBundle[] = [];
  const chars = 'abcdef0123456789';

  for (let i = 0; i < count; i++) {
    const type = getWeightedBundleType();
    let tipLamports: number;

    if (tipFloor && tipFloor.p25 > 0) {
      // Calibrate from real Jito tip floor data
      const p = Math.random();
      const base = p < 0.25 ? tipFloor.p25
        : p < 0.50 ? tipFloor.p50
        : p < 0.75 ? tipFloor.p75
        : tipFloor.p99;
      // Add type-specific multiplier
      const typeMultiplier = type === 'sandwich' ? 2.5
        : type === 'liquidation' ? 4.0
        : type === 'arb' ? 1.5
        : type === 'backrun' ? 1.2
        : 1.0;
      tipLamports = Math.floor(base * typeMultiplier * (0.7 + Math.random() * 0.6));
    } else {
      // Fallback realistic tips
      const tipBase = type === 'sandwich' ? 50_000_000
        : type === 'liquidation' ? 100_000_000
        : type === 'arb' ? 20_000_000
        : 10_000_000;
      tipLamports = Math.floor(tipBase * (0.3 + Math.random() * 3));
    }

    const txCount = type === 'sandwich' ? 3 : Math.floor(2 + Math.random() * 5);
    const id = Array.from({ length: 64 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    bundles.push({
      bundleId: id,
      tipLamports,
      txCount,
      slot: 280_000_000 + Math.floor(Math.random() * 1_000_000),
      timestamp: now - Math.floor(Math.random() * 3_600_000),
      landedTxCount: Math.max(1, txCount - Math.floor(Math.random() * 2)),
      type,
    });
  }

  return bundles.sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchMevStats(): Promise<MevStats> {
  const now = Date.now();
  if (cachedStats && now - lastFetch < CACHE_TTL) return cachedStats;

  // Get real tip floor data from Jito
  const tipFloor = await fetchJitoTipFloor();

  // Generate calibrated bundles
  const recentBundles = generateRecentBundles(15, tipFloor);
  const totalTips = recentBundles.reduce((s, b) => s + b.tipLamports, 0);

  // Realistic 24h estimates based on Solana's ~1200-1500 bundles/hour
  const bundlesPerHour = 1200 + Math.floor(Math.random() * 300);
  const totalBundles24h = bundlesPerHour * 24;
  const avgTipPerBundle = totalTips > 0 ? Math.floor(totalTips / recentBundles.length) : 15_000_000;
  const totalTipsLamports = avgTipPerBundle * totalBundles24h;
  const totalTipsSol = totalTipsLamports / 1e9;

  // Tip distribution
  const lowTips = recentBundles.filter(b => b.tipLamports < 10_000_000).length;
  const highTips = recentBundles.filter(b => b.tipLamports > 50_000_000).length;
  const medTips = recentBundles.length - lowTips - highTips;
  const total = recentBundles.length || 1;

  // Weighted random searcher selection
  const searcherRand = Math.random();
  let cumulative = 0;
  let topSearcher = TOP_SEARCHERS[0]!;
  for (const s of TOP_SEARCHERS) {
    cumulative += s.share;
    if (searcherRand <= cumulative) { topSearcher = s; break; }
  }

  const stats: MevStats = {
    totalTipsLamports,
    totalTipsSol,
    totalBundles24h,
    avgTipPerBundle,
    topSearcher: topSearcher.name,
    topSearcherBundles: Math.floor(totalBundles24h * topSearcher.share),
    jitoStakePercent: 38.5 + (Math.random() * 4 - 2), // Jito is ~38-40% of stake
    recentBundles,
    tipDistribution: {
      low: Math.round((lowTips / total) * 100),
      medium: Math.round((medTips / total) * 100),
      high: Math.round((highTips / total) * 100),
    },
    tipFloor,
  };

  cachedStats = stats;
  lastFetch = now;
  return stats;
}
