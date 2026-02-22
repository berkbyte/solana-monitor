// NFT Stats API — proxies Magic Eden v2 collection stats
// Returns floor price (lamports), listed count, avg 24h price, all-time volume
// for the top Solana NFT collections. Client divides by 1e9 for SOL.

import { corsHeaders } from './_cors.js';

const ME_API = 'https://api-mainnet.magiceden.dev/v2';

// Slugs MUST match Magic Eden /v2/collections/{slug}/stats
const SLUGS = [
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

async function fetchOne(slug) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(`${ME_API}/collections/${slug}/stats`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    // IMPORTANT: always use input slug, not d.symbol — keeps client mapping stable
    return {
      slug,
      floorPrice:   Number(d.floorPrice)   || 0,   // lamports
      listedCount:  Number(d.listedCount)   || 0,
      avgPrice24hr: Number(d.avgPrice24hr)  || 0,   // lamports
      volumeAll:    Number(d.volumeAll)     || 0,   // lamports
    };
  } catch {
    clearTimeout(t);
    return null;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const hdrs = corsHeaders(origin);
  Object.entries(hdrs).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Serve cache if fresh
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(cache);
  }

  try {
    const results = await Promise.allSettled(SLUGS.map(fetchOne));
    const collections = results
      .map(r => (r.status === 'fulfilled' ? r.value : null))
      .filter(Boolean);

    const data = { collections, timestamp: now };
    cache = data;
    cacheTs = now;

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[nft-stats] Error:', err.message);
    if (cache) return res.status(200).json(cache);
    return res.status(500).json({ error: 'Failed to fetch NFT stats' });
  }
}
