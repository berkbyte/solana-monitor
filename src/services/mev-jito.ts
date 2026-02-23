// MEV & Jito service — real data from Jito public APIs
// Tip floor: https://bundles.jito.wtf/api/v1/bundles/tip_floor
// Recent bundles: https://bundles.jito.wtf/api/v1/bundles/recent
// Validators: https://kobe.mainnet.jito.network/api/v1/validators

// In dev, Jito APIs are CORS-restricted (only allow explorer.jito.wtf).
// We proxy through Vite dev server to bypass CORS.
const isDev = import.meta.env.DEV;
const JITO_TIP_FLOOR_URL = isDev
  ? '/api/jito-tips'
  : 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';
const JITO_BUNDLES_URL = isDev
  ? '/api/jito-bundles'
  : 'https://bundles.jito.wtf/api/v1/bundles/recent';
const JITO_VALIDATORS_URL = isDev
  ? '/api/jito-validators'
  : 'https://kobe.mainnet.jito.network/api/v1/validators';

export interface RecentBundle {
  bundleId: string;
  tipLamports: number;   // landedTipLamports from API
  txCount: number;        // transactions array length
  timestamp: number;      // ms epoch
}

export interface TipFloor {
  p25: number;  // SOL
  p50: number;  // SOL
  p75: number;  // SOL
  p95: number;  // SOL
  p99: number;  // SOL
  ema50: number; // EMA of p50, SOL
  timestamp: number;
}

export interface MevStats {
  tipFloor: TipFloor | null;
  recentBundles: RecentBundle[];
  jitoStakePercent: number;
  jitoValidatorCount: number;
  totalNetworkValidators: number;
}

let cachedStats: MevStats | null = null;
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30s
let lastTipFloor: TipFloor | null = null;

// ── Tip Floor ──────────────────────────────────────────────
// Returns values in SOL (not lamports). API returns a single-element array.
async function fetchTipFloor(): Promise<TipFloor | null> {
  try {
    const res = await fetch(JITO_TIP_FLOOR_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return lastTipFloor;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const d = data[0]; // latest entry
      const floor: TipFloor = {
        p25: d.landed_tips_25th_percentile || 0,
        p50: d.landed_tips_50th_percentile || 0,
        p75: d.landed_tips_75th_percentile || 0,
        p95: d.landed_tips_95th_percentile || 0,
        p99: d.landed_tips_99th_percentile || 0,
        ema50: d.ema_landed_tips_50th_percentile || 0,
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

// ── Recent Bundles ─────────────────────────────────────────
// API returns: { bundleId, timestamp (ISO), tippers[], transactions[], landedTipLamports }
async function fetchRecentBundles(): Promise<RecentBundle[]> {
  try {
    const res = await fetch(`${JITO_BUNDLES_URL}?limit=20`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((b: Record<string, unknown>) => ({
      bundleId: String(b.bundleId || ''),
      tipLamports: Number(b.landedTipLamports || 0),
      txCount: Array.isArray(b.transactions) ? (b.transactions as unknown[]).length : 0,
      timestamp: b.timestamp ? new Date(b.timestamp as string).getTime() : Date.now(),
    }));
  } catch {
    return [];
  }
}

// ── Jito Stake Info ────────────────────────────────────────
// Jito validators API returns { validators: [{ running_jito, active_stake, ... }] }
// Compare Jito validator stake against total network stake from RPC
interface JitoStakeInfo {
  stakePercent: number;
  jitoValidatorCount: number;
  totalNetworkValidators: number;
}

async function fetchJitoStakeInfo(): Promise<JitoStakeInfo> {
  const fallback: JitoStakeInfo = { stakePercent: 0, jitoValidatorCount: 0, totalNetworkValidators: 0 };

  // Fetch Jito validators
  let jitoStakeLamports = 0;
  let jitoCount = 0;
  try {
    const res = await fetch(JITO_VALIDATORS_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.validators)) {
        const validators = data.validators as Array<{ running_jito?: boolean; active_stake?: number }>;
        jitoCount = validators.filter(v => v.running_jito).length;
        jitoStakeLamports = validators
          .filter(v => v.running_jito)
          .reduce((s, v) => s + (v.active_stake || 0), 0);
      }
    }
  } catch { /* continue to RPC */ }

  // Fetch total network stake from RPC
  const rpcUrl = import.meta.env.VITE_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
  let totalNetworkStake = 0;
  let totalValidators = 0;
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVoteAccounts' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const current = data.result?.current || [];
      const delinquent = data.result?.delinquent || [];
      totalValidators = current.length + delinquent.length;
      totalNetworkStake = [...current, ...delinquent]
        .reduce((s: number, v: { activatedStake: number }) => s + v.activatedStake, 0);
    }
  } catch { /* leave 0 */ }

  if (jitoStakeLamports > 0 && totalNetworkStake > 0) {
    return {
      stakePercent: Math.round((jitoStakeLamports / totalNetworkStake) * 1000) / 10, // 1 decimal
      jitoValidatorCount: jitoCount,
      totalNetworkValidators: totalValidators,
    };
  }

  return { ...fallback, jitoValidatorCount: jitoCount, totalNetworkValidators: totalValidators };
}

// ── Main Export ────────────────────────────────────────────
export async function fetchMevStats(): Promise<MevStats> {
  const now = Date.now();
  if (cachedStats && now - lastFetch < CACHE_TTL) return cachedStats;

  const [tipFloor, bundles, stakeInfo] = await Promise.all([
    fetchTipFloor(),
    fetchRecentBundles(),
    fetchJitoStakeInfo(),
  ]);

  const stats: MevStats = {
    tipFloor,
    recentBundles: bundles.sort((a, b) => b.timestamp - a.timestamp),
    jitoStakePercent: stakeInfo.stakePercent,
    jitoValidatorCount: stakeInfo.jitoValidatorCount,
    totalNetworkValidators: stakeInfo.totalNetworkValidators,
  };

  cachedStats = stats;
  lastFetch = now;
  return stats;
}
