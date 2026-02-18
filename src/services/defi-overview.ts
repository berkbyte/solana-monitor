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
    const res = await fetch(`${DEFILLAMA_API}/protocols`);
    const protocols = await res.json();

    // Filter Solana protocols
    const solanaProtocols = protocols
      .filter((p: Record<string, unknown>) => {
        const chains = p.chains as string[] | undefined;
        return chains && chains.includes('Solana');
      })
      .map((p: Record<string, unknown>) => ({
        name: p.name as string,
        slug: p.slug as string,
        tvl: (p.tvl as number) || 0,
        tvlChange24h: (p.change_1d as number) || 0,
        tvlChange7d: (p.change_7d as number) || 0,
        category: (p.category as string) || 'Other',
        chains: (p.chains as string[]) || [],
        logo: (p.logo as string) || '',
        url: (p.url as string) || '',
      }))
      .sort((a: ProtocolData, b: ProtocolData) => b.tvl - a.tvl);

    const totalTvl = solanaProtocols.reduce((sum: number, p: ProtocolData) => sum + p.tvl, 0);
    const avgChange = solanaProtocols.length > 0
      ? solanaProtocols.reduce((sum: number, p: ProtocolData) => sum + p.tvlChange24h, 0) / solanaProtocols.length
      : 0;

    // Liquid staking data
    const liquidStaking: LiquidStakingData[] = [
      { protocol: 'Marinade', token: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', tvl: 0, apy: 7.2, validatorCount: 450, stakeShare: 0 },
      { protocol: 'Jito', token: 'jitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', tvl: 0, apy: 7.8, validatorCount: 200, stakeShare: 0 },
      { protocol: 'BlazeStake', token: 'bSOL', mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', tvl: 0, apy: 7.0, validatorCount: 400, stakeShare: 0 },
      { protocol: 'Sanctum', token: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', tvl: 0, apy: 7.5, validatorCount: 100, stakeShare: 0 },
    ];

    // Enrich with DeFi Llama data
    for (const lst of liquidStaking) {
      const protocol = solanaProtocols.find((p: ProtocolData) =>
        p.name.toLowerCase().includes(lst.protocol.toLowerCase())
      );
      if (protocol) {
        lst.tvl = protocol.tvl;
      }
    }

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
