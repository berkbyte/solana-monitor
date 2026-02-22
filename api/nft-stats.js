// NFT Stats API — proxies Magic Eden v2 collection stats
// Fetches floor price, listed count, avg price for top Solana NFT collections

import { corsHeaders } from './_cors.js';

const ME_API = 'https://api-mainnet.magiceden.dev/v2';

// Top Solana NFT collections — slugs match Magic Eden /v2/collections/{slug}/stats
const TOP_SLUGS = [
  'mad_lads',
  'tensorians',
  'claynosaurz',
  'famous_fox_federation',
  'okay_bears',
  'degods',
  'solana_monkey_business',
  'froganas',
  'transdimensional_fox_federation',
  'aurory',
];

let cache = null;
let cacheTs = 0;
const CACHE_TTL = 300_000; // 5 min

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  // Return cache if fresh
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(cache);
  }

  try {
    // Fan out requests to ME v2 stats for each collection (parallel)
    const results = await Promise.allSettled(
      TOP_SLUGS.map(async (slug) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        try {
          const r = await fetch(`${ME_API}/collections/${slug}/stats`, {
            signal: ctrl.signal,
            headers: { Accept: 'application/json' },
          });
          clearTimeout(t);
          if (!r.ok) return null;
          const d = await r.json();
          return {
            slug: d.symbol || slug,
            floorPrice: d.floorPrice || 0,          // lamports
            listedCount: d.listedCount || 0,
            avgPrice24hr: d.avgPrice24hr || 0,       // lamports
            volumeAll: d.volumeAll || 0,             // lamports
          };
        } catch {
          clearTimeout(t);
          return null;
        }
      })
    );

    const collections = results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);

    const data = { collections, timestamp: now };

    // Update cache
    cache = data;
    cacheTs = now;

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(data);
  } catch (err) {
    console.error('[nft-stats] Error:', err.message);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

    // Return stale cache if available
    if (cache) {
      return res.status(200).json(cache);
    }
    return res.status(500).json({ error: 'Failed to fetch NFT stats' });
  }
}
