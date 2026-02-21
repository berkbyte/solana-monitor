// Validators.app Proxy — fetches all Solana validators with geo, Jito flag, scores
// Requires VITE_VALIDATORS_APP_TOKEN env var (or uses default token)
// Rate limit: 20 req / 5 min — Vercel caches via s-maxage

import { corsHeaders } from './_cors.js';

const TOKEN = process.env.VITE_VALIDATORS_APP_TOKEN || 'WPAQGS3PbDtgjtkPiZXW6AEG';
const API_URL = 'https://www.validators.app/api/v1/validators/mainnet.json?limit=9999&active_only=true';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(API_URL, {
      headers: {
        'Accept': 'application/json',
        'Token': TOKEN,
      },
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      console.error(`[validators-app] HTTP ${response.status}`);
      return res.status(response.status === 429 ? 429 : 502).json([]);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length < 100) {
      console.error(`[validators-app] Only ${Array.isArray(data) ? data.length : 0} validators`);
      return res.status(502).json([]);
    }

    console.log(`[validators-app] ✅ ${data.length} validators`);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[validators-app] Error:', err);
    return res.status(502).json([]);
  }
}
