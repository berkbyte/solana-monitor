// Token Radar service — Gem hunter engine
// Finds potential gem tokens on Solana via DexScreener multi-signal scoring

export type GemTier = 'gem' | 'hot' | 'potential' | 'watch';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TokenData {
  address: string;
  pairAddress: string;
  symbol: string;
  name: string;
  price: number;
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  volume: { h1: number; h6: number; h24: number };
  txns: { h1Buys: number; h1Sells: number; h24Buys: number; h24Sells: number };
  marketCap: number;
  liquidity: number;
  ageHours: number;
  dex: string;
  // Scoring
  gemScore: number;      // 0-100 overall gem potential
  gemTier: GemTier;
  riskLevel: RiskLevel;
  // Sub-scores (each 0-25)
  momentumScore: number;  // price action across timeframes
  volumeScore: number;    // volume health & growth
  buyPressure: number;    // buy/sell ratio
  safetyScore: number;    // liquidity, age, wash detection
  // Flags
  tags: string[];
  timestamp: number;
}

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

let trendingCache: TokenData[] = [];
let lastFetch = 0;
const CACHE_TTL = 3 * 60_000; // 3 min

// Known stablecoins & wrapped tokens to exclude
const EXCLUDE_SYMBOLS = new Set([
  'USDC', 'USDT', 'USDH', 'UXD', 'DAI', 'BUSD', 'TUSD', 'FRAX',
  'SOL', 'WSOL', 'mSOL', 'stSOL', 'jitoSOL', 'bSOL', 'JSOL',
]);

export async function fetchTrendingTokens(): Promise<TokenData[]> {
  const now = Date.now();
  if (trendingCache.length > 0 && now - lastFetch < CACHE_TTL) {
    return trendingCache;
  }

  try {
    const tokens: TokenData[] = [];
    const seen = new Set<string>();

    // --- Source 1: DexScreener trending profiles (newest hype) ---
    const trendingAddrs = await fetchTrendingAddrs();
    if (trendingAddrs.length > 0) {
      const pairs = await fetchBestPairs(trendingAddrs.slice(0, 20));
      for (const [addr, pair] of pairs) {
        if (seen.has(addr) || EXCLUDE_SYMBOLS.has(pair.baseToken?.symbol?.toUpperCase())) continue;
        seen.add(addr);
        tokens.push(pairToGem(addr, pair, now, ['trending']));
      }
    }

    // --- Source 2: Boosted tokens ---
    const boostAddrs = await fetchBoostedAddrs(seen);
    if (boostAddrs.length > 0) {
      const pairs = await fetchBestPairs(boostAddrs.slice(0, 15));
      for (const [addr, pair] of pairs) {
        if (seen.has(addr) || EXCLUDE_SYMBOLS.has(pair.baseToken?.symbol?.toUpperCase())) continue;
        seen.add(addr);
        tokens.push(pairToGem(addr, pair, now, ['boosted']));
      }
    }

    // --- Source 3: Top gainers search (catches organic pumps) ---
    try {
      const res = await fetch(`${DEXSCREENER_API}/search?q=solana`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pairs) {
          for (const pair of data.pairs) {
            if (pair.chainId !== 'solana') continue;
            const addr = pair.baseToken?.address;
            if (!addr || seen.has(addr) || EXCLUDE_SYMBOLS.has(pair.baseToken?.symbol?.toUpperCase())) continue;
            seen.add(addr);
            tokens.push(pairToGem(addr, pair, now, []));
            if (tokens.length >= 40) break;
          }
        }
      }
    } catch { /* optional */ }

    // Sort by gem score, take top 30
    tokens.sort((a, b) => b.gemScore - a.gemScore);
    const result = tokens.slice(0, 30);

    trendingCache = result;
    lastFetch = now;
    return result;
  } catch (err) {
    console.error('[Token Radar] Fetch error:', err);
    return trendingCache;
  }
}

// ─── Data fetchers ────────────────────────────────────────

async function fetchTrendingAddrs(): Promise<string[]> {
  try {
    const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((t: any) => t.chainId === 'solana')
      .map((t: any) => t.tokenAddress)
      .filter(Boolean);
  } catch { return []; }
}

async function fetchBoostedAddrs(exclude: Set<string>): Promise<string[]> {
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((b: any) => b.chainId === 'solana' && !exclude.has(b.tokenAddress))
      .map((b: any) => b.tokenAddress)
      .filter(Boolean);
  } catch { return []; }
}

async function fetchBestPairs(addrs: string[]): Promise<Map<string, any>> {
  const best = new Map<string, any>();
  if (addrs.length === 0) return best;

  // DexScreener /tokens/ supports up to 30 comma-separated
  const chunks: string[][] = [];
  for (let i = 0; i < addrs.length; i += 30) {
    chunks.push(addrs.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${DEXSCREENER_API}/tokens/${chunk.join(',')}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.pairs) continue;
      for (const pair of data.pairs) {
        if (pair.chainId !== 'solana') continue;
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        const existing = best.get(addr);
        if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
          best.set(addr, pair);
        }
      }
    } catch { /* skip chunk */ }
  }
  return best;
}

// ─── Gem scoring engine ───────────────────────────────────

function pairToGem(addr: string, pair: any, now: number, tags: string[]): TokenData {
  const priceChange = {
    m5: pair.priceChange?.m5 || 0,
    h1: pair.priceChange?.h1 || 0,
    h6: pair.priceChange?.h6 || 0,
    h24: pair.priceChange?.h24 || 0,
  };
  const volume = {
    h1: pair.volume?.h1 || 0,
    h6: pair.volume?.h6 || 0,
    h24: pair.volume?.h24 || 0,
  };
  const txns = {
    h1Buys: pair.txns?.h1?.buys || 0,
    h1Sells: pair.txns?.h1?.sells || 0,
    h24Buys: pair.txns?.h24?.buys || 0,
    h24Sells: pair.txns?.h24?.sells || 0,
  };
  const liquidity = pair.liquidity?.usd || 0;
  const marketCap = pair.marketCap || pair.fdv || 0;
  const ageHours = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 3_600_000 : 0;

  // Calculate sub-scores
  const momentumScore = calcMomentumScore(priceChange);
  const volumeScore = calcVolumeScore(volume, liquidity, marketCap);
  const buyPressure = calcBuyPressure(txns);
  const safetyScore = calcSafetyScore(liquidity, ageHours, volume, txns);

  const gemScore = Math.round(momentumScore + volumeScore + buyPressure + safetyScore);

  const token: TokenData = {
    address: addr,
    pairAddress: pair.pairAddress || '',
    symbol: pair.baseToken?.symbol || '???',
    name: pair.baseToken?.name || 'Unknown',
    price: parseFloat(pair.priceUsd || '0'),
    priceChange,
    volume,
    txns,
    marketCap,
    liquidity,
    ageHours,
    dex: pair.dexId || 'unknown',
    gemScore,
    gemTier: getGemTier(gemScore),
    riskLevel: getRiskLevel(safetyScore),
    momentumScore: Math.round(momentumScore),
    volumeScore: Math.round(volumeScore),
    buyPressure: Math.round(buyPressure),
    safetyScore: Math.round(safetyScore),
    tags,
    timestamp: now,
  };
  return token;
}

/** Momentum: price action across timeframes (0-25) */
function calcMomentumScore(pc: TokenData['priceChange']): number {
  let s = 0;

  // Positive h1 = recent pump (strong signal)
  if (pc.h1 > 50) s += 10;
  else if (pc.h1 > 20) s += 8;
  else if (pc.h1 > 5) s += 5;
  else if (pc.h1 > 0) s += 2;

  // h6 momentum
  if (pc.h6 > 100) s += 6;
  else if (pc.h6 > 30) s += 4;
  else if (pc.h6 > 10) s += 3;
  else if (pc.h6 > 0) s += 1;

  // h24 trend
  if (pc.h24 > 200) s += 5;
  else if (pc.h24 > 50) s += 4;
  else if (pc.h24 > 10) s += 2;
  else if (pc.h24 > 0) s += 1;

  // Penalty for dumping across ALL timeframes (dead cat bounce)
  if (pc.h1 < -10 && pc.h6 < -20 && pc.h24 < -30) s -= 5;

  // Accelerating momentum bonus (h1 > h6_avg > h24_avg)
  const h6avg = pc.h6 / 6;
  const h24avg = pc.h24 / 24;
  if (pc.h1 > h6avg && h6avg > h24avg && pc.h1 > 5) s += 4;

  return Math.max(0, Math.min(25, s));
}

/** Volume health & growth (0-25) */
function calcVolumeScore(vol: TokenData['volume'], liq: number, mcap: number): number {
  let s = 0;

  // Absolute volume thresholds
  if (vol.h24 > 500_000) s += 6;
  else if (vol.h24 > 100_000) s += 4;
  else if (vol.h24 > 10_000) s += 2;

  // Volume acceleration: h1 vol projected to 24h vs actual h24
  const projectedH1 = vol.h1 * 24;
  if (vol.h24 > 0 && projectedH1 > vol.h24 * 2) s += 7; // 2x acceleration
  else if (vol.h24 > 0 && projectedH1 > vol.h24 * 1.5) s += 5;
  else if (vol.h24 > 0 && projectedH1 > vol.h24) s += 3;

  // Volume/MCap ratio (interest relative to size)
  if (mcap > 0) {
    const vmRatio = vol.h24 / mcap;
    if (vmRatio > 1) s += 6;       // vol > mcap = extreme interest
    else if (vmRatio > 0.5) s += 4;
    else if (vmRatio > 0.1) s += 2;
  }

  // Volume/Liquidity health (should be balanced)
  if (liq > 0) {
    const vlRatio = vol.h24 / liq;
    // Sweet spot: 2x-20x
    if (vlRatio >= 2 && vlRatio <= 20) s += 4;
    else if (vlRatio > 50) s -= 2; // possible wash
  }

  // Penalty: no recent volume
  if (vol.h1 < 100) s -= 3;

  return Math.max(0, Math.min(25, s));
}

/** Buy pressure: buy/sell tx ratio (0-25) */
function calcBuyPressure(txns: TokenData['txns']): number {
  let s = 0;
  const totalH1 = txns.h1Buys + txns.h1Sells;
  const totalH24 = txns.h24Buys + txns.h24Sells;

  // h1 buy ratio
  if (totalH1 > 5) {
    const buyRatio = txns.h1Buys / totalH1;
    if (buyRatio > 0.7) s += 10;
    else if (buyRatio > 0.6) s += 7;
    else if (buyRatio > 0.55) s += 4;
    else if (buyRatio < 0.35) s -= 3; // heavy selling
  }

  // h24 buy ratio
  if (totalH24 > 20) {
    const buyRatio24 = txns.h24Buys / totalH24;
    if (buyRatio24 > 0.65) s += 7;
    else if (buyRatio24 > 0.55) s += 5;
    else if (buyRatio24 > 0.5) s += 3;
    else if (buyRatio24 < 0.35) s -= 3;
  }

  // Transaction count bonus (activity = interest)
  if (totalH24 > 1000) s += 5;
  else if (totalH24 > 500) s += 4;
  else if (totalH24 > 100) s += 3;
  else if (totalH24 > 30) s += 1;

  // Increasing h1 activity vs h24 average
  const avgH1fromH24 = totalH24 / 24;
  if (avgH1fromH24 > 0 && totalH1 > avgH1fromH24 * 2) s += 3;

  return Math.max(0, Math.min(25, s));
}

/** Safety score: liquidity, age, wash detection (0-25) */
function calcSafetyScore(liq: number, ageH: number, vol: TokenData['volume'], txns: TokenData['txns']): number {
  let s = 12; // start at midpoint

  // Liquidity thresholds
  if (liq > 500_000) s += 6;
  else if (liq > 100_000) s += 4;
  else if (liq > 30_000) s += 2;
  else if (liq > 10_000) s += 0;
  else if (liq < 5_000) s -= 4;
  else if (liq < 1_000) s -= 8;

  // Age sweet-spot: 1h-72h is ideal for gems
  if (ageH >= 1 && ageH <= 72) s += 4;
  else if (ageH > 72 && ageH <= 168) s += 2;
  else if (ageH < 0.5) s -= 3; // too fresh = possible rug
  else if (ageH > 720) s -= 1; // already known / old

  // Wash trading detection: vol >> liq with low tx count
  const totalH24 = txns.h24Buys + txns.h24Sells;
  if (liq > 0 && vol.h24 / liq > 30 && totalH24 < 50) s -= 6;

  // No transactions = suspicious
  if (totalH24 < 5) s -= 5;

  return Math.max(0, Math.min(25, s));
}

function getGemTier(score: number): GemTier {
  if (score >= 70) return 'gem';
  if (score >= 55) return 'hot';
  if (score >= 40) return 'potential';
  return 'watch';
}

function getRiskLevel(safetyScore: number): RiskLevel {
  if (safetyScore >= 18) return 'low';
  if (safetyScore >= 12) return 'medium';
  if (safetyScore >= 6) return 'high';
  return 'critical';
}

// Re-export CORE_TOKENS for other parts of the app
const CORE_TOKENS = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
];

export { CORE_TOKENS };
