// Solana network status API — TPS, epoch, validators, priority fees
// Edge function that proxies Solana RPC calls

import { createUpstashCache } from './_upstash-cache.js';
import { corsHeaders } from './_cors.js';

const HELIUS_RPC = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
const cache = createUpstashCache('solana-network', 10); // 10 second cache

async function rpcCall(method, params = []) {
  const res = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || req.headers.referer || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  try {
    // Check cache
    const cached = await cache.get('status');
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5');
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).json(cached);
    }

    const [perfSamples, epochInfo, voteAccounts, recentFees, health] = await Promise.all([
      rpcCall('getRecentPerformanceSamples', [1]),
      rpcCall('getEpochInfo'),
      rpcCall('getVoteAccounts'),
      rpcCall('getRecentPrioritizationFees'),
      rpcCall('getHealth').catch(() => 'unknown'),
    ]);

    const sample = perfSamples[0];
    const tps = sample ? Math.round(sample.numTransactions / sample.samplePeriodSecs) : 0;

    const currentValidators = voteAccounts.current || [];
    const delinquentValidators = voteAccounts.delinquent || [];
    const totalStake = [...currentValidators, ...delinquentValidators]
      .reduce((sum, v) => sum + (v.activatedStake || 0), 0);

    const fees = (recentFees || [])
      .map(f => f.prioritizationFee)
      .filter(f => f > 0)
      .sort((a, b) => a - b);
    const medianFee = fees.length > 0 ? fees[Math.floor(fees.length / 2)] : 0;
    const avgFee = fees.length > 0 ? Math.round(fees.reduce((s, f) => s + f, 0) / fees.length) : 0;

    const result = {
      tps,
      slot: epochInfo.absoluteSlot,
      epoch: epochInfo.epoch,
      epochProgress: Math.round((epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100),
      epochSlotIndex: epochInfo.slotIndex,
      epochTotalSlots: epochInfo.slotsInEpoch,
      validatorCount: currentValidators.length,
      delinquentCount: delinquentValidators.length,
      totalStakeLamports: totalStake,
      totalStakeSOL: Math.round(totalStake / 1e9),
      avgPriorityFee: avgFee,
      medianPriorityFee: medianFee,
      priorityFeeLevels: {
        low: Math.max(1, Math.round(medianFee * 0.5)),
        medium: Math.max(100, medianFee),
        high: Math.max(1000, Math.round(medianFee * 2)),
        turbo: Math.max(10000, Math.round(medianFee * 5)),
      },
      health: health === 'ok' ? 'healthy' : delinquentValidators.length > currentValidators.length * 0.1 ? 'degraded' : 'healthy',
      timestamp: Date.now(),
    };

    await cache.set('status', result, 10);

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(result);
  } catch (err) {
    console.error('[solana-network] Error:', err.message);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'Failed to fetch network status', message: err.message });
  }
}
