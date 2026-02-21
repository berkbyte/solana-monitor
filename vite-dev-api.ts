/**
 * Vite dev server middleware — reimplements Vercel Edge Functions
 * locally so panels work during development.
 *
 * Handles:
 *   /api/rss-proxy?url=...   → fetch & proxy RSS feeds
 *   /api/etf-flows           → Solana ETF tracker data
 *   /api/summarize           → AI summarization (Groq / OpenRouter)
 *   /api/x-api               → Twitter CA / X search
 */

import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

// ── Load .env.local vars early so they're available in all handlers ──
// Vite's `process.env` doesn't always populate VITE_* on server restart.
const _env = loadEnv('development', process.cwd(), '');
function getEnv(key: string): string {
  return process.env[key] || _env[key] || '';
}

// ───────────────────────── Allowed RSS Domains ─────────────────────────
const ALLOWED_DOMAINS = new Set([
  'www.coindesk.com', 'cointelegraph.com', 'www.theblock.co',
  'blockworks.co', 'decrypt.co', 'www.dlnews.com',
  'unchainedcrypto.com', 'thedefiant.io', 'defillama.com',
  'www.bankless.com', 'messari.io', 'solana.com', 'github.com',
  // broader set from production proxy
  'feeds.bbci.co.uk', 'www.theguardian.com', 'feeds.npr.org',
  'news.google.com', 'rss.cnn.com', 'hnrss.org',
  'feeds.arstechnica.com', 'www.theverge.com', 'www.cnbc.com',
  'feeds.marketwatch.com', 'techcrunch.com', 'huggingface.co',
  'finance.yahoo.com', 'feeds.reuters.com', 'rsshub.app',
  'a16z.com', 'www.axios.com', 'github.blog',
]);

// ───────────────────────── ETF definitions ─────────────────────────
// Solana ETF/ETP products with real Yahoo Finance tickers (verified Feb 2026)
const ETF_LIST: { ticker: string; issuer: string; name: string; type: string }[] = [
  { ticker: 'SOLZ', issuer: 'Grayscale',           name: 'Solana ETF',                        type: 'spot-etf' },
  { ticker: 'GSOL', issuer: 'Grayscale',           name: 'Grayscale Solana Staking ETF',      type: 'staking-etf' },
  { ticker: 'VSOL', issuer: 'VanEck',              name: 'VanEck Solana ETF',                 type: 'spot-etf' },
  { ticker: 'BSOL', issuer: 'Bitwise',             name: 'Bitwise Solana Staking ETF',        type: 'staking-etf' },
  { ticker: 'FSOL', issuer: 'Fidelity',            name: 'Fidelity Solana Fund',              type: 'spot-etf' },
  { ticker: 'SOLT', issuer: 'T-Rex',               name: '2x Solana ETF',                     type: 'leveraged' },
  { ticker: 'SOLX', issuer: 'T-Rex',               name: 'T-REX 2X Long SOL Daily Target ETF',type: 'leveraged' },
];

// ───────────────────────── helpers ─────────────────────────
function json(res: any, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function xml(res: any, data: string, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(data);
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────── RSS proxy handler ─────────────────────────
async function handleRssProxy(req: any, res: any) {
  const url = new URL(req.url!, 'http://localhost');
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl) return json(res, { error: 'Missing url parameter' }, 400);

  try {
    const parsed = new URL(feedUrl);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) {
      console.warn(`[rss-proxy] Domain not allowed: ${parsed.hostname}`);
      return json(res, { error: `Domain not allowed: ${parsed.hostname}` }, 403);
    }

    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const text = await response.text();
    return xml(res, text, response.status);
  } catch (e: any) {
    console.error(`[rss-proxy] Error fetching ${feedUrl}:`, e.message);
    return json(res, { error: e.name === 'AbortError' ? 'Feed timeout' : e.message }, 502);
  }
}

// ───────────────────────── ETF Flows handler ─────────────────────────
let etfCache: any = null;
let etfCacheTs = 0;

// Fetch real data from Yahoo Finance v8 chart API for a single ticker
async function fetchYahooChart(ticker: string): Promise<any | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.meta?.regularMarketPrice) return null;

    const meta = result.meta;
    const volumes = result.indicators?.quote?.[0]?.volume || [];
    // Average volume from last 5 days
    const validVols = volumes.filter((v: number | null) => v != null && v > 0);
    const avgVolume = validVols.length > 0
      ? Math.round(validVols.reduce((s: number, v: number) => s + v, 0) / validVols.length)
      : 0;

    return {
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice,
      dayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice,
      dayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice,
      volume: meta.regularMarketVolume ?? 0,
      avgVolume,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      currency: meta.currency ?? 'USD',
    };
  } catch {
    return null;
  }
}

async function handleEtfFlows(_req: any, res: any) {
  const now = Date.now();
  if (etfCache && now - etfCacheTs < 900_000) {
    return json(res, etfCache);
  }

  // Fetch real SOL price from CoinGecko
  let solPrice = 0;
  let solChange24h = 0;
  try {
    const solRes = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
      {}, 5000,
    );
    if (solRes.ok) {
      const solData = await solRes.json();
      solPrice = solData.solana?.usd ?? 0;
      solChange24h = solData.solana?.usd_24h_change ?? 0;
    }
  } catch { /* fallback below */ }

  // Fetch real Yahoo Finance data for all ETFs in parallel
  console.log(`[etf-flows] Fetching ${ETF_LIST.length} tickers from Yahoo Finance...`);
  const chartPromises = ETF_LIST.map(etf => fetchYahooChart(etf.ticker));
  const charts = await Promise.all(chartPromises);

  let activeCount = 0;
  const results = ETF_LIST.map((etf, i) => {
    const chart = charts[i];
    if (!chart) {
      // Ticker not found on Yahoo — mark as pending/unavailable
      return {
        ticker: etf.ticker,
        issuer: etf.issuer,
        name: etf.name,
        type: etf.type,
        status: 'unavailable' as const,
        price: 0,
        priceChange: 0,
        volume: 0,
        avgVolume: 0,
        volumeRatio: 0,
        direction: 'neutral' as const,
        estFlow: 0,
        aum: 0,
        exchange: '',
      };
    }

    activeCount++;
    const priceChange = chart.prevClose > 0
      ? ((chart.price - chart.prevClose) / chart.prevClose) * 100
      : 0;
    const volumeRatio = chart.avgVolume > 0 ? chart.volume / chart.avgVolume : 1;

    // Estimate flow using volume deviation × price direction
    const volumeDeviation = volumeRatio - 1;
    const flowSign = priceChange >= 0 ? 1 : -1;
    const estAum = chart.volume * chart.price * 20; // rough AUM estimate
    const estFlow = Math.round(estAum * volumeDeviation * 0.02 * flowSign);
    const direction = estFlow > 500_000 ? 'inflow' as const
      : estFlow < -500_000 ? 'outflow' as const
      : 'neutral' as const;

    return {
      ticker: etf.ticker,
      issuer: etf.issuer,
      name: etf.name,
      type: etf.type,
      status: 'active' as const,
      price: +chart.price.toFixed(2),
      priceChange: +priceChange.toFixed(2),
      volume: chart.volume,
      avgVolume: chart.avgVolume,
      volumeRatio: +volumeRatio.toFixed(2),
      direction,
      estFlow,
      aum: Math.round(estAum),
      exchange: chart.exchange,
    };
  });

  const activeResults = results.filter((r: any) => r.status === 'active');
  const totalFlow = activeResults.reduce((s: number, r: any) => s + r.estFlow, 0);
  const inflowCount = activeResults.filter((r: any) => r.direction === 'inflow').length;
  const outflowCount = activeResults.filter((r: any) => r.direction === 'outflow').length;
  const totalVolume = activeResults.reduce((s: number, r: any) => s + r.volume, 0);

  const result = {
    timestamp: new Date().toISOString(),
    asset: 'SOL',
    solPrice,
    solChange24h,
    dataSource: activeCount > 0 ? 'yahoo-finance' : 'unavailable',
    etfs: results,
    summary: {
      etfCount: results.length,
      activeCount,
      totalEstFlow: totalFlow,
      netDirection: totalFlow > 1_000_000 ? 'NET INFLOW' : totalFlow < -1_000_000 ? 'NET OUTFLOW' : 'NEUTRAL',
      totalVolume,
      inflowCount,
      outflowCount,
    },
  };

  console.log(`[etf-flows] ✅ ${activeCount}/${results.length} active, SOL $${solPrice.toFixed(2)}, totalVol ${totalVolume.toLocaleString()}`);
  etfCache = result;
  etfCacheTs = now;
  return json(res, result);
}

// ───────────────────────── Polymarket handler ─────────────────────────
async function handlePolymarket(req: any, res: any) {
  const url = new URL(req.url!, 'http://localhost');
  const endpoint = url.searchParams.get('endpoint') || 'events';
  const params = new URLSearchParams();

  // Forward all query params except 'endpoint'
  for (const [key, val] of url.searchParams.entries()) {
    if (key === 'endpoint') continue;
    // Map 'tag' back to 'tag_slug' for gamma API
    params.set(key === 'tag' ? 'tag_slug' : key, val);
  }

  const gammaUrl = `https://gamma-api.polymarket.com/${endpoint}?${params.toString()}`;

  try {
    const response = await fetchWithTimeout(gammaUrl, {
      headers: { 'Accept': 'application/json' },
    }, 8000);

    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(text);
  } catch (e: any) {
    // Polymarket may block server-side requests — return empty array
    console.warn(`[polymarket] Proxy failed (browser direct should work): ${e.message}`);
    json(res, []);
  }
}

// ───────────────────────── Marinade Validators Proxy ─────────────────────────
// ───────────────────────── Validators.app Proxy ─────────────────────────
// Requires API token. Returns ALL validators with geo, Jito flag, client type, scores.
// Rate limit: 20 requests per 5 minutes — cache aggressively!
let validatorsAppCache: { data: any; ts: number } | null = null;
const VALIDATORS_APP_CACHE_TTL = 300_000; // 5 min
const VALIDATORS_APP_TOKEN = getEnv('VITE_VALIDATORS_APP_TOKEN') || 'WPAQGS3PbDtgjtkPiZXW6AEG';

async function handleValidatorsApp(_req: any, res: any) {
  // Return cached data if fresh
  if (validatorsAppCache && Date.now() - validatorsAppCache.ts < VALIDATORS_APP_CACHE_TTL) {
    console.log(`[validators-app] Cache hit (${validatorsAppCache.data.length} validators)`);
    return json(res, validatorsAppCache.data);
  }

  const url = 'https://www.validators.app/api/v1/validators/mainnet.json?limit=9999&active_only=true';
  try {
    console.log('[validators-app] Fetching from validators.app...');
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/json',
        'Token': VALIDATORS_APP_TOKEN,
      },
    }, 45000);

    if (!response.ok) {
      console.error(`[validators-app] HTTP ${response.status}`);
      return json(res, [], response.status === 429 ? 429 : 502);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length < 100) {
      console.error(`[validators-app] Only ${Array.isArray(data) ? data.length : 0} validators`);
      return json(res, [], 502);
    }

    console.log(`[validators-app] ✅ ${data.length} validators (${data.filter((v: any) => v.jito).length} Jito, ${data.filter((v: any) => !v.delinquent).length} active)`);
    validatorsAppCache = { data, ts: Date.now() };
    return json(res, data);
  } catch (e: any) {
    console.error(`[validators-app] Failed: ${e.message}`);
    // Return stale cache if available
    if (validatorsAppCache) {
      console.log(`[validators-app] Returning stale cache (${validatorsAppCache.data.length} validators)`);
      return json(res, validatorsAppCache.data);
    }
    return json(res, [], 502);
  }
}

// ───────────────────────── Helium Hotspot Proxy ─────────────────────────
// Fetches real Helium IoT & Mobile hotspot locations from entities.nft.helium.io
// Paginates through multiple pages to get 50K+ real coordinates.
// Cache for 10 minutes since hotspot data changes slowly.
let heliumCache: { data: any; ts: number } | null = null;
const HELIUM_CACHE_TTL = 600_000; // 10 min
const HELIUM_IOT_PAGES = 5;       // 5 pages × 10K = ~50K IoT hotspots
const HELIUM_MOBILE_PAGES = 3;    // 3 pages × 10K = ~30K Mobile hotspots

async function fetchHeliumPages(subnetwork: string, maxPages: number): Promise<{ items: any[]; total: number }> {
  const allItems: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const url = cursor
      ? `https://entities.nft.helium.io/v2/hotspots?subnetwork=${subnetwork}&limit=10000&cursor=${encodeURIComponent(cursor)}`
      : `https://entities.nft.helium.io/v2/hotspots?subnetwork=${subnetwork}&limit=10000`;

    try {
      const r = await fetchWithTimeout(url, {}, 30000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const items = d.items || [];
      allItems.push(...items);
      cursor = d.cursor || null;
      hasMore = !!cursor;
      console.log(`[helium-proxy] ${subnetwork} page ${page + 1}: ${items.length} items (total so far: ${allItems.length})`);
    } catch (e: any) {
      console.warn(`[helium-proxy] ${subnetwork} page ${page + 1} failed: ${e.message}`);
      break;
    }
  }

  return { items: allItems, total: allItems.length };
}

async function handleHeliumHotspots(_req: any, res: any) {
  if (heliumCache && Date.now() - heliumCache.ts < HELIUM_CACHE_TTL) {
    console.log(`[helium-proxy] Cache hit (${heliumCache.data.iot?.length || 0} IoT, ${heliumCache.data.mobile?.length || 0} Mobile)`);
    return json(res, heliumCache.data);
  }

  console.log('[helium-proxy] Fetching real Helium hotspot locations (paginated)...');

  const result: { iot: any[]; mobile: any[]; totalIot: number; totalMobile: number } = {
    iot: [],
    mobile: [],
    totalIot: 0,
    totalMobile: 0,
  };

  // Fetch IoT and Mobile hotspots in parallel (multiple pages each)
  const [iotRes, mobileRes] = await Promise.allSettled([
    fetchHeliumPages('iot', HELIUM_IOT_PAGES),
    fetchHeliumPages('mobile', HELIUM_MOBILE_PAGES),
  ]);

  if (iotRes.status === 'fulfilled') {
    const items = iotRes.value.items;
    result.iot = items.filter((h: any) => h.lat && h.long).map((h: any) => ({
      lat: h.lat,
      lon: h.long,
      active: h.is_active,
      key: h.entity_key_str?.slice(0, 12),
    }));
    result.totalIot = 400000; // known total
    console.log(`[helium-proxy] ✅ IoT: ${result.iot.length} hotspots with geo (from ${HELIUM_IOT_PAGES} pages)`);
  } else {
    console.warn(`[helium-proxy] IoT fetch failed: ${iotRes.reason}`);
  }

  if (mobileRes.status === 'fulfilled') {
    const items = mobileRes.value.items;
    result.mobile = items.filter((h: any) => h.lat && h.long).map((h: any) => ({
      lat: h.lat,
      lon: h.long,
      active: h.is_active,
      key: h.entity_key_str?.slice(0, 12),
    }));
    result.totalMobile = 50000; // known total
    console.log(`[helium-proxy] ✅ Mobile: ${result.mobile.length} hotspots with geo (from ${HELIUM_MOBILE_PAGES} pages)`);
  } else {
    console.warn(`[helium-proxy] Mobile fetch failed: ${mobileRes.reason}`);
  }

  if (result.iot.length > 0 || result.mobile.length > 0) {
    heliumCache = { data: result, ts: Date.now() };
  }

  return json(res, result);
}

// ───────────────────────── DeFi Llama Proxy ─────────────────────────
// Proxies DeFi Llama /protocols endpoint to avoid CORS issues.
// Returns top 50 Solana protocols with TVL, category, 24h/7d change.
let defiLlamaCache: { data: any; ts: number } | null = null;
const DEFI_LLAMA_CACHE_TTL = 300_000; // 5 min

async function handleDefiData(_req: any, res: any) {
  if (defiLlamaCache && Date.now() - defiLlamaCache.ts < DEFI_LLAMA_CACHE_TTL) {
    console.log(`[defi-llama] Cache hit (${defiLlamaCache.data.protocols.length} protocols)`);
    return json(res, defiLlamaCache.data);
  }

  try {
    console.log('[defi-llama] Fetching from api.llama.fi/protocols...');
    const response = await fetchWithTimeout('https://api.llama.fi/protocols', {}, 15000);
    if (!response.ok) {
      console.error(`[defi-llama] HTTP ${response.status}`);
      if (defiLlamaCache) return json(res, defiLlamaCache.data);
      return json(res, { protocols: [], totalTvl: 0, categories: {} }, 502);
    }

    const allProtocols: any[] = await response.json();
    const solanaProtocols = allProtocols
      .filter((p: any) => p.chains && (p.chains.includes('Solana') || p.chains.includes('solana')))
      .map((p: any) => ({
        name: p.name,
        slug: p.slug || '',
        tvl: p.tvl || 0,
        change24h: p.change_1d || 0,
        change7d: p.change_7d || 0,
        category: p.category || 'Other',
        logo: p.logo || '',
        url: p.url || '',
      }))
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 50);

    const totalTvl = solanaProtocols.reduce((s: number, p: any) => s + p.tvl, 0);

    // Group by category
    const categories: Record<string, { tvl: number; count: number; protocols: string[] }> = {};
    for (const p of solanaProtocols) {
      if (!categories[p.category]) categories[p.category] = { tvl: 0, count: 0, protocols: [] };
      categories[p.category].tvl += p.tvl;
      categories[p.category].count++;
      categories[p.category].protocols.push(p.name);
    }

    const result = { protocols: solanaProtocols, totalTvl, categories, timestamp: Date.now() };
    console.log(`[defi-llama] ✅ ${solanaProtocols.length} Solana protocols, $${(totalTvl / 1e9).toFixed(2)}B TVL`);
    defiLlamaCache = { data: result, ts: Date.now() };
    return json(res, result);
  } catch (e: any) {
    console.error(`[defi-llama] Failed: ${e.message}`);
    if (defiLlamaCache) return json(res, defiLlamaCache.data);
    return json(res, { protocols: [], totalTvl: 0, categories: {} }, 502);
  }
}

// ───────────────────────── DexScreener Token Proxy ─────────────────────────
// Proxies DexScreener token lookups server-side to avoid browser CORS / anti-bot issues.
const dexscreenerCache = new Map<string, { data: any; ts: number }>();
const DEXSCREENER_CACHE_TTL = 60_000; // 1 min

async function handleDexscreenerToken(req: any, res: any) {
  const urlObj = new URL(req.url || '', 'http://localhost');
  const mint = urlObj.searchParams.get('mint')?.trim();
  if (!mint || mint.length < 30) {
    return json(res, { error: 'Missing or invalid mint address' }, 400);
  }

  // Cache check
  const cached = dexscreenerCache.get(mint);
  if (cached && Date.now() - cached.ts < DEXSCREENER_CACHE_TTL) {
    console.log(`[dexscreener-proxy] Cache hit for ${mint.slice(0, 8)}...`);
    return json(res, cached.data);
  }

  try {
    // Try new endpoint first (chain-specific, cleaner)
    let pairs: any[] = [];
    try {
      const r1 = await fetchWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, {}, 10000);
      if (r1.ok) {
        const d1 = await r1.json();
        if (Array.isArray(d1) && d1.length > 0) {
          pairs = d1;
          console.log(`[dexscreener-proxy] v1 API: ${pairs.length} pairs for ${mint.slice(0, 8)}...`);
        }
      }
    } catch (_e) { /* fall through */ }

    // Fallback to legacy endpoint
    if (pairs.length === 0) {
      const r2 = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {}, 10000);
      if (r2.ok) {
        const d2 = await r2.json();
        if (d2.pairs && d2.pairs.length > 0) {
          // Filter to Solana pairs only
          pairs = d2.pairs.filter((p: any) => p.chainId === 'solana');
          if (pairs.length === 0) pairs = d2.pairs; // fallback: use all
          console.log(`[dexscreener-proxy] legacy API: ${pairs.length} pairs for ${mint.slice(0, 8)}...`);
        }
      }
    }

    if (pairs.length === 0) {
      console.warn(`[dexscreener-proxy] No pairs found for ${mint.slice(0, 8)}...`);
      return json(res, { pairs: [] });
    }

    // Sort by liquidity descending, return best pair + metadata
    pairs.sort((a: any, b: any) => {
      const liqA = typeof a.liquidity === 'number' ? a.liquidity : (a.liquidity?.usd || 0);
      const liqB = typeof b.liquidity === 'number' ? b.liquidity : (b.liquidity?.usd || 0);
      return liqB - liqA;
    });

    const result = { pairs };
    dexscreenerCache.set(mint, { data: result, ts: Date.now() });
    console.log(`[dexscreener-proxy] ✅ ${pairs.length} pairs, top liq: $${(pairs[0].liquidity?.usd || pairs[0].liquidity || 0).toLocaleString()}`);
    return json(res, result);
  } catch (e: any) {
    console.error(`[dexscreener-proxy] Error for ${mint.slice(0, 8)}...: ${e.message}`);
    return json(res, { pairs: [], error: e.message }, 502);
  }
}

// ───────────────────────── Solana RPC Proxy ─────────────────────────
// Proxies getVoteAccounts/getClusterNodes from server-side to avoid
// browser CORS and rate-limiting on public Solana RPC endpoints.
const SOLANA_RPC_ENDPOINTS = [
  getEnv('VITE_HELIUS_RPC_URL'),
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
].filter(Boolean) as string[];

async function handleSolanaRpcProxy(req: any, res: any) {
  // Read request body
  const body: Buffer[] = [];
  for await (const chunk of req) body.push(chunk);
  const bodyStr = Buffer.concat(body).toString();

  let parsed: { method?: string; params?: unknown[]; jsonrpc?: string; id?: number };
  try {
    parsed = JSON.parse(bodyStr);
  } catch {
    return json(res, { error: 'Invalid JSON' }, 400);
  }

  const method = parsed.method || '';
  const allowedMethods = ['getVoteAccounts', 'getClusterNodes', 'getEpochInfo', 'getVersion'];
  if (!allowedMethods.includes(method)) {
    return json(res, { error: `Method not allowed: ${method}` }, 403);
  }

  console.log(`[solana-rpc-proxy] ${method} → trying ${SOLANA_RPC_ENDPOINTS.length} endpoints`);

  for (const endpoint of SOLANA_RPC_ENDPOINTS) {
    try {
      const label = endpoint.replace(/\/v2\/.*/, '/v2/***').slice(0, 60);
      console.log(`[solana-rpc-proxy] ${method} → ${label}`);

      const ctrl = new AbortController();
      const timeout = method === 'getVoteAccounts' ? 60000 : 30000;
      const t = setTimeout(() => ctrl.abort(), timeout);

      const rpcRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id || 1,
          method,
          params: parsed.params || [],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!rpcRes.ok) {
        console.warn(`[solana-rpc-proxy] ${method} → HTTP ${rpcRes.status}`);
        continue;
      }

      const data = await rpcRes.json();
      if (data.error) {
        console.warn(`[solana-rpc-proxy] ${method} → RPC error:`, data.error.message || data.error);
        continue;
      }

      if (data.result !== undefined) {
        console.log(`[solana-rpc-proxy] ${method} → ✅ success`);
        return json(res, data);
      }
    } catch (e: any) {
      console.warn(`[solana-rpc-proxy] ${method} → ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      continue;
    }
  }

  console.error(`[solana-rpc-proxy] ${method} → ❌ all endpoints failed`);
  return json(res, { jsonrpc: '2.0', id: parsed.id || 1, error: { code: -32000, message: 'All RPC endpoints failed' } }, 502);
}

// ───────────────────────── Twitter CA Search (SocialData) ──────────

// ───────────────────────── Unified X/Twitter API (CA + Search) ─────────────────────────
async function handleXApi(req: any, res: any): Promise<void> {
  const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const mint = parsed.searchParams.get('mint');
  const q = parsed.searchParams.get('q');

  if (!mint && !q) {
    return json(res, { error: 'Missing mint or q parameter' }, 400);
  }

  const apiKey = getEnv('SOCIALDATA_API_KEY');
  if (!apiKey) {
    console.warn('[x-api] SOCIALDATA_API_KEY not set');
    return json(res, { error: 'X search not configured — SOCIALDATA_API_KEY missing' }, 503);
  }

  const searchQuery = mint || q!;
  const maxTweets = mint ? 20 : 30;
  const logPrefix = mint ? '[x-api/ca]' : '[x-api/search]';

  try {
    const query = encodeURIComponent(searchQuery);
    const searchRes = await fetchWithTimeout(
      `https://api.socialdata.tools/twitter/search?query=${query}&type=Latest`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      },
      15_000,
    );

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error(`${logPrefix} SocialData search failed:`, searchRes.status, errText);
      if (searchRes.status === 402) {
        return json(res, { error: 'SocialData credits exhausted' }, 503);
      }
      return json(res, { error: 'Search failed' }, 502);
    }

    const searchData = await searchRes.json() as any;
    const rawTweets = (searchData.tweets || []) as any[];

    const tweets = rawTweets.slice(0, maxTweets).map((t: any) => ({
      id: t.id_str || String(t.id || ''),
      text: (t.full_text || t.text || '').slice(0, 500),
      author: t.user?.name || 'Unknown',
      handle: t.user?.screen_name || '',
      avatar: t.user?.profile_image_url_https || '',
      followers: t.user?.followers_count || 0,
      likes: t.favorite_count || 0,
      retweets: t.retweet_count || 0,
      replies: t.reply_count || 0,
      views: t.views_count || 0,
      date: t.tweet_created_at || t.created_at || '',
      url: t.user?.screen_name
        ? `https://x.com/${t.user.screen_name}/status/${t.id_str || t.id}`
        : '',
    }));

    console.log(`${logPrefix} ✅ ${tweets.length} tweets for ${searchQuery.slice(0, 8)}...`);
    return json(res, { status: 'ready', tweets });
  } catch (err: any) {
    console.error(`${logPrefix} Error:`, err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
}

// ───────────────────────── Body parser helper ─────────────────────────
function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ───────────────────────── Unified summarize handler (Groq + OpenRouter) ─────────────────────────
const DEV_PROVIDERS: Record<string, { url: string; model: string; envKey: string; extraHeaders: Record<string, string>; label: string }> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant',
    envKey: 'GROQ_API_KEY',
    extraHeaders: {},
    label: 'dev-groq',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/free',
    envKey: 'OPENROUTER_API_KEY',
    extraHeaders: { 'HTTP-Referer': 'https://solana-monitor.vercel.app', 'X-Title': 'SolanaMonitor' },
    label: 'dev-openrouter',
  },
};

async function handleSummarize(req: any, res: any) {
  const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const providerName = parsed.searchParams.get('provider') || 'groq';
  const provider = DEV_PROVIDERS[providerName] || DEV_PROVIDERS.groq;

  const apiKey = getEnv(provider.envKey);
  if (!apiKey) {
    return json(res, { summary: null, fallback: true, skipped: true, reason: `${provider.envKey} not configured` });
  }

  const { headlines, mode = 'brief', geoContext = '', variant = 'full' } = await parseBody(req);
  if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
    return json(res, { error: 'Headlines array required' }, 400);
  }

  const headlineText = headlines.slice(0, 8).map((h: string, i: number) => `${i + 1}. ${h}`).join('\n');
  const isTechVariant = variant === 'tech';
  const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.${isTechVariant ? '' : ' Donald Trump is the current US President (second term, inaugurated Jan 2025).'}`;
  const intelSection = geoContext ? `\n\n${geoContext}` : '';

  let systemPrompt: string;
  let userPrompt: string;

  if (mode === 'social') {
    systemPrompt = `${dateContext}\nYou are a crypto social media analyst. Analyze real-time tweets about Solana.\nWrite a sharp 3-4 sentence social intelligence briefing. Be specific, data-driven.`;
    userPrompt = `Analyze these recent tweets:\n\n${headlineText}`;
  } else if (mode === 'brief') {
    systemPrompt = `${dateContext}\nSummarize the key development in 2-3 sentences. Lead with WHAT happened. No bullet points.`;
    userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
  } else if (mode === 'analysis') {
    systemPrompt = `${dateContext}\nProvide analysis in 2-3 sentences. Be direct and specific. Lead with the insight.`;
    userPrompt = `What's the key pattern or risk?\n${headlineText}${intelSection}`;
  } else {
    systemPrompt = `${dateContext}\nSynthesize in 2 sentences max.`;
    userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
  }

  try {
    const r = await fetchWithTimeout(provider.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...provider.extraHeaders },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.3, max_tokens: mode === 'social' ? 250 : 150, top_p: 0.9,
      }),
    }, providerName === 'openrouter' ? 20000 : 15000);

    if (!r.ok) {
      console.error(`[${provider.label}] API error: ${r.status}`);
      return json(res, { error: `${provider.label} API error`, fallback: true }, r.status);
    }

    const data = await r.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return json(res, { error: 'Empty response', fallback: true }, 500);

    console.log(`[${provider.label}] ✅ ${summary.slice(0, 60)}...`);
    return json(res, { summary, model: provider.model, provider: providerName, cached: false, tokens: data.usage?.total_tokens || 0 });
  } catch (e: any) {
    console.error(`[${provider.label}] Error:`, e.message);
    return json(res, { error: e.message, fallback: true }, 500);
  }
}

// ───────────────────────── Plugin export ─────────────────────────
export function devApiPlugin(): Plugin {
  return {
    name: 'dev-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        try {
          if (url.startsWith('/api/rss-proxy')) {
            return await handleRssProxy(req, res);
          }
          if (url.startsWith('/api/etf-flows')) {
            return await handleEtfFlows(req, res);
          }
          if (url.startsWith('/api/polymarket')) {
            return await handlePolymarket(req, res);
          }
          if (url.startsWith('/api/validators-app')) {
            return await handleValidatorsApp(req, res);
          }
          if (url.startsWith('/api/helium-hotspots')) {
            return await handleHeliumHotspots(req, res);
          }
          if (url.startsWith('/api/defi-data')) {
            return await handleDefiData(req, res);
          }
          if (url.startsWith('/api/dexscreener-token')) {
            return await handleDexscreenerToken(req, res);
          }
          if (url.startsWith('/api/solana-rpc-proxy')) {
            return await handleSolanaRpcProxy(req, res);
          }
          if (url.startsWith('/api/x-api')) {
            return await handleXApi(req, res);
          }
          if (url.startsWith('/api/summarize')) {
            return await handleSummarize(req, res);
          }
        } catch (e: any) {
          console.error(`[dev-api] Error handling ${url}:`, e.message);
          json(res, { error: e.message }, 500);
          return;
        }

        next();
      });
    },
  };
}
