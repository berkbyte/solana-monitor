// /api/nft-stats — Proxy for Magic Eden collection stats (avoids CORS)
import { allowCors } from './_cors.js';

const TOP_COLLECTIONS = [
  'mad_lads', 'tensorians', 'claynosaurz', 'famous_fox_federation',
  'okay_bears', 'degods', 'solana_monkey_business', 'bonk_nfts',
  'marinade_chefs', 'aurory',
];

async function handler(req, res) {
  const slug = req.query?.slug;

  // If slug given, fetch single collection
  if (slug && typeof slug === 'string') {
    try {
      const r = await fetch(
        `https://api-mainnet.magiceden.dev/v2/collections/${encodeURIComponent(slug)}/stats`,
        { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return res.status(r.status).json({ error: `ME API ${r.status}` });
      const d = await r.json();
      return res.status(200).json(d);
    } catch (e) {
      return res.status(502).json({ error: e.message || 'fetch failed' });
    }
  }

  // Otherwise batch-fetch all top collections
  const results = await Promise.allSettled(
    TOP_COLLECTIONS.map(async (s) => {
      const r = await fetch(
        `https://api-mainnet.magiceden.dev/v2/collections/${s}/stats`,
        { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return { slug: s, error: r.status };
      const d = await r.json();
      return { slug: s, ...d };
    })
  );

  const collections = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(c => c && !c.error);

  res.status(200).json({ collections });
}

export default allowCors(handler);
