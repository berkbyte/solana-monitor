// Liquid Staking service — LST analytics using DeFi Llama yields + Jupiter prices + CoinGecko
// Fetches real APY data from DeFi Llama, peg prices from Jupiter, FDV/change from CoinGecko

export interface LSTProvider {
  name: string;
  symbol: string;
  mint: string;
  tvlSol: number;
  tvlUsd: number;
  apy: number;
  priceSol: number;     // exchange rate: 1 LST = X SOL (value-accruing, naturally > 1)
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
  { name: 'Marinade', symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', llamaPool: 'marinade', coingeckoId: 'msol' },
  { name: 'Jito', symbol: 'jitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', llamaPool: 'jito', coingeckoId: 'jito-staked-sol' },
  { name: 'BlazeStake', symbol: 'bSOL', mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', llamaPool: 'blazestake', coingeckoId: 'blazestake-staked-sol' },
  { name: 'Sanctum Infinity', symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', llamaPool: 'sanctum', coingeckoId: 'sanctum-infinity' },
  { name: 'Jupiter SOL', symbol: 'jupSOL', mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', llamaPool: 'jupiter', coingeckoId: 'jupiter-staked-sol' },
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

    const solPrice = prices[solMint]?.price ? parseFloat(prices[solMint].price) : 0;

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
  // If SOL price is unknown, try fetching from CoinGecko directly
  let solPrice = priceMap.get('SOL_USD') || 0;
  if (solPrice === 0) {
    try {
      const solRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
        signal: AbortSignal.timeout(5000),
      });
      if (solRes.ok) {
        const solData = await solRes.json();
        solPrice = solData?.solana?.usd || 0;
      }
    } catch { /* leave as 0 */ }
  }

  // Fetch TVL data from DeFi Llama protocols — use Solana-specific TVL
  let protocolTvls = new Map<string, number>();
  try {
    const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const protocols = await res.json();
      for (const cfg of LST_CONFIG) {
        const protocol = protocols.find((p: Record<string, unknown>) =>
          (p.name as string)?.toLowerCase().includes(cfg.name.toLowerCase()) &&
          (p.chains as string[])?.includes('Solana') &&
          ((p.category as string) === 'Liquid Staking' || cfg.name === 'Sanctum Infinity')
        );
        if (protocol) {
          // Use Solana-specific TVL if available
          const chainTvls = protocol.chainTvls as Record<string, number> | undefined;
          const solanaTvl = chainTvls?.Solana;
          if (typeof solanaTvl === 'number' && solanaTvl > 0) {
            protocolTvls.set(cfg.mint, solanaTvl);
          } else if (typeof protocol.tvl === 'number') {
            // Single-chain LST protocols — total TVL is Solana TVL
            const chains = protocol.chains as string[];
            if (chains?.length === 1) {
              protocolTvls.set(cfg.mint, protocol.tvl);
            }
          }
        }
      }
    }
  } catch {
    // Use fallback TVL data
  }

  // No hardcoded TVL fallbacks — show 0 (unavailable) if DeFi Llama is down
  const defaultTvls: Record<string, number> = {};

  // Default APYs — only used when DeFi Llama yields API fails
  // These are approximate and clearly labeled as fallback
  const defaultApys: Record<string, number> = {
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 0,
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 0,
    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 0,
    '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': 0,
    'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v': 0,
  };

  // Fetch real total staked SOL from RPC — prefer Helius, fallback to public
  let totalSolStaked = 0;
  const rpcUrl = import.meta.env.VITE_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
  try {
    const stakeRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVoteAccounts' }),
      signal: AbortSignal.timeout(6000),
    });
    if (stakeRes.ok) {
      const stakeData = await stakeRes.json();
      const all = [...(stakeData.result?.current || []), ...(stakeData.result?.delinquent || [])];
      const totalLamports = all.reduce((s: number, v: { activatedStake: number }) => s + v.activatedStake, 0);
      if (totalLamports > 0) totalSolStaked = Math.round(totalLamports / 1e9);
    }
  } catch { /* keep fallback */ }

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
    const tvlUsd = protocolTvls.get(cfg.mint) || defaultTvls[cfg.mint] || 0;
    const tvlSol = solPrice > 0 ? tvlUsd / solPrice : 0;
    const apy = apyMap.get(cfg.mint) || defaultApys[cfg.mint] || 0; // 0 = unavailable, not a fake value
    const priceSol = priceMap.get(cfg.mint) || 1.0;
    const marketShare = totalSolStaked > 0 ? (tvlSol / totalSolStaked) * 100 : 0;

    return {
      name: cfg.name,
      symbol: cfg.symbol,
      mint: cfg.mint,
      tvlSol,
      tvlUsd,
      apy,
      priceSol,   // exchange rate: 1 LST = X SOL
      marketShare,
      fdv: cgData.get(cfg.coingeckoId)?.fdv || 0,
      change24h: cgData.get(cfg.coingeckoId)?.change24h || 0,
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
    lstShareOfTotal: totalSolStaked > 0 ? (totalStakedSol / totalSolStaked) * 100 : 0,
    providers: providers.sort((a, b) => b.tvlUsd - a.tvlUsd),
    avgApy,
  };

  cachedSummary = summary;
  lastFetch = now;
  return summary;
}
