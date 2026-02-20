// Solana RPC Proxy — server-side proxy for getVoteAccounts, getClusterNodes etc.
// Avoids browser CORS and rate-limiting on public Solana RPC endpoints
// Uses Helius RPC if available, falls back to public endpoints

import { corsHeaders } from './_cors.js';

function getRpcEndpoints() {
  const endpoints = [];
  const helius = process.env.VITE_HELIUS_RPC_URL;
  if (helius) endpoints.push(helius);
  endpoints.push('https://api.mainnet-beta.solana.com');
  endpoints.push('https://rpc.ankr.com/solana');
  return endpoints;
}

const ALLOWED_METHODS = ['getVoteAccounts', 'getClusterNodes', 'getEpochInfo', 'getVersion'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse body
  let body;
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const method = body.method || '';
  if (!ALLOWED_METHODS.includes(method)) {
    return res.status(403).json({ error: `Method not allowed: ${method}` });
  }

  const endpoints = getRpcEndpoints();

  for (const endpoint of endpoints) {
    try {
      const timeout = method === 'getVoteAccounts' ? 60000 : 30000;
      const rpcRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id || 1,
          method,
          params: body.params || [],
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!rpcRes.ok) continue;

      const data = await rpcRes.json();
      if (data.error) continue;

      if (data.result !== undefined) {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=15');
        return res.status(200).json(data);
      }
    } catch (_e) {
      continue;
    }
  }

  return res.status(502).json({
    jsonrpc: '2.0',
    id: body.id || 1,
    error: { code: -32000, message: 'All RPC endpoints failed' },
  });
}
