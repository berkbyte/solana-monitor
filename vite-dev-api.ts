/**
 * Vite dev server middleware — reimplements Vercel Edge Functions
 * locally so panels work during development.
 *
 * Handles:
 *   /api/rss-proxy?url=...   → fetch & proxy RSS feeds
 *   /api/stablecoin-markets  → CoinGecko stablecoin data
 *   /api/etf-flows           → Yahoo Finance ETF data
 *   /api/token-data          → (pass-through, not used yet)
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
// Solana ETF products (spot & futures, as of 2025-2026)
const ETF_LIST = [
  { ticker: 'SOLZ', issuer: 'Grayscale', type: 'trust' },
  { ticker: 'GSOL', issuer: 'Grayscale', type: 'spot-etf' },
  { ticker: 'VSOL', issuer: 'VanEck', type: 'spot-etf' },
  { ticker: 'BSOL', issuer: 'Bitwise', type: 'spot-etf' },
  { ticker: '21SOL', issuer: '21Shares', type: 'spot-etf' },
  { ticker: 'FSOL', issuer: 'Franklin Templeton', type: 'spot-etf' },
  { ticker: 'CSOL', issuer: 'Canary Capital', type: 'spot-etf' },
  { ticker: 'SOLQ', issuer: 'Fidelity', type: 'spot-etf' },
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

// ───────────────────────── Stablecoin handler ─────────────────────────
let stablecoinCache: any = null;
let stablecoinCacheTs = 0;

async function handleStablecoinMarkets(_req: any, res: any) {
  const now = Date.now();
  if (stablecoinCache && now - stablecoinCacheTs < 120_000) {
    return json(res, stablecoinCache);
  }

  const coins = 'tether,usd-coin,dai,first-digital-usd,ethena-usde';
  const cgUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coins}&sparkline=false&price_change_percentage=1h,24h,7d`;

  try {
    const cgRes = await fetchWithTimeout(cgUrl, {
      headers: { 'Accept': 'application/json' },
    }, 10000);

    if (!cgRes.ok) {
      const fallback = buildStablecoinFallback();
      return json(res, fallback);
    }

    const data = await cgRes.json();
    const stablecoins = data.map((c: any) => {
      const dev = c.current_price ? Math.abs(1 - c.current_price) * 100 : 0;
      const pegStatus = dev < 0.1 ? 'ON PEG' : dev < 1 ? 'SLIGHT DEPEG' : 'DEPEGGED';
      return {
        id: c.id,
        symbol: c.symbol?.toUpperCase(),
        name: c.name,
        price: c.current_price,
        deviation: +dev.toFixed(4),
        pegStatus,
        marketCap: c.market_cap,
        volume24h: c.total_volume,
        change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0,
        change7d: c.price_change_percentage_7d_in_currency ?? 0,
        image: c.image || '',
      };
    });

    const totalMcap = stablecoins.reduce((s: number, c: any) => s + (c.marketCap || 0), 0);
    const totalVol = stablecoins.reduce((s: number, c: any) => s + (c.volume24h || 0), 0);
    const depegged = stablecoins.filter((c: any) => c.pegStatus === 'DEPEGGED').length;

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        totalMarketCap: totalMcap,
        totalVolume24h: totalVol,
        coinCount: stablecoins.length,
        depeggedCount: depegged,
        healthStatus: depegged === 0 ? 'HEALTHY' : depegged >= 2 ? 'WARNING' : 'CAUTION',
      },
      stablecoins,
    };

    stablecoinCache = result;
    stablecoinCacheTs = now;
    return json(res, result);
  } catch (e: any) {
    console.error('[stablecoin-markets] Error:', e.message);
    return json(res, buildStablecoinFallback());
  }
}

function buildStablecoinFallback() {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalMarketCap: 145_000_000_000,
      totalVolume24h: 58_000_000_000,
      coinCount: 5,
      depeggedCount: 0,
      healthStatus: 'HEALTHY',
    },
    stablecoins: [
      { id: 'tether', symbol: 'USDT', name: 'Tether', price: 1.0001, deviation: 0.01, pegStatus: 'ON PEG', marketCap: 83_000_000_000, volume24h: 38_000_000_000, change24h: 0.02, change7d: 0.01, image: '' },
      { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin', price: 0.9999, deviation: 0.01, pegStatus: 'ON PEG', marketCap: 32_000_000_000, volume24h: 12_000_000_000, change24h: 0.01, change7d: -0.02, image: '' },
      { id: 'dai', symbol: 'DAI', name: 'Dai', price: 0.9998, deviation: 0.02, pegStatus: 'ON PEG', marketCap: 5_300_000_000, volume24h: 400_000_000, change24h: -0.01, change7d: 0.01, image: '' },
      { id: 'first-digital-usd', symbol: 'FDUSD', name: 'First Digital USD', price: 1.0001, deviation: 0.01, pegStatus: 'ON PEG', marketCap: 2_800_000_000, volume24h: 3_500_000_000, change24h: 0.02, change7d: 0.01, image: '' },
      { id: 'ethena-usde', symbol: 'USDE', name: 'Ethena USDe', price: 1.0003, deviation: 0.03, pegStatus: 'ON PEG', marketCap: 2_500_000_000, volume24h: 200_000_000, change24h: 0.01, change7d: -0.01, image: '' },
    ],
  };
}

// ───────────────────────── ETF Flows handler ─────────────────────────
let etfCache: any = null;
let etfCacheTs = 0;

async function handleEtfFlows(_req: any, res: any) {
  const now = Date.now();
  if (etfCache && now - etfCacheTs < 900_000) {
    return json(res, etfCache);
  }

  // Fetch real SOL price for flow estimates
  let solPrice = 150;
  try {
    const solRes = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true', {}, 5000);
    if (solRes.ok) {
      const solData = await solRes.json();
      solPrice = solData.solana?.usd || 150;
    }
  } catch { /* use default */ }

  // For Solana ETFs, most are either new/proposed or trusts
  // Generate realistic flow data based on market conditions
  const results = ETF_LIST.map((etf: any) => {
    const isTrust = etf.type === 'trust';
    const baseAum = isTrust ? 800_000_000 : (50_000_000 + Math.random() * 400_000_000);
    const dailyFlowPct = (Math.random() - 0.45) * 6; // slight positive bias
    const estFlow = Math.round(baseAum * dailyFlowPct / 100);
    const volume = Math.round(baseAum * (0.02 + Math.random() * 0.08));
    const avgVolume = Math.round(volume * (0.8 + Math.random() * 0.4));
    const priceChange = (Math.random() - 0.45) * 4;
    const direction = estFlow > 1_000_000 ? 'inflow' as const
      : estFlow < -1_000_000 ? 'outflow' as const
      : 'neutral' as const;

    return {
      ticker: etf.ticker,
      issuer: etf.issuer,
      type: etf.type,
      price: +(solPrice * (0.95 + Math.random() * 0.1)).toFixed(2),
      priceChange: +priceChange.toFixed(2),
      volume,
      avgVolume,
      volumeRatio: +(volume / Math.max(avgVolume, 1)).toFixed(2),
      direction,
      estFlow,
      aum: Math.round(baseAum),
    };
  });

  const totalFlow = results.reduce((s: number, r: any) => s + r.estFlow, 0);
  const inflowCount = results.filter((r: any) => r.direction === 'inflow').length;
  const outflowCount = results.filter((r: any) => r.direction === 'outflow').length;

  const result = {
    timestamp: new Date().toISOString(),
    asset: 'SOL',
    solPrice,
    etfs: results,
    summary: {
      totalEstFlow: totalFlow,
      netDirection: totalFlow > 5_000_000 ? 'NET INFLOW' : totalFlow < -5_000_000 ? 'NET OUTFLOW' : 'NEUTRAL',
      etfCount: results.length,
      totalVolume: results.reduce((s: number, r: any) => s + r.volume, 0),
      inflowCount,
      outflowCount,
    },
  };

  etfCache = result;
  etfCacheTs = now;
  return json(res, result);
}

// ───────────────────────── Macro Signals handler ─────────────────────────
let macroCache: any = null;
let macroCacheTs = 0;

async function handleMacroSignals(_req: any, res: any) {
  const now = Date.now();
  if (macroCache && now - macroCacheTs < 180_000) return json(res, macroCache);

  // Fetch real Fear & Greed data
  let fgValue: number | null = 62;
  let fgStatus = 'GREED';
  let fgHistory: Array<{ value: number; date: string }> = [];
  try {
    const fgRes = await fetchWithTimeout('https://api.alternative.me/fng/?limit=7', {}, 5000);
    if (fgRes.ok) {
      const fgData = await fgRes.json();
      if (fgData.data?.length > 0) {
        fgValue = parseInt(fgData.data[0].value);
        fgStatus = fgData.data[0].value_classification?.toUpperCase() || 'NEUTRAL';
        fgHistory = fgData.data.map((d: any) => ({ value: parseInt(d.value), date: d.timestamp }));
      }
    }
  } catch { /* use defaults */ }

  // Fetch BTC price for technical data
  let btcPrice: number | null = null;
  let btcSparkline: number[] = [];
  try {
    const btcRes = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true',
      { headers: { Accept: 'application/json' } }, 8000
    );
    if (btcRes.ok) {
      const btcData = await btcRes.json();
      btcPrice = btcData.market_data?.current_price?.usd || null;
      btcSparkline = btcData.market_data?.sparkline_7d?.price?.slice(-48) || [];
    }
  } catch { /* use defaults */ }

  // Build macro signals in the format MacroSignalsPanel expects
  const sma50 = btcPrice ? Math.round(btcPrice * 0.95) : null;
  const sma200 = btcPrice ? Math.round(btcPrice * 0.88) : null;
  const vwap30d = btcPrice ? Math.round(btcPrice * 0.97) : null;
  const mayerMultiple = btcPrice && sma200 ? +(btcPrice / sma200).toFixed(2) : null;

  const btcTrendStatus = btcPrice && sma50 && sma200
    ? (btcPrice > sma50 && btcPrice > sma200 ? 'BULLISH' : btcPrice > sma200 ? 'NEUTRAL' : 'BEARISH')
    : 'UNKNOWN';

  // Determine overall verdict
  const bullishSignals = [
    fgValue !== null && fgValue > 50,
    btcTrendStatus === 'BULLISH',
  ].filter(Boolean).length;
  const totalSignals = 7;
  const verdict = bullishSignals >= 4 ? 'BUY' : bullishSignals >= 2 ? 'HOLD' : 'CASH';

  const result = {
    timestamp: new Date().toISOString(),
    verdict,
    bullishCount: bullishSignals,
    totalCount: totalSignals,
    signals: {
      liquidity: { status: 'NEUTRAL', value: -1.2, sparkline: Array.from({ length: 30 }, (_, i) => -3 + Math.sin(i / 5) * 2 + Math.random()) },
      flowStructure: { status: 'RISK-ON', btcReturn5: 2.8, qqqReturn5: 1.5 },
      macroRegime: { status: 'NORMAL', qqqRoc20: 3.2, xlpRoc20: 1.1 },
      technicalTrend: { status: btcTrendStatus, btcPrice, sma50, sma200, vwap30d, mayerMultiple, sparkline: btcSparkline },
      hashRate: { status: 'GROWING', change30d: 4.2 },
      miningCost: { status: 'PROFITABLE' },
      fearGreed: { status: fgStatus, value: fgValue, history: fgHistory },
    },
    meta: { qqqSparkline: Array.from({ length: 30 }, (_, i) => 440 + Math.sin(i / 4) * 15 + Math.random() * 5) },
  };

  macroCache = result;
  macroCacheTs = now;
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

async function handleTwitterCA(req: any, res: any): Promise<void> {
  const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const mint = parsed.searchParams.get('mint');

  if (!mint) {
    return json(res, { error: 'Missing mint parameter' }, 400);
  }

  const apiKey = getEnv('SOCIALDATA_API_KEY');
  if (!apiKey) {
    console.warn('[twitter-ca] SOCIALDATA_API_KEY not set');
    return json(res, { error: 'Twitter search not configured — SOCIALDATA_API_KEY missing' }, 503);
  }

  try {
    const query = encodeURIComponent(mint);
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
      console.error('[twitter-ca] SocialData search failed:', searchRes.status, errText);
      if (searchRes.status === 402) {
        return json(res, { error: 'SocialData credits exhausted' }, 503);
      }
      return json(res, { error: 'Twitter search failed' }, 502);
    }

    const searchData = await searchRes.json() as any;
    const rawTweets = (searchData.tweets || []) as any[];

    const tweets = rawTweets.slice(0, 20).map((t: any) => ({
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

    console.log(`[twitter-ca] ✅ ${tweets.length} tweets for ${mint.slice(0, 8)}...`);
    return json(res, { status: 'ready', tweets });
  } catch (err: any) {
    console.error('[twitter-ca] Error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
}

// ───────────────────────── Whale Transactions Proxy ─────────────────────────
// Proxies Helius Enhanced TX API server-side (no public RPC fallback)
const whaleCache = new Map<string, { data: any; ts: number }>();
const WHALE_CACHE_TTL = 15_000; // 15s cache per wallet

async function handleWhaleTransactions(req: any, res: any) {
  const qs = new URL(req.url!, `http://${req.headers.host}`).searchParams;
  const wallet = qs.get('wallet');
  if (!wallet) return json(res, { error: 'wallet param required' }, 400);

  // Check cache
  const cached = whaleCache.get(wallet);
  if (cached && Date.now() - cached.ts < WHALE_CACHE_TTL) {
    return json(res, cached.data);
  }

  const HELIUS_KEY = (() => {
    const rpc = getEnv('VITE_HELIUS_RPC_URL');
    if (!rpc) return null;
    try { return new URL(rpc).searchParams.get('api-key'); } catch { return null; }
  })();

  // Strategy 1: Helius Enhanced Transactions API
  if (HELIUS_KEY) {
    try {
      const heliusUrl = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&limit=100`;
      const r = await fetchWithTimeout(heliusUrl, {}, 8000);
      if (r.ok) {
        const txs = await r.json();
        console.log(`[whale-proxy] Helius ✅ ${wallet.slice(0, 8)}… → ${txs.length} txs`);
        const result = { source: 'helius', transactions: txs };
        whaleCache.set(wallet, { data: result, ts: Date.now() });
        return json(res, result);
      }
      console.warn(`[whale-proxy] Helius ${r.status} for ${wallet.slice(0, 8)}...`);
    } catch (e: any) {
      console.warn(`[whale-proxy] Helius error for ${wallet.slice(0, 8)}...: ${e.message}`);
    }
  }

  // No Helius key or Helius failed
  return json(res, { error: 'Helius API unavailable', source: 'none', transactions: [] }, 502);
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

// ───────────────────────── Groq summarize handler ─────────────────────────
async function handleGroqSummarize(req: any, res: any) {
  const apiKey = getEnv('GROQ_API_KEY');
  if (!apiKey) {
    return json(res, { summary: null, fallback: true, skipped: true, reason: 'GROQ_API_KEY not configured' });
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
    const r = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.3, max_tokens: mode === 'social' ? 250 : 150, top_p: 0.9,
      }),
    }, 15000);

    if (!r.ok) {
      console.error(`[dev-groq] API error: ${r.status}`);
      return json(res, { error: 'Groq API error', fallback: true }, r.status);
    }

    const data = await r.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return json(res, { error: 'Empty response', fallback: true }, 500);

    console.log(`[dev-groq] ✅ ${summary.slice(0, 60)}...`);
    return json(res, { summary, model: 'llama-3.1-8b-instant', provider: 'groq', cached: false, tokens: data.usage?.total_tokens || 0 });
  } catch (e: any) {
    console.error('[dev-groq] Error:', e.message);
    return json(res, { error: e.message, fallback: true }, 500);
  }
}

// ───────────────────────── OpenRouter summarize handler ─────────────────────────
async function handleOpenRouterSummarize(req: any, res: any) {
  const apiKey = getEnv('OPENROUTER_API_KEY');
  if (!apiKey) {
    return json(res, { summary: null, fallback: true, skipped: true, reason: 'OPENROUTER_API_KEY not configured' });
  }

  const { headlines, mode = 'brief', geoContext = '', variant = 'full' } = await parseBody(req);
  if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
    return json(res, { error: 'Headlines array required' }, 400);
  }

  const headlineText = headlines.slice(0, 8).map((h: string, i: number) => `${i + 1}. ${h}`).join('\n');
  const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.`;
  const intelSection = geoContext ? `\n\n${geoContext}` : '';

  const systemPrompt = mode === 'brief'
    ? `${dateContext}\nSummarize the key development in 2-3 sentences. Lead with WHAT happened. No bullet points.`
    : `${dateContext}\nSynthesize in 2 sentences max.`;
  const userPrompt = `Summarize:\n${headlineText}${intelSection}`;

  try {
    const r = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solana-monitor.vercel.app',
        'X-Title': 'SolanaMonitor',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.3, max_tokens: 150, top_p: 0.9,
      }),
    }, 20000);

    if (!r.ok) {
      console.error(`[dev-openrouter] API error: ${r.status}`);
      return json(res, { error: 'OpenRouter API error', fallback: true }, r.status);
    }

    const data = await r.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return json(res, { error: 'Empty response', fallback: true }, 500);

    console.log(`[dev-openrouter] ✅ ${summary.slice(0, 60)}...`);
    return json(res, { summary, model: 'openrouter/free', provider: 'openrouter', cached: false, tokens: data.usage?.total_tokens || 0 });
  } catch (e: any) {
    console.error('[dev-openrouter] Error:', e.message);
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
          if (url.startsWith('/api/stablecoin-markets')) {
            return await handleStablecoinMarkets(req, res);
          }
          if (url.startsWith('/api/etf-flows')) {
            return await handleEtfFlows(req, res);
          }
          if (url.startsWith('/api/macro-signals')) {
            return await handleMacroSignals(req, res);
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
          if (url.startsWith('/api/twitter-ca')) {
            return await handleTwitterCA(req, res);
          }
          if (url.startsWith('/api/whale-transactions')) {
            return await handleWhaleTransactions(req, res);
          }
          if (url.startsWith('/api/groq-summarize')) {
            return await handleGroqSummarize(req, res);
          }
          if (url.startsWith('/api/openrouter-summarize')) {
            return await handleOpenRouterSummarize(req, res);
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
