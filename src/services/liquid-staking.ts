// Liquid Staking service — LST analytics using DeFi Llama yields + Jupiter prices + CoinGecko
// Fetches real APY data from DeFi Llama, peg prices from Jupiter, FDV/change from CoinGecko

export interface LSTProvider {
  name: string;
  symbol: string;
  mint: string;
  tvlSol: number;
  tvlUsd: number;
  apy: number;
  apyComponents: { staking: number; mev: number; emissions: number };
  priceSol: number;
  pegDeviation: number;
  validators: number;
  marketShare: number;
  fdv: number;
  change24h: number;
}

export interface LSTSummary {
  totalStakedSol: number;
  totalStakedUsd: number;
  lstShareOfTotal: number;
  providers: LSTProvider[];
  avgApy: number;
}

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const DEFILLAMA_YIELDS = 'https://yields.llama.fi/pools';

// Known Solana LST tokens with CoinGecko IDs for market data
const LST_CONFIG = [
  { name: 'Marinade', symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', llamaPool: 'marinade', validators: 450, coingeckoId: 'msol' },
  { name: 'Jito', symbol: 'jitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', llamaPool: 'jito', validators: 200, coingeckoId: 'jito-staked-sol' },
  { name: 'BlazeStake', symbol: 'bSOL', mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', llamaPool: 'blazestake', validators: 400, coingeckoId: 'blazestake-staked-sol' },
  { name: 'Sanctum Infinity', symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', llamaPool: 'sanctum', validators: 100, coingeckoId: 'sanctum-infinity' },
  { name: 'Jupiter SOL', symbol: 'jupSOL', mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', llamaPool: 'jupiter', validators: 50, coingeckoId: 'jupiter-staked-sol' },
];

let cachedSummary: LSTSummary | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

async function fetchLSTApys(): Promise<Map<string, number>> {
  const apyMap = new Map<string, number>();
  try {
    const res = await fetch(DEFILLAMA_YIELDS, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return apyMap;
    const data = await res.json();
    const pools = data.data || data;

    for (const cfg of LST_CONFIG) {
      // Find matching pool on Solana chain for this LST
      const pool = pools.find((p: Record<string, unknown>) =>
        p.chain === 'Solana' && (
          (p.symbol as string)?.toLowerCase().includes(cfg.symbol.toLowerCase()) ||
          (p.project as string)?.toLowerCase().includes(cfg.llamaPool)
        )
      );
      if (pool && typeof pool.apy === 'number') {
        apyMap.set(cfg.mint, pool.apy);
      }
    }
  } catch (e) {
    console.warn('[LST] DeFi Llama yields fetch failed:', e);
  }
  return apyMap;
}

async function fetchLSTPrices(): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const mints = LST_CONFIG.map(c => c.mint).join(',');
    const solMint = 'So11111111111111111111111111111111111111112';
    const res = await fetch(`${JUPITER_PRICE_API}?ids=${mints},${solMint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return priceMap;
    const data = await res.json();
    const prices = data.data || {};

    const solPrice = prices[solMint]?.price ? parseFloat(prices[solMint].price) : 150;

    for (const cfg of LST_CONFIG) {
      const info = prices[cfg.mint];
      if (info?.price) {
        const usdPrice = parseFloat(info.price);
        priceMap.set(cfg.mint, usdPrice / solPrice); // price in SOL terms
        priceMap.set(`${cfg.mint}_usd`, usdPrice);
      }
    }
    priceMap.set('SOL_USD', solPrice);
  } catch (e) {
    console.warn('[LST] Jupiter price fetch failed:', e);
  }
  return priceMap;
}

export async function fetchLiquidStaking(): Promise<LSTSummary> {
  const now = Date.now();
  if (cachedSummary && now - lastFetch < CACHE_TTL) return cachedSummary;

  const [apys, prices] = await Promise.allSettled([fetchLSTApys(), fetchLSTPrices()]);
  const apyMap = apys.status === 'fulfilled' ? apys.value : new Map<string, number>();
  const priceMap = prices.status === 'fulfilled' ? prices.value : new Map<string, number>();
  const solPrice = priceMap.get('SOL_USD') || 150;

  // Fetch TVL data from DeFi Llama protocols
  let protocolTvls = new Map<string, number>();
  try {
    const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const protocols = await res.json();
      for (const cfg of LST_CONFIG) {
        const protocol = protocols.find((p: Record<string, unknown>) =>
          (p.name as string)?.toLowerCase().includes(cfg.name.toLowerCase()) &&
          (p.chains as string[])?.includes('Solana')
        );
        if (protocol && typeof protocol.tvl === 'number') {
          protocolTvls.set(cfg.mint, protocol.tvl);
        }
      }
    }
  } catch {
    // Use fallback TVL data
  }

  // Default TVLs (rough estimates based on known data, in USD)
  const defaultTvls: Record<string, number> = {
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 1_200_000_000,
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 2_500_000_000,
    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 400_000_000,
    '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': 800_000_000,
    'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v': 500_000_000,
  };

  // Default APYs
  const defaultApys: Record<string, number> = {
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 7.2,
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 7.8,
    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 7.0,
    '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': 7.5,
    'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v': 7.9,
  };

  const totalSolStaked = 380_000_000; // approximate total SOL staked

  // Fetch FDV and 24h change from CoinGecko for all LSTs
  const cgIds = LST_CONFIG.map(c => c.coingeckoId).join(',');
  const cgData = new Map<string, { fdv: number; change24h: number }>();
  try {
    const cgRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgIds}&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (cgRes.ok) {
      const cgItems: Array<{ id: string; fully_diluted_valuation?: number; price_change_percentage_24h?: number }> = await cgRes.json();
      for (const item of cgItems) {
        cgData.set(item.id, {
          fdv: item.fully_diluted_valuation || 0,
          change24h: item.price_change_percentage_24h || 0,
        });
      }
    }
  } catch (e) {
    console.warn('[LST] CoinGecko market data fetch failed:', e);
  }

  const providers: LSTProvider[] = LST_CONFIG.map(cfg => {
    const tvlUsd = protocolTvls.get(cfg.mint) || defaultTvls[cfg.mint] || 500_000_000;
    const tvlSol = tvlUsd / solPrice;
    const apy = apyMap.get(cfg.mint) || defaultApys[cfg.mint] || 7.0;
    const priceSol = priceMap.get(cfg.mint) || 1.0;
    const pegDeviation = (priceSol - 1.0) * 100;
    const marketShare = (tvlSol / totalSolStaked) * 100;

    // Decompose APY into components (rough estimates)
    const stakingBase = 6.5;
    const mevComponent = cfg.symbol === 'jitoSOL' ? 1.5 : 0.3;
    const emissions = Math.max(0, apy - stakingBase - mevComponent);

    return {
      name: cfg.name,
      symbol: cfg.symbol,
      mint: cfg.mint,
      tvlSol,
      tvlUsd,
      apy,
      apyComponents: {
        staking: stakingBase,
        mev: mevComponent,
        emissions: Math.max(0, emissions),
      },
      priceSol,
      pegDeviation,
      validators: cfg.validators,
      marketShare,
      fdv: cgData.get(cfg.coingeckoId)?.fdv || tvlUsd, // real FDV from CoinGecko
      change24h: cgData.get(cfg.coingeckoId)?.change24h || 0, // real 24h change from CoinGecko
    };
  });

  const totalStakedSol = providers.reduce((s, p) => s + p.tvlSol, 0);
  const totalStakedUsd = providers.reduce((s, p) => s + p.tvlUsd, 0);
  const avgApy = providers.length > 0
    ? providers.reduce((s, p) => s + p.apy, 0) / providers.length
    : 0;

  const summary: LSTSummary = {
    totalStakedSol,
    totalStakedUsd,
    lstShareOfTotal: (totalStakedSol / totalSolStaked) * 100,
    providers: providers.sort((a, b) => b.tvlUsd - a.tvlUsd),
    avgApy,
  };

  cachedSummary = summary;
  lastFetch = now;
  return summary;
}
