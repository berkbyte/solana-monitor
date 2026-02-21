// Whale Transactions Proxy — Helius Enhanced TX API only
// Proxies whale wallet transaction lookups server-side
// Uses Helius API key from env (no public RPC fallback)

import { corsHeaders } from './_cors.js';

function getHeliusKey() {
  const rpc = process.env.VITE_HELIUS_RPC_URL;
  if (!rpc) return null;
  try { return new URL(rpc).searchParams.get('api-key'); } catch { return null; }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const wallet = searchParams.get('wallet');

  if (!wallet) {
    return res.status(400).json({ error: 'wallet param required' });
  }

  const HELIUS_KEY = getHeliusKey();

  // Strategy 1: Helius Enhanced Transactions API
  if (HELIUS_KEY) {
    try {
      const heliusUrl = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&limit=100`;
      const r = await fetch(heliusUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const txs = await r.json();
        res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=10');
        return res.status(200).json({ source: 'helius', transactions: txs });
      }
      console.warn(`[whale-transactions] Helius returned ${r.status}`);
    } catch (_e) {
      console.error('[whale-transactions] Helius error:', _e);
    }
  }

  // No Helius key or Helius failed
  return res.status(502).json({ error: 'Helius API unavailable', source: 'none', transactions: [] });
}
