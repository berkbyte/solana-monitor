/**
 * Unified Summarization Endpoint (Groq + OpenRouter)
 * Combines both providers into a single serverless function
 * Use ?provider=groq (default) or ?provider=openrouter
 * 
 * Groq: Llama 3.1 8B Instant — 14,400 RPD free tier
 * OpenRouter: Auto-routed free model — 50 RPD free tier
 * Server-side Redis cache for cross-user deduplication
 */

import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = {
  runtime: 'edge',
};

const rateLimiter = createIpRateLimiter({
  limit: 10,         // 10 requests per window per IP
  windowMs: 60_000,  // 1 minute window
});

function getClientIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0] ||
    req.headers.get('x-real-ip') ||
    'unknown';
}

/* ── Provider configs ── */
const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant',
    envKey: 'GROQ_API_KEY',
    extraHeaders: {},
    label: 'Groq',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/free',
    envKey: 'OPENROUTER_API_KEY',
    extraHeaders: {
      'HTTP-Referer': 'https://solana-monitor.vercel.app',
      'X-Title': 'SolanaMonitor',
    },
    label: 'OpenRouter',
  },
};

const CACHE_TTL_SECONDS = 86400; // 24 hours
const CACHE_VERSION = 'v3';

function getCacheKey(headlines, mode, geoContext = '', variant = 'full') {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  return `summary:${CACHE_VERSION}:${variant}:${hash}${geoHash}`;
}

// Deduplicate similar headlines (same story from different sources)
function deduplicateHeadlines(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    const normalized = headline.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const words = new Set(normalized.split(' ').filter(w => w.length >= 4));

    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter(w => seenWords.has(w));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(words);
      unique.push(headline);
    }
  }

  return unique;
}

export default async function handler(request) {
  const corsHeaders = getCorsHeaders(request, 'POST, OPTIONS');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // IP rate limiting
  if (!rateLimiter.check(getClientIp(request))) {
    return new Response(JSON.stringify({ summary: null, fallback: true, reason: 'Rate limited' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // Determine provider from query string (?provider=groq|openrouter)
  const url = new URL(request.url);
  const providerName = url.searchParams.get('provider') || 'groq';
  const provider = PROVIDERS[providerName] || PROVIDERS.groq;

  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    return new Response(JSON.stringify({ summary: null, fallback: true, skipped: true, reason: `${provider.envKey} not configured` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 51200) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { headlines, mode = 'brief', geoContext = '', variant = 'full' } = await request.json();

    if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
      return new Response(JSON.stringify({ error: 'Headlines array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check cache first (shared across providers)
    const cacheKey = getCacheKey(headlines, mode, geoContext, variant);
    const cached = await getCachedJson(cacheKey);
    if (cached && typeof cached === 'object' && cached.summary) {
      console.log(`[${provider.label}] Cache hit:`, cacheKey);
      return new Response(JSON.stringify({
        summary: cached.summary,
        model: cached.model || provider.model,
        provider: 'cache',
        cached: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate similar headlines
    const uniqueHeadlines = deduplicateHeadlines(headlines.slice(0, 8));
    const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

    let systemPrompt, userPrompt;

    const intelSection = geoContext ? `\n\n${geoContext}` : '';
    const isTechVariant = variant === 'tech';
    const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.${isTechVariant ? '' : ' Donald Trump is the current US President (second term, inaugurated Jan 2025).'}`;

    // ── Social Pulse AI Analysis mode ──
    if (mode === 'social') {
      systemPrompt = `${dateContext}

You are a crypto social media analyst. Analyze real-time tweets about Solana and the crypto market.
Write a sharp 3-4 sentence social intelligence briefing in English.

Rules:
- Identify the DOMINANT narrative/theme across the tweets
- Note sentiment: is the community bullish, bearish, excited, fearful, or mixed?
- Highlight any notable accounts or high-engagement tweets
- If a specific token, project, or event is trending, name it
- Be specific with numbers when available (followers, engagement)
- Do NOT list tweets one by one — synthesize the overall picture
- Start directly with the insight: "Solana community is buzzing about...", "Social sentiment has shifted to..."
- Keep it concise, data-driven, and actionable`;

      userPrompt = `Analyze these recent tweets about Solana from X/Twitter and provide a social intelligence briefing:\n\n${headlineText}`;

      const socialResponse = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...provider.extraHeaders,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 250,
          top_p: 0.9,
        }),
      });

      if (!socialResponse.ok) {
        const errorText = await socialResponse.text();
        console.error(`[${provider.label}] Social analysis error:`, socialResponse.status, errorText);
        if (socialResponse.status === 429) {
          return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: `${provider.label} API error`, fallback: true }), {
          status: socialResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const socialData = await socialResponse.json();
      const socialSummary = socialData.choices?.[0]?.message?.content?.trim();

      if (!socialSummary) {
        return new Response(JSON.stringify({ error: 'Empty response', fallback: true }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await setCachedJson(cacheKey, {
        summary: socialSummary,
        model: provider.model,
        timestamp: Date.now(),
      }, 600); // 10 min cache for social data

      return new Response(JSON.stringify({
        summary: socialSummary,
        model: provider.model,
        provider: providerName,
        cached: false,
        tokens: socialData.usage?.total_tokens || 0,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120',
        },
      });
    }

    if (mode === 'brief') {
      if (isTechVariant) {
        systemPrompt = `${dateContext}

Summarize the key tech/startup development in 2-3 sentences.
Rules:
- Focus ONLY on technology, startups, AI, funding, product launches, or developer news
- IGNORE political news, trade policy, tariffs, government actions unless directly about tech regulation
- Lead with the company/product/technology name
- Start directly: "OpenAI announced...", "A new $50M Series B...", "GitHub released..."
- No bullet points, no meta-commentary`;
      } else {
        systemPrompt = `${dateContext}

Summarize the key development in 2-3 sentences.
Rules:
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject: "Iran's regime...", "The US Treasury...", "Protests in..."
- CRITICAL FOCAL POINTS are the main actors - mention them by name
- If focal points show news + signals convergence, that's the lead
- No bullet points, no meta-commentary`;
      }
      userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
    } else if (mode === 'analysis') {
      if (isTechVariant) {
        systemPrompt = `${dateContext}

Analyze the tech/startup trend in 2-3 sentences.
Rules:
- Focus ONLY on technology implications: funding trends, AI developments, market shifts, product strategy
- IGNORE political implications, trade wars, government unless directly about tech policy
- Lead with the insight for tech industry
- Connect to startup ecosystem, VC trends, or technical implications`;
      } else {
        systemPrompt = `${dateContext}

Provide analysis in 2-3 sentences. Be direct and specific.
Rules:
- Lead with the insight - what's significant and why
- NEVER start with "Breaking news", "Tonight", "The key/dominant narrative is"
- Start with substance: "Iran faces...", "The escalation in...", "Multiple signals suggest..."
- CRITICAL FOCAL POINTS are your main actors - explain WHY they matter
- If focal points show news-signal correlation, flag as escalation
- Connect dots, be specific about implications`;
      }
      userPrompt = isTechVariant
        ? `What's the key tech trend or development?\n${headlineText}${intelSection}`
        : `What's the key pattern or risk?\n${headlineText}${intelSection}`;
    } else {
      systemPrompt = isTechVariant
        ? `${dateContext}\n\nSynthesize tech news in 2 sentences. Focus on startups, AI, funding, products. Ignore politics unless directly about tech regulation.`
        : `${dateContext}\n\nSynthesize in 2 sentences max. Lead with substance. NEVER start with "Breaking news" or "Tonight" - just state the insight directly. CRITICAL focal points with news-signal convergence are significant.`;
      userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
    }

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${provider.label}] API error:`, response.status, errorText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: `${provider.label} API error`, fallback: true }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return new Response(JSON.stringify({ error: 'Empty response', fallback: true }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await setCachedJson(cacheKey, {
      summary,
      model: provider.model,
      timestamp: Date.now(),
    }, CACHE_TTL_SECONDS);

    return new Response(JSON.stringify({
      summary,
      model: provider.model,
      provider: providerName,
      cached: false,
      tokens: data.usage?.total_tokens || 0,
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=300',
      },
    });

  } catch (error) {
    console.error(`[${provider.label}] Error:`, error.name, error.message, error.stack?.split('\n')[1]);
    return new Response(JSON.stringify({
      error: error.message,
      errorType: error.name,
      fallback: true
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
