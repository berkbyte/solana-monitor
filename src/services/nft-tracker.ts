// NFT Tracker service — Solana NFT ecosystem data
// Uses Magic Eden public API for real collection data

export interface NFTCollection {
  name: string;
  slug: string;
  image?: string;
  floorPrice: number;
  volume24h: number;
  volumeChange24h: number;
  listed: number;
  supply: number;
  holders: number;
  marketplace: 'tensor' | 'magiceden' | 'both';
}

export interface NFTSummary {
  totalVolume24h: number;
  topCollections: NFTCollection[];
  mintActivity: number;
  cNftMints: number;
}

let cachedSummary: NFTSummary | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Top Solana NFT collections — slug must match Magic Eden /v2/collections/{slug}/stats
const TOP_COLLECTIONS = [
  { name: 'Mad Lads', slug: 'mad_lads', supply: 10000, marketplace: 'tensor' as const },
  { name: 'Tensorians', slug: 'tensorians', supply: 10000, marketplace: 'tensor' as const },
  { name: 'Claynosaurz', slug: 'claynosaurz', supply: 10000, marketplace: 'both' as const },
  { name: 'Famous Fox Federation', slug: 'famous_fox_federation', supply: 7777, marketplace: 'both' as const },
  { name: 'Okay Bears', slug: 'okay_bears', supply: 10000, marketplace: 'magiceden' as const },
  { name: 'DeGods', slug: 'degods', supply: 10000, marketplace: 'both' as const },
  { name: 'Solana Monkey Business', slug: 'solana_monkey_business', supply: 5000, marketplace: 'both' as const },
  { name: 'Bonk NFTs', slug: 'bonk_nfts', supply: 15000, marketplace: 'tensor' as const },
  { name: 'Marinade Chefs', slug: 'marinade_chefs', supply: 5000, marketplace: 'tensor' as const },
  { name: 'Aurory', slug: 'aurory', supply: 10000, marketplace: 'magiceden' as const },
];

async function fetchFromMagicEden(): Promise<NFTCollection[]> {
  try {
    // Use our serverless proxy to avoid CORS issues with Magic Eden
    const res = await fetch('/api/nft-stats', {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
    const data = await res.json() as { collections: Array<Record<string, unknown>> };
    const items = data.collections || [];

    const colMap = new Map(TOP_COLLECTIONS.map(c => [c.slug, c]));

    const collections = items
      .map((d) => {
        const slug = (d.slug as string) || '';
        const meta = colMap.get(slug);
        const floorPrice = ((d.floorPrice as number) || 0) / 1e9;
        const avgPrice = ((d.avgPrice24hr as number) || 0) / 1e9;
        const listed = (d.listedCount as number) || 0;
        const volumeAll = ((d.volumeAll as number) || 0) / 1e9;
        return {
          name: meta?.name || slug,
          slug,
          floorPrice,
          volume24h: avgPrice * listed > 0 ? avgPrice * listed : 0,
          volumeChange24h: 0,
          listed,
          supply: meta?.supply || 0,
          holders: 0,
          marketplace: meta?.marketplace || 'both' as const,
          _volumeAll: volumeAll,
        } as NFTCollection & { _volumeAll: number };
      })
      .filter((c): c is NFTCollection & { _volumeAll: number } => c.floorPrice > 0)
      .sort((a, b) => b._volumeAll - a._volumeAll)
      .map(({ _volumeAll: _, ...c }) => c as NFTCollection);

    return collections;
  } catch (e) {
    console.warn('[NFT] Magic Eden proxy failed:', e);
    return [];
  }
}

function generateFallbackNFTData(): NFTCollection[] {
  // Static fallback — all zeros for price fields since we can't verify
  return TOP_COLLECTIONS.map(c => ({
    name: c.name,
    slug: c.slug,
    floorPrice: 0,
    volume24h: 0,
    volumeChange24h: 0,
    listed: 0,
    supply: c.supply,
    holders: 0,
    marketplace: c.marketplace,
  }));
}

export async function fetchNFTData(): Promise<NFTSummary> {
  const now = Date.now();
  if (cachedSummary && now - lastFetch < CACHE_TTL) return cachedSummary;

  let collections = await fetchFromMagicEden();

  if (collections.length === 0) {
    collections = generateFallbackNFTData();
  }

  const totalVolume24h = collections.reduce((s, c) => s + c.volume24h, 0);

  // Fetch real mint activity from Solana RPC (recent block signatures)
  let mintActivity = 0;
  let cNftMints = 0;
  try {
    // Query recent signatures for Metaplex Token Metadata Program (for NFT mints)
    const metaplexProgram = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [metaplexProgram, { limit: 100 }]
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const sigs = data.result || [];
      // Extrapolate: sigs returned are from last ~minutes. Scale to 24h metric.
      if (sigs.length > 0) {
        const oldest = sigs[sigs.length - 1];
        const newestTime = sigs[0]?.blockTime || Math.floor(now / 1000);
        const oldestTime = oldest?.blockTime || newestTime - 60;
        const spanSec = Math.max(1, newestTime - oldestTime);
        const txPerSec = sigs.length / spanSec;
        mintActivity = Math.round(txPerSec * 86400); // Extrapolate to 24h
      }
    }
  } catch {
    // Leave as 0 — unknown
  }

  // Query Bubblegum program for cNFT mints
  try {
    const bubblegumProgram = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [bubblegumProgram, { limit: 100 }]
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const sigs = data.result || [];
      if (sigs.length > 0) {
        const newestTime = sigs[0]?.blockTime || Math.floor(now / 1000);
        const oldestTime = sigs[sigs.length - 1]?.blockTime || newestTime - 60;
        const spanSec = Math.max(1, newestTime - oldestTime);
        cNftMints = Math.round((sigs.length / spanSec) * 86400);
      }
    }
  } catch {
    // Leave as 0
  }

  const summary: NFTSummary = {
    totalVolume24h,
    topCollections: collections.slice(0, 10),
    mintActivity,
    cNftMints,
  };

  cachedSummary = summary;
  lastFetch = now;
  return summary;
}
