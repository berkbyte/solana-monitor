// Solana AI Token Brief generator — uses Groq to create short, actionable token analysis
// Replaces World Monitor's country brief AI with Solana-native intelligence

import { corsHeaders } from './_cors.js';
import { createUpstashCache } from './_upstash-cache.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const cache = createUpstashCache('token-brief', 3600); // 1 hour cache

const SYSTEM_PROMPT = `You are a Solana DeFi analyst writing concise intelligence briefs for crypto traders. Your tone is direct, confident, and slightly degen — no fluff, no disclaimers. Think "Bloomberg terminal meets Crypto Twitter."

Rules:
- Max 120 words
- Start with a one-word verdict: BULLISH, BEARISH, NEUTRAL, or AVOID
- Give 2-3 key reasons with specific numbers
- End with a one-line risk callout if rug score is high
- Use emoji sparingly: 🟢 bullish signal, 🔴 bearish signal, ⚠️ caution
- Reference data sources with [1], [2] notation
- Never say "this is not financial advice"
- If data is thin, say "Low data confidence — DYOR" instead of making things up`;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (!GROQ_API_KEY) {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(503).json({ error: 'AI not configured', brief: null });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token, data } = body || {};

    if (!token) {
      return res.status(400).json({ error: 'Missing token parameter' });
    }

    // Check cache
    const cacheKey = `brief:${token.toLowerCase()}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).json(cached);
    }

    const userPrompt = buildTokenPrompt(token, data);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    const groqData = await groqRes.json();
    const brief = groqData.choices?.[0]?.message?.content || null;

    const result = {
      token,
      brief,
      model: 'llama-3.1-8b',
      timestamp: Date.now(),
    };

    if (brief) {
      await cache.set(cacheKey, result, 3600);
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json(result);
  } catch (err) {
    console.error('[token-brief] Error:', err.message);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'AI analysis failed' });
  }
}

function buildTokenPrompt(token, data) {
  if (!data) {
    return `Generate a brief intelligence analysis for the Solana token: ${token}. Note: Limited on-chain data available.`;
  }

  return `Analyze this Solana token:

Token: ${data.symbol || token} (${data.name || 'Unknown'})
Price: $${data.price || '?'}
24h Change: ${data.priceChange24h || '?'}%
24h Volume: $${formatNum(data.volume24h)}
Market Cap: $${formatNum(data.marketCap)}
Liquidity: $${formatNum(data.liquidity)}
Holders: ${data.holders || '?'}
LP Locked: ${data.lpLocked || '?'}
Mint Authority: ${data.mintAuthority || '?'}
Freeze Authority: ${data.freezeAuthority || '?'}
Rug Score: ${data.rugScore || '?'}/100
Token Age: ${data.ageHours ? Math.round(data.ageHours) + 'h' : '?'}

Recent headlines:
${(data.headlines || []).slice(0, 5).map((h, i) => `[${i + 1}] ${h}`).join('\n')}

Write the intelligence brief.`;
}

function formatNum(n) {
  if (!n) return '?';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}
