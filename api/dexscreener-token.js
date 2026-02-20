// DexScreener Token Proxy — server-side CORS bypass for token lookups
// Used by Token Analyze to fetch pair data for any Solana mint address

import { corsHeaders } from './_cors.js';

const CACHE = new Map();
const CACHE_TTL = 60_000; // 1 min

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const mint = (searchParams.get('mint') || '').trim();

  if (!mint || mint.length < 30) {
    return res.status(400).json({ error: 'Missing or invalid mint address' });
  }

  // Cache check
  const cached = CACHE.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    let pairs = [];

    // Try both endpoints in parallel, use whichever returns first with data
    const [v1Result, legacyResult] = await Promise.allSettled([
      fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, {
        signal: AbortSignal.timeout(8000),
      }).then(async (r) => {
        if (!r.ok) return [];
        const d = await r.json();
        return Array.isArray(d) && d.length > 0 ? d : [];
      }),
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        signal: AbortSignal.timeout(8000),
      }).then(async (r) => {
        if (!r.ok) return [];
        const d = await r.json();
        if (d.pairs && d.pairs.length > 0) {
          const solPairs = d.pairs.filter((p) => p.chainId === 'solana');
          return solPairs.length > 0 ? solPairs : d.pairs;
        }
        return [];
      }),
    ]);

    // Prefer v1 results, fallback to legacy
    if (v1Result.status === 'fulfilled' && v1Result.value.length > 0) {
      pairs = v1Result.value;
    } else if (legacyResult.status === 'fulfilled' && legacyResult.value.length > 0) {
      pairs = legacyResult.value;
    }

    if (pairs.length === 0) {
      return res.status(200).json({ pairs: [] });
    }

    // Sort by liquidity descending
    pairs.sort((a, b) => {
      const liqA = typeof a.liquidity === 'number' ? a.liquidity : (a.liquidity?.usd || 0);
      const liqB = typeof b.liquidity === 'number' ? b.liquidity : (b.liquidity?.usd || 0);
      return liqB - liqA;
    });

    const result = { pairs };
    CACHE.set(mint, { data: result, ts: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[dexscreener-token] Error:', err);
    return res.status(502).json({ pairs: [], error: 'Failed to fetch token data' });
  }
}
