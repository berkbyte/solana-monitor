// Solana RPC service — network status, TPS, slot, epoch, priority fees
// Uses Helius as primary, public RPC as fallback

const HELIUS_RPC = import.meta.env.VITE_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Multiple RPC endpoints for redundancy
const RPC_ENDPOINTS = [
  HELIUS_RPC,
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
];

interface SolanaNetworkStatus {
  tps: number;
  slot: number;
  epoch: number;
  epochProgress: number;
  blockTime: number;
  validatorCount: number;
  delinquentCount: number;
  totalStake: number;
  avgPriorityFee: number;
  medianPriorityFee: number;
  health: 'healthy' | 'degraded' | 'down';
  timestamp: number;
}

interface PriorityFeeLevel {
  level: 'low' | 'medium' | 'high' | 'turbo';
  fee: number; // in microlamports per CU
  label: string;
}

let cachedStatus: SolanaNetworkStatus | null = null;
let lastFetch = 0;
const CACHE_TTL = 5_000; // 5 seconds
let currentEndpointIdx = 0;
let consecutiveFailures = 0;

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const endpoint = RPC_ENDPOINTS[currentEndpointIdx] || RPC_ENDPOINTS[0]!;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function getUnavailableFallback(): SolanaNetworkStatus {
  // Return zeros/defaults instead of fake random data when all RPCs fail
  // The UI should detect health='down' and show a warning
  return {
    tps: 0,
    slot: 0,
    epoch: 0,
    epochProgress: 0,
    blockTime: 0,
    validatorCount: 0,
    delinquentCount: 0,
    totalStake: 0,
    avgPriorityFee: 0,
    medianPriorityFee: 0,
    health: 'down',
    timestamp: Date.now(),
  };
}

export async function fetchNetworkStatus(): Promise<SolanaNetworkStatus> {
  const now = Date.now();
  if (cachedStatus && now - lastFetch < CACHE_TTL) return cachedStatus;

  // Try each endpoint on failure
  for (let attempt = 0; attempt < RPC_ENDPOINTS.length; attempt++) {
    try {
      const [perfSamples, epochInfo, voteAccounts, recentFees] = await Promise.all([
        rpcCall<Array<{ numTransactions: number; samplePeriodSecs: number }>>('getRecentPerformanceSamples', [1]),
        rpcCall<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>('getEpochInfo'),
        rpcCall<{ current: Array<{ activatedStake: number }>; delinquent: Array<{ activatedStake: number }> }>('getVoteAccounts'),
        rpcCall<Array<{ prioritizationFee: number }>>('getRecentPrioritizationFees'),
      ]);

      const sample = perfSamples[0];
      const tps = sample ? Math.round(sample.numTransactions / sample.samplePeriodSecs) : 0;

      const totalStake = [...voteAccounts.current, ...voteAccounts.delinquent]
        .reduce((sum, v) => sum + v.activatedStake, 0) / 1e9;

      const fees = recentFees.map(f => f.prioritizationFee).filter(f => f > 0).sort((a, b) => a - b);
      const medianFee: number = fees.length > 0 ? fees[Math.floor(fees.length / 2)]! : 0;
      const avgFee = fees.length > 0 ? Math.round(fees.reduce((s, f) => s + f, 0) / fees.length) : 0;

      const status: SolanaNetworkStatus = {
        tps,
        slot: epochInfo.absoluteSlot,
        epoch: epochInfo.epoch,
        epochProgress: Math.round((epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100),
        blockTime: 400,
        validatorCount: voteAccounts.current.length,
        delinquentCount: voteAccounts.delinquent.length,
        totalStake: Math.round(totalStake),
        avgPriorityFee: avgFee,
        medianPriorityFee: medianFee,
        health: voteAccounts.delinquent.length > voteAccounts.current.length * 0.1 ? 'degraded' : 'healthy',
        timestamp: now,
      };

      cachedStatus = status;
      lastFetch = now;
      consecutiveFailures = 0;
      return status;
    } catch (err) {
      console.warn(`[Solana RPC] Endpoint ${currentEndpointIdx} failed:`, err);
      currentEndpointIdx = (currentEndpointIdx + 1) % RPC_ENDPOINTS.length;
    }
  }

  // All endpoints failed — return last cached data if available, otherwise unavailable
  consecutiveFailures++;
  console.error(`[Solana RPC] All endpoints failed (attempt #${consecutiveFailures})`);
  if (cachedStatus && now - cachedStatus.timestamp < 60_000) {
    // Return stale cache but mark as degraded
    return { ...cachedStatus, health: 'degraded' };
  }

  const fallback = getUnavailableFallback();
  cachedStatus = fallback;
  lastFetch = now;
  return fallback;
}

export function getPriorityFeeLevels(medianFee: number): PriorityFeeLevel[] {
  return [
    { level: 'low', fee: Math.max(1, Math.round(medianFee * 0.5)), label: 'Economy' },
    { level: 'medium', fee: Math.max(100, medianFee), label: 'Standard' },
    { level: 'high', fee: Math.max(1000, Math.round(medianFee * 2)), label: 'Fast' },
    { level: 'turbo', fee: Math.max(10000, Math.round(medianFee * 5)), label: 'Turbo' },
  ];
}

export type { SolanaNetworkStatus, PriorityFeeLevel };
