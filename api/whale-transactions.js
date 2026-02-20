// Whale Transactions Proxy — Helius Enhanced TX API + RPC fallback
// Proxies whale wallet transaction lookups server-side
// Uses Helius API key from env, falls back to public RPC

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
    } catch (_e) { /* fall through to RPC */ }
  }

  // Strategy 2: Public RPC fallback
  const rpcUrl = process.env.VITE_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
  try {
    const sigRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet, { limit: 10, commitment: 'confirmed' }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const sigJson = await sigRes.json();
    const sigs = sigJson.result || [];

    const transactions = [];
    for (const sig of sigs.slice(0, 5)) {
      if (sig.err) continue;
      try {
        const txRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getTransaction',
            params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
          }),
          signal: AbortSignal.timeout(8000),
        });
        const txJson = await txRes.json();
        if (txJson.result) {
          transactions.push({ ...txJson.result, signature: sig.signature, blockTime: txJson.result.blockTime || sig.blockTime });
        }
      } catch { /* skip */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=10');
    return res.status(200).json({ source: 'rpc', transactions, signatures: sigs });
  } catch (err) {
    console.error('[whale-transactions] Error:', err);
    return res.status(502).json({ error: 'Failed to fetch whale data', source: 'none', transactions: [] });
  }
}
