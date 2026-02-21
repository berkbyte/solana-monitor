export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

// ── Verified Solana ETF products (tickers confirmed on Yahoo Finance v8) ──
const SOL_ETF_PRODUCTS = [
  { ticker: 'SOLZ',  issuer: 'Grayscale',  name: 'Solana ETF',                          type: 'spot-etf' },
  { ticker: 'GSOL',  issuer: 'Grayscale',  name: 'Grayscale Solana Staking ETF',         type: 'staking-etf' },
  { ticker: 'VSOL',  issuer: 'VanEck',     name: 'VanEck Solana ETF',                    type: 'spot-etf' },
  { ticker: 'BSOL',  issuer: 'Bitwise',    name: 'Bitwise Solana Staking ETF',           type: 'staking-etf' },
  { ticker: 'FSOL',  issuer: 'Fidelity',   name: 'Fidelity Solana Fund',                 type: 'spot-etf' },
  { ticker: 'SOLT',  issuer: 'T-Rex',      name: '2x Solana ETF',                        type: 'leveraged' },
  { ticker: 'SOLX',  issuer: 'T-Rex',      name: 'T-REX 2X Long SOL Daily Target ETF',   type: 'leveraged' },
];

const CACHE_TTL = 900;           // 15 min
const CACHE_VERSION = 'v2';
const YAHOO_TIMEOUT = 8_000;
const SOL_PRICE_TIMEOUT = 5_000;

// ── Yahoo Finance v8 chart API (per-ticker) ──
async function fetchYahooChart(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(YAHOO_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.meta?.regularMarketPrice) return null;

    const meta = result.meta;
    const volumes = result.indicators?.quote?.[0]?.volume || [];
    const validVols = volumes.filter(v => v != null && v > 0);
    const avgVolume = validVols.length > 0
      ? Math.round(validVols.reduce((s, v) => s + v, 0) / validVols.length)
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

// ── SOL price from CoinGecko ──
async function fetchSolPrice() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(SOL_PRICE_TIMEOUT) }
    );
    if (!res.ok) return { price: 0, change24h: 0 };
    const data = await res.json();
    return {
      price: data.solana?.usd ?? 0,
      change24h: data.solana?.usd_24h_change ?? 0,
    };
  } catch {
    return { price: 0, change24h: 0 };
  }
}

// ── Build ETF data from Yahoo v8 chart results ──
function buildEtfData(products, charts) {
  return products.map((etf, i) => {
    const chart = charts[i];
    if (!chart) {
      return {
        ticker: etf.ticker,
        issuer: etf.issuer,
        name: etf.name,
        type: etf.type,
        status: 'unavailable',
        price: 0,
        priceChange: 0,
        volume: 0,
        avgVolume: 0,
        volumeRatio: 0,
        direction: 'neutral',
        estFlow: 0,
        aum: 0,
        exchange: '',
      };
    }

    const priceChange = chart.prevClose > 0
      ? ((chart.price - chart.prevClose) / chart.prevClose) * 100
      : 0;
    const volumeRatio = chart.avgVolume > 0 ? chart.volume / chart.avgVolume : 1;

    // Estimate flow using volume deviation × price direction
    const volumeDeviation = volumeRatio - 1;
    const flowSign = priceChange >= 0 ? 1 : -1;
    const estAum = chart.volume * chart.price * 20; // rough AUM estimate
    const estFlow = Math.round(estAum * volumeDeviation * 0.02 * flowSign);
    const direction = estFlow > 500_000 ? 'inflow'
      : estFlow < -500_000 ? 'outflow'
      : 'neutral';

    return {
      ticker: etf.ticker,
      issuer: etf.issuer,
      name: etf.name,
      type: etf.type,
      status: 'active',
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
}

// ── Main handler ──
export default async function handler(req) {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const redisKey = `etf-flows:${CACHE_VERSION}:latest`;

  // ── Check cache ──
  const cached = await getCachedJson(redisKey);
  if (cached && typeof cached === 'object' && cached.body) {
    recordCacheTelemetry('/api/etf-flows', 'REDIS-HIT');
    return new Response(cached.body, {
      status: cached.status || 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=120',
        'X-Cache': 'REDIS-HIT',
      },
    });
  }

  // ── Fetch fresh data: all charts + SOL price in parallel ──
  const chartPromises = SOL_ETF_PRODUCTS.map(etf => fetchYahooChart(etf.ticker));
  const [sol, ...charts] = await Promise.all([
    fetchSolPrice(),
    ...chartPromises,
  ]);

  const etfs = buildEtfData(SOL_ETF_PRODUCTS, charts);

  const activeEtfs = etfs.filter(r => r.status === 'active');
  const totalFlow = activeEtfs.reduce((s, r) => s + r.estFlow, 0);
  const inflowCount = activeEtfs.filter(r => r.direction === 'inflow').length;
  const outflowCount = activeEtfs.filter(r => r.direction === 'outflow').length;
  const totalVolume = activeEtfs.reduce((s, r) => s + r.volume, 0);
  const activeCount = activeEtfs.length;

  const result = {
    timestamp: new Date().toISOString(),
    asset: 'SOL',
    solPrice: sol.price,
    solChange24h: sol.change24h,
    dataSource: activeCount > 0 ? 'yahoo-finance' : 'unavailable',
    etfs,
    summary: {
      etfCount: etfs.length,
      activeCount,
      totalVolume,
      totalEstFlow: totalFlow,
      netDirection: totalFlow > 1_000_000 ? 'NET INFLOW'
        : totalFlow < -1_000_000 ? 'NET OUTFLOW'
        : 'NEUTRAL',
      inflowCount,
      outflowCount,
    },
  };

  const body = JSON.stringify(result);

  // ── Populate cache ──
  void setCachedJson(redisKey, { body, status: 200 }, CACHE_TTL);
  recordCacheTelemetry('/api/etf-flows', 'MISS');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...cors,
      'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=120',
      'X-Cache': 'MISS',
    },
  });
}
