// DeFi Overview service — TVL, protocol stats, liquid staking
// Uses public DeFi Llama API + Jupiter stats

export interface ProtocolData {
  name: string;
  slug: string;
  tvl: number;
  tvlChange24h: number;
  tvlChange7d: number;
  category: string;
  chains: string[];
  logo: string;
  url: string;
}

export interface LiquidStakingData {
  protocol: string;
  token: string;
  mint: string;
  tvl: number;
  apy: number;
  validatorCount: number;
  stakeShare: number; // % of total SOL staked
}

export interface DeFiSummary {
  totalTvl: number;
  tvlChange24h: number;
  topProtocols: ProtocolData[];
  liquidStaking: LiquidStakingData[];
  timestamp: number;
}

const DEFILLAMA_API = 'https://api.llama.fi';

let cachedSummary: DeFiSummary | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 minutes

export async function fetchDeFiOverview(): Promise<DeFiSummary> {
  const now = Date.now();
  if (cachedSummary && now - lastFetch < CACHE_TTL) return cachedSummary;

  try {
    // Fetch Solana chain TVL from dedicated endpoint
    let solanaTotalTvl = 0;
    try {
      const chainRes = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(8000) });
      if (chainRes.ok) {
        const chains = await chainRes.json();
        const solanaChain = chains.find((c: Record<string, unknown>) => c.name === 'Solana');
        if (solanaChain && typeof solanaChain.tvl === 'number') {
          solanaTotalTvl = solanaChain.tvl;
        }
      }
    } catch { /* use sum of protocols below */ }

    const res = await fetch(`${DEFILLAMA_API}/protocols`);
    const protocols = await res.json();

    // Filter Solana protocols and use Solana-specific TVL where possible
    const solanaProtocols: ProtocolData[] = [];
    for (const p of protocols) {
      const chains = p.chains as string[] | undefined;
      if (!chains || !chains.includes('Solana')) continue;

      // Use chainTvls.Solana if available, otherwise fallback to total TVL for Solana-only protocols
      let tvl = 0;
      if (p.chainTvls && typeof p.chainTvls.Solana === 'number') {
        tvl = p.chainTvls.Solana;
      } else if (chains.length === 1 && chains[0] === 'Solana') {
        // Single-chain Solana protocol — total TVL is Solana TVL
        tvl = (p.tvl as number) || 0;
      } else {
        // Multi-chain without breakdown — estimate proportionally
        // This is better than showing total multi-chain TVL as Solana
        tvl = ((p.tvl as number) || 0) / chains.length;
      }
      if (tvl <= 0) continue;

      solanaProtocols.push({
        name: p.name as string,
        slug: p.slug as string,
        tvl,
        tvlChange24h: (p.change_1d as number) || 0,
        tvlChange7d: (p.change_7d as number) || 0,
        category: (p.category as string) || 'Other',
        chains: chains,
        logo: (p.logo as string) || '',
        url: (p.url as string) || '',
      });
    }
    solanaProtocols.sort((a, b) => b.tvl - a.tvl);

    const totalTvl = solanaTotalTvl > 0 ? solanaTotalTvl : solanaProtocols.reduce((sum, p) => sum + p.tvl, 0);
    const topProtocols = solanaProtocols.filter(p => p.tvlChange24h !== 0);
    const avgChange = topProtocols.length > 0
      ? topProtocols.slice(0, 20).reduce((sum, p) => sum + p.tvlChange24h, 0) / Math.min(20, topProtocols.length)
      : 0;

    // Liquid staking data — TVL from DeFi Llama, APY from DeFi Llama yields
    const lstConfigs = [
      { protocol: 'Marinade', token: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', llamaPool: 'marinade', validatorCount: 0 },
      { protocol: 'Jito', token: 'jitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', llamaPool: 'jito', validatorCount: 0 },
      { protocol: 'BlazeStake', token: 'bSOL', mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', llamaPool: 'blazestake', validatorCount: 0 },
      { protocol: 'Sanctum', token: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', llamaPool: 'sanctum', validatorCount: 0 },
    ];

    // Fetch real APYs from DeFi Llama yields
    const apyMap = new Map<string, number>();
    try {
      const yieldsRes = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(8000) });
      if (yieldsRes.ok) {
        const yieldsData = await yieldsRes.json();
        const pools = yieldsData.data || yieldsData;
        for (const cfg of lstConfigs) {
          const pool = pools.find((p: Record<string, unknown>) =>
            p.chain === 'Solana' && (
              (p.symbol as string)?.toLowerCase().includes(cfg.token.toLowerCase()) ||
              (p.project as string)?.toLowerCase().includes(cfg.llamaPool)
            )
          );
          if (pool && typeof pool.apy === 'number') {
            apyMap.set(cfg.mint, pool.apy);
          }
        }
      }
    } catch { /* use 0 */ }

    // Compute total staked SOL for stake share calculation
    const totalStakedSol = solanaProtocols
      .filter((p: ProtocolData) => p.category === 'Liquid Staking')
      .reduce((s: number, p: ProtocolData) => s + p.tvl, 0) || totalTvl * 0.15; // LST is ~15% of total TVL

    // Build liquid staking entries
    const liquidStaking: LiquidStakingData[] = lstConfigs.map(cfg => {
      const protocol = solanaProtocols.find((p: ProtocolData) =>
        p.name.toLowerCase().includes(cfg.protocol.toLowerCase())
      );
      const tvl = protocol?.tvl || 0;
      const apy = apyMap.get(cfg.mint) || 0;
      const stakeShare = totalStakedSol > 0 ? (tvl / totalStakedSol) * 100 : 0;
      return {
        protocol: cfg.protocol,
        token: cfg.token,
        mint: cfg.mint,
        tvl,
        apy: Math.round(apy * 100) / 100,
        validatorCount: cfg.validatorCount, // 0 = unknown
        stakeShare: Math.round(stakeShare * 100) / 100,
      };
    });

    const summary: DeFiSummary = {
      totalTvl,
      tvlChange24h: avgChange,
      topProtocols: solanaProtocols.slice(0, 20),
      liquidStaking,
      timestamp: now,
    };

    cachedSummary = summary;
    lastFetch = now;
    return summary;
  } catch (err) {
    console.error('[DeFi Overview] Error:', err);
    if (cachedSummary) return cachedSummary;
    return {
      totalTvl: 0,
      tvlChange24h: 0,
      topProtocols: [],
      liquidStaking: [],
      timestamp: now,
    };
  }
}

export async function fetchProtocolTvlHistory(slug: string, days: number = 30): Promise<Array<{ date: number; tvl: number }>> {
  try {
    const res = await fetch(`${DEFILLAMA_API}/protocol/${slug}`);
    const data = await res.json();

    if (!data.tvl) return [];

    const cutoff = Date.now() / 1000 - days * 86400;
    return data.tvl
      .filter((d: { date: number }) => d.date > cutoff)
      .map((d: { date: number; totalLiquidityUSD: number }) => ({
        date: d.date * 1000,
        tvl: d.totalLiquidityUSD,
      }));
  } catch {
    return [];
  }
}
