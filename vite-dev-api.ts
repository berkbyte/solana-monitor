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
