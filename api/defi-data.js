// DeFi data API — protocol TVL, liquid staking stats
// Edge function proxying DeFi Llama

import { corsHeaders } from './_cors.js';

const DEFILLAMA_API = 'https://api.llama.fi';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const action = searchParams.get('action') || 'overview';

  try {
    let result;

    switch (action) {
      case 'overview': {
        const protocolRes = await fetch(`${DEFILLAMA_API}/protocols`);
        const allProtocols = await protocolRes.json();

        const solanaProtocols = allProtocols
          .filter(p => p.chains && p.chains.includes('Solana'))
          .map(p => ({
            name: p.name,
            slug: p.slug,
            tvl: p.tvl || 0,
            change24h: p.change_1d || 0,
            change7d: p.change_7d || 0,
            category: p.category || 'Other',
            logo: p.logo || '',
            url: p.url || '',
          }))
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, 30);

        const totalTvl = solanaProtocols.reduce((sum, p) => sum + p.tvl, 0);

        result = {
          totalTvl,
          protocols: solanaProtocols,
          categories: groupByCategory(solanaProtocols),
          timestamp: Date.now(),
        };
        break;
      }

      case 'protocol': {
        const slug = searchParams.get('slug');
        if (!slug || !/^[a-zA-Z0-9-]+$/.test(slug)) {
          return res.status(400).json({ error: 'Invalid slug' });
        }
        const pRes = await fetch(`${DEFILLAMA_API}/protocol/${slug}`);
        result = await pRes.json();
        break;
      }

      case 'yields': {
        const yieldRes = await fetch(`${DEFILLAMA_API}/pools`);
        const allPools = await yieldRes.json();
        const solanaPools = (allPools.data || [])
          .filter(p => p.chain === 'Solana' && p.tvlUsd > 100000)
          .sort((a, b) => b.tvlUsd - a.tvlUsd)
          .slice(0, 30)
          .map(p => ({
            pool: p.pool,
            project: p.project,
            symbol: p.symbol,
            tvl: p.tvlUsd,
            apy: p.apy,
            apyBase: p.apyBase,
            apyReward: p.apyReward,
            rewardTokens: p.rewardTokens,
          }));
        result = { pools: solanaPools, timestamp: Date.now() };
        break;
      }

      default:
        result = { error: 'Unknown action. Use: overview, protocol, yields' };
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(result);
  } catch (err) {
    console.error('[defi-data] Error:', err.message);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'Failed to fetch DeFi data' });
  }
}

function groupByCategory(protocols) {
  const cats = {};
  for (const p of protocols) {
    if (!cats[p.category]) {
      cats[p.category] = { tvl: 0, count: 0, protocols: [] };
    }
    cats[p.category].tvl += p.tvl;
    cats[p.category].count++;
    cats[p.category].protocols.push(p.name);
  }
  return cats;
}
