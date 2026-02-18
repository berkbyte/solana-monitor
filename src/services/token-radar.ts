// Token Radar service — trending tokens, new listings, volume spikes
// Uses Jupiter API + DexScreener for Solana token data

export interface TokenData {
  address: string;
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  volumeChange: number; // vs 7d average
  marketCap: number;
  liquidity: number;
  holders: number;
  lpLocked: boolean;
  mintAuthority: 'revoked' | 'active' | 'unknown';
  freezeAuthority: 'revoked' | 'active' | 'unknown';
  rugScore: number; // 0-100 (0=safe, 100=rug)
  rugVerdict: 'SAFE' | 'CAUTION' | 'HIGH_RISK' | 'CRITICAL';
  ageHours: number;
  tags: string[];
  trending: boolean;
  timestamp: number;
}

export interface NewPair {
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  dex: string;
  priceUsd: number;
  volume24h: number;
  liquidity: number;
  pairCreatedAt: number;
  txCount24h: number;
  rugScore: number;
}

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

let tokenCache: Map<string, TokenData> = new Map();
let trendingCache: TokenData[] = [];
let lastTokenFetch = 0;
const TOKEN_CACHE_TTL = 5 * 60_000; // 5 minutes

// Top Solana tokens to always track
const CORE_TOKENS = [
  'So11111111111111111111111111111111111111112',  // SOL (wrapped)
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  // JTO
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a',  // RLBB
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  // HNT
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RNDR
];

export async function fetchTokenPrices(mints: string[] = CORE_TOKENS): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const ids = mints.join(',');
    const res = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
    const data = await res.json();
    if (data.data) {
      for (const [mint, info] of Object.entries(data.data)) {
        const priceData = info as { price: string };
        prices.set(mint, parseFloat(priceData.price));
      }
    }
  } catch (err) {
    console.error('[Token Radar] Price fetch error:', err);
  }
  return prices;
}

export async function fetchTrendingTokens(): Promise<TokenData[]> {
  const now = Date.now();
  if (trendingCache.length > 0 && now - lastTokenFetch < TOKEN_CACHE_TTL) {
    return trendingCache;
  }

  try {
    const tokens: TokenData[] = [];
    const seen = new Set<string>();

    // 1. Fetch DexScreener trending tokens (Solana)
    try {
      const trendingRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
        signal: AbortSignal.timeout(8_000),
      });
      if (trendingRes.ok) {
        const trendingData = await trendingRes.json();
        if (Array.isArray(trendingData)) {
          const solanaTokens = trendingData.filter((t: any) => t.chainId === 'solana').slice(0, 15);
          for (const t of solanaTokens) {
            if (seen.has(t.tokenAddress)) continue;
            seen.add(t.tokenAddress);
          }
          // Batch-fetch pair data for these tokens
          if (seen.size > 0) {
            const addrs = Array.from(seen).slice(0, 15).join(',');
            const pairRes = await fetch(`${DEXSCREENER_API}/tokens/${addrs}`, {
              signal: AbortSignal.timeout(10_000),
            });
            if (pairRes.ok) {
              const pairData = await pairRes.json();
              if (pairData.pairs) {
                const bestPairs = new Map<string, any>();
                for (const pair of pairData.pairs) {
                  if (pair.chainId !== 'solana') continue;
                  const addr = pair.baseToken?.address;
                  if (!addr) continue;
                  const existing = bestPairs.get(addr);
                  if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
                    bestPairs.set(addr, pair);
                  }
                }
                for (const [addr, pair] of bestPairs) {
                  tokens.push(pairToTokenData(addr, pair, now, ['trending']));
                }
              }
            }
          }
        }
      }
    } catch { /* trending endpoint optional */ }

    // 2. Fetch boosted/promoted tokens
    try {
      const boostRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
        signal: AbortSignal.timeout(8_000),
      });
      if (boostRes.ok) {
        const boostData = await boostRes.json();
        if (Array.isArray(boostData)) {
          const solBoosts = boostData.filter((b: any) => b.chainId === 'solana' && !seen.has(b.tokenAddress)).slice(0, 10);
          const boostAddrs = solBoosts.map((b: any) => b.tokenAddress);
          if (boostAddrs.length > 0) {
            const pairRes = await fetch(`${DEXSCREENER_API}/tokens/${boostAddrs.join(',')}`, {
              signal: AbortSignal.timeout(10_000),
            });
            if (pairRes.ok) {
              const pairData = await pairRes.json();
              if (pairData.pairs) {
                const bestPairs = new Map<string, any>();
                for (const pair of pairData.pairs) {
                  if (pair.chainId !== 'solana') continue;
                  const addr = pair.baseToken?.address;
                  if (!addr || seen.has(addr)) continue;
                  const existing = bestPairs.get(addr);
                  if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
                    bestPairs.set(addr, pair);
                  }
                }
                for (const [addr, pair] of bestPairs) {
                  seen.add(addr);
                  tokens.push(pairToTokenData(addr, pair, now, ['boosted']));
                }
              }
            }
          }
        }
      }
    } catch { /* boost endpoint optional */ }

    // 3. Fetch top Solana pairs by volume as fallback
    try {
      const searchRes = await fetch(`${DEXSCREENER_API}/search?q=solana`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.pairs) {
          for (const pair of searchData.pairs) {
            if (pair.chainId !== 'solana') continue;
            const addr = pair.baseToken?.address;
            if (!addr || seen.has(addr)) continue;
            seen.add(addr);
            tokens.push(pairToTokenData(addr, pair, now, []));
            if (tokens.length >= 30) break;
          }
        }
      }
    } catch { /* search fallback optional */ }

    // Sort by volume descending, cap at 30
    tokens.sort((a, b) => b.volume24h - a.volume24h);
    const result = tokens.slice(0, 30);

    // Update caches
    tokenCache.clear();
    for (const t of result) tokenCache.set(t.address, t);
    trendingCache = result;
    lastTokenFetch = now;

    return result;
  } catch (err) {
    console.error('[Token Radar] Trending fetch error:', err);
    return trendingCache;
  }
}

function pairToTokenData(addr: string, pair: any, now: number, tags: string[]): TokenData {
  const token: TokenData = {
    address: addr,
    symbol: pair.baseToken?.symbol || '???',
    name: pair.baseToken?.name || 'Unknown',
    price: parseFloat(pair.priceUsd || '0'),
    priceChange24h: pair.priceChange?.h24 || 0,
    volume24h: pair.volume?.h24 || 0,
    volumeChange: 0,
    marketCap: pair.marketCap || pair.fdv || 0,
    liquidity: pair.liquidity?.usd || 0,
    holders: 0,
    lpLocked: false,
    mintAuthority: 'unknown',
    freezeAuthority: 'unknown',
    rugScore: calculateBasicRugScore(pair),
    rugVerdict: 'CAUTION',
    ageHours: pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 3_600_000 : 0,
    tags,
    trending: true,
    timestamp: now,
  };
  token.rugVerdict = getRugVerdict(token.rugScore);
  return token;
}

export async function fetchNewPairs(): Promise<NewPair[]> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/pairs/solana?sort=pairAge&order=asc`);
    const data = await res.json();

    if (!data.pairs) return [];

    return data.pairs.slice(0, 30).map((pair: Record<string, unknown>) => ({
      pairAddress: pair.pairAddress || '',
      baseToken: pair.baseToken || { address: '', symbol: '???', name: 'Unknown' },
      quoteToken: pair.quoteToken || { address: '', symbol: '???', name: 'Unknown' },
      dex: (pair.dexId as string) || 'unknown',
      priceUsd: parseFloat((pair.priceUsd as string) || '0'),
      volume24h: (pair.volume as Record<string, number>)?.h24 || 0,
      liquidity: (pair.liquidity as Record<string, number>)?.usd || 0,
      pairCreatedAt: pair.pairCreatedAt || Date.now(),
      txCount24h: ((pair.txns as Record<string, Record<string, number>>)?.h24?.buys || 0) + ((pair.txns as Record<string, Record<string, number>>)?.h24?.sells || 0),
      rugScore: calculateBasicRugScore(pair),
    }));
  } catch (err) {
    console.error('[Token Radar] New pairs error:', err);
    return [];
  }
}

function calculateBasicRugScore(pair: Record<string, unknown>): number {
  let score = 50; // Start neutral

  const liquidity = (pair.liquidity as Record<string, number>)?.usd || 0;
  const volume = (pair.volume as Record<string, number>)?.h24 || 0;
  const age = pair.pairCreatedAt
    ? (Date.now() - (pair.pairCreatedAt as number)) / 3_600_000
    : 0;

  // Low liquidity = risky
  if (liquidity < 1000) score += 30;
  else if (liquidity < 10000) score += 20;
  else if (liquidity < 50000) score += 10;
  else if (liquidity > 500000) score -= 15;

  // Very new = risky
  if (age < 1) score += 20;
  else if (age < 24) score += 10;
  else if (age > 168) score -= 10; // > 1 week

  // Volume to liquidity ratio (wash trading indicator)
  if (liquidity > 0 && volume / liquidity > 10) score += 15;

  // No volume = dead
  if (volume < 100) score += 10;

  return Math.max(0, Math.min(100, score));
}

function getRugVerdict(score: number): TokenData['rugVerdict'] {
  if (score <= 25) return 'SAFE';
  if (score <= 50) return 'CAUTION';
  if (score <= 75) return 'HIGH_RISK';
  return 'CRITICAL';
}

export { CORE_TOKENS };
