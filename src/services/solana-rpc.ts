// Solana RPC service — network status, TPS, slot, epoch, priority fees
// All data fetched exclusively from Helius RPC (incl. getPriorityFeeEstimate)

const HELIUS_RPC = import.meta.env.VITE_HELIUS_RPC_URL;
if (!HELIUS_RPC) console.warn('[Solana RPC] VITE_HELIUS_RPC_URL not set — network data will be unavailable');

const RPC_ENDPOINT = HELIUS_RPC || 'https://api.mainnet-beta.solana.com';

// ── Types ──────────────────────────────────────────────────

interface HeliusFeeEstimate {
  min: number;
  low: number;
  medium: number;
  high: number;
  veryHigh: number;
  unsafeMax: number;
}

export interface SolanaNetworkStatus {
  tps: number;
  slot: number;
  epoch: number;
  epochProgress: number;
  blockTime: number;
  validatorCount: number;
  delinquentCount: number;
  totalStake: number;
  // Helius priority-fee estimates (micro-lamports per CU)
  feeLevels: HeliusFeeEstimate;
  health: 'healthy' | 'degraded' | 'down';
  timestamp: number;
}

// ── Internal state ─────────────────────────────────────────

let cachedStatus: SolanaNetworkStatus | null = null;
let lastFetch = 0;
const CACHE_TTL = 25_000; // 25 s (refresh is 30 s)
let consecutiveFailures = 0;

// ── RPC helper ─────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ── Fallback (all RPC calls failed) ────────────────────────

function getUnavailableFallback(): SolanaNetworkStatus {
  return {
    tps: 0,
    slot: 0,
    epoch: 0,
    epochProgress: 0,
    blockTime: 0,
    validatorCount: 0,
    delinquentCount: 0,
    totalStake: 0,
    feeLevels: { min: 0, low: 0, medium: 0, high: 0, veryHigh: 0, unsafeMax: 0 },
    health: 'down',
    timestamp: Date.now(),
  };
}

// ── Main fetch ─────────────────────────────────────────────

export async function fetchNetworkStatus(): Promise<SolanaNetworkStatus> {
  const now = Date.now();
  if (cachedStatus && now - lastFetch < CACHE_TTL) return cachedStatus;

  try {
    // Fire all four RPC calls in parallel
    const [perfSamples, epochInfo, voteAccounts, feeEstimate] = await Promise.all([
      rpcCall<Array<{ numTransactions: number; samplePeriodSecs: number }>>(
        'getRecentPerformanceSamples', [1],
      ),
      rpcCall<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>(
        'getEpochInfo',
      ),
      rpcCall<{ current: Array<{ activatedStake: number }>; delinquent: Array<{ activatedStake: number }> }>(
        'getVoteAccounts',
      ),
      // Helius getPriorityFeeEstimate — requires accountKeys or transaction
      // Using well-known Solana program accounts for global fee market estimate
      rpcCall<{ priorityFeeLevels: HeliusFeeEstimate }>(
        'getPriorityFeeEstimate',
        [{
          accountKeys: [
            'ComputeBudget111111111111111111111111111111',
            '11111111111111111111111111111111',               // System Program
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // Token Program
          ],
          options: {
            includeAllPriorityFeeLevels: true,
          },
        }],
      ).catch((err) => {
        console.warn('[Solana RPC] getPriorityFeeEstimate failed:', err);
        return null;
      }),
    ]);

    const sample = perfSamples[0];
    const tps = sample ? Math.round(sample.numTransactions / sample.samplePeriodSecs) : 0;

    const totalStake = [...voteAccounts.current, ...voteAccounts.delinquent]
      .reduce((sum, v) => sum + v.activatedStake, 0) / 1e9;

    const slotMs = sample
      ? Math.round((sample.samplePeriodSecs * 1000) / Math.max(1, sample.samplePeriodSecs * 2.5))
      : 400;

    const defaultFees: HeliusFeeEstimate = { min: 0, low: 0, medium: 0, high: 0, veryHigh: 0, unsafeMax: 0 };

    // feeEstimate can be { priorityFeeLevels: {...} } or null
    let feeLevels: HeliusFeeEstimate = defaultFees;
    if (feeEstimate && typeof feeEstimate === 'object') {
      const raw = (feeEstimate as Record<string, unknown>);
      if (raw.priorityFeeLevels && typeof raw.priorityFeeLevels === 'object') {
        const pfl = raw.priorityFeeLevels as Record<string, unknown>;
        feeLevels = {
          min: Number(pfl.min) || 0,
          low: Number(pfl.low) || 0,
          medium: Number(pfl.medium) || 0,
          high: Number(pfl.high) || 0,
          veryHigh: Number(pfl.veryHigh) || 0,
          unsafeMax: Number(pfl.unsafeMax) || 0,
        };
      }
      // Log for debugging
      console.log('[Solana RPC] Fee estimate raw:', JSON.stringify(feeEstimate));
    }

    const status: SolanaNetworkStatus = {
      tps,
      slot: epochInfo.absoluteSlot,
      epoch: epochInfo.epoch,
      epochProgress: Math.round((epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100),
      blockTime: slotMs > 0 && slotMs < 2000 ? slotMs : 400,
      validatorCount: voteAccounts.current.length + voteAccounts.delinquent.length,
      delinquentCount: voteAccounts.delinquent.length,
      totalStake: Math.round(totalStake),
      feeLevels,
      health: voteAccounts.delinquent.length > voteAccounts.current.length * 0.1 ? 'degraded' : 'healthy',
      timestamp: now,
    };

    cachedStatus = status;
    lastFetch = now;
    consecutiveFailures = 0;
    return status;
  } catch (err) {
    console.warn('[Solana RPC] Helius call failed:', err);
    consecutiveFailures++;

    if (cachedStatus && now - cachedStatus.timestamp < 90_000) {
      return { ...cachedStatus, health: 'degraded' };
    }

    const fallback = getUnavailableFallback();
    cachedStatus = fallback;
    lastFetch = now;
    return fallback;
  }
}

export type { HeliusFeeEstimate };
