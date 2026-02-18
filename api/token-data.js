// Token data API — Jupiter prices, DexScreener trending, rug analysis
// Edge function that aggregates Solana token intelligence

import { corsHeaders } from './_cors.js';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Core Solana tokens to always track
const CORE_TOKENS = [
  'So11111111111111111111111111111111111111112',  // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  // JTO
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  // HNT
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RNDR
];

function calculateRugScore(pair) {
  let score = 50;
  const liquidity = pair.liquidity?.usd || 0;
  const volume = pair.volume?.h24 || 0;
  const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 0;

  if (liquidity < 1000) score += 30;
  else if (liquidity < 10000) score += 20;
  else if (liquidity < 50000) score += 10;
  else if (liquidity > 500000) score -= 15;

  if (age < 1) score += 20;
  else if (age < 24) score += 10;
  else if (age > 168) score -= 10;

  if (liquidity > 0 && volume / liquidity > 10) score += 15;
  if (volume < 100) score += 10;

  return Math.max(0, Math.min(100, score));
}

function getVerdict(score) {
  if (score <= 25) return 'SAFE';
  if (score <= 50) return 'CAUTION';
  if (score <= 75) return 'HIGH_RISK';
  return 'CRITICAL';
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const action = searchParams.get('action') || 'prices';

  try {
    let result;

    switch (action) {
      case 'prices': {
        const mints = searchParams.get('mints') || CORE_TOKENS.join(',');
        const priceRes = await fetch(`${JUPITER_PRICE_API}?ids=${mints}`);
        result = await priceRes.json();
        break;
      }

      case 'trending': {
        const trendRes = await fetch(`${DEXSCREENER_API}/search?q=solana`);
        const trendData = await trendRes.json();
        const solanaPairs = (trendData.pairs || [])
          .filter(p => p.chainId === 'solana')
          .slice(0, 50)
          .map(p => ({
            address: p.baseToken?.address,
            symbol: p.baseToken?.symbol,
            name: p.baseToken?.name,
            price: parseFloat(p.priceUsd || '0'),
            priceChange24h: p.priceChange?.h24 || 0,
            volume24h: p.volume?.h24 || 0,
            liquidity: p.liquidity?.usd || 0,
            marketCap: p.marketCap || 0,
            rugScore: calculateRugScore(p),
            rugVerdict: getVerdict(calculateRugScore(p)),
            pairAddress: p.pairAddress,
            dex: p.dexId,
            ageHours: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3600000 : 0,
          }));
        result = { tokens: solanaPairs, timestamp: Date.now() };
        break;
      }

      case 'new-pairs': {
        const newRes = await fetch(`${DEXSCREENER_API}/tokens/solana`);
        const newData = await newRes.json();
        const newPairs = (newData.pairs || [])
          .slice(0, 30)
          .map(p => ({
            pairAddress: p.pairAddress,
            baseToken: p.baseToken,
            quoteToken: p.quoteToken,
            dex: p.dexId,
            priceUsd: parseFloat(p.priceUsd || '0'),
            volume24h: p.volume?.h24 || 0,
            liquidity: p.liquidity?.usd || 0,
            pairCreatedAt: p.pairCreatedAt,
            rugScore: calculateRugScore(p),
          }));
        result = { pairs: newPairs, timestamp: Date.now() };
        break;
      }

      default:
        result = { error: 'Unknown action. Use: prices, trending, new-pairs' };
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=15');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(result);
  } catch (err) {
    console.error('[token-data] Error:', err.message);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'Failed to fetch token data' });
  }
}
