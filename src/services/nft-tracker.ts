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

// Well-known Solana NFT collections for fallback data
const KNOWN_COLLECTIONS: Array<Omit<NFTCollection, 'volume24h' | 'volumeChange24h'>> = [
  { name: 'Mad Lads', slug: 'mad_lads', floorPrice: 85, listed: 120, supply: 10000, holders: 6200, marketplace: 'tensor' },
  { name: 'Tensorians', slug: 'tensorians', floorPrice: 25, listed: 280, supply: 10000, holders: 5800, marketplace: 'tensor' },
  { name: 'Claynosaurz', slug: 'claynosaurz', floorPrice: 22, listed: 350, supply: 10000, holders: 5100, marketplace: 'both' },
  { name: 'Famous Fox Federation', slug: 'famous_fox_federation', floorPrice: 18, listed: 240, supply: 7777, holders: 4200, marketplace: 'both' },
  { name: 'Okay Bears', slug: 'okay_bears', floorPrice: 12, listed: 450, supply: 10000, holders: 4800, marketplace: 'magiceden' },
  { name: 'DeGods', slug: 'degods', floorPrice: 8, listed: 500, supply: 10000, holders: 3900, marketplace: 'both' },
  { name: 'Solana Monkey Business', slug: 'solana_monkey_business', floorPrice: 15, listed: 180, supply: 5000, holders: 3200, marketplace: 'both' },
  { name: 'Bonk NFTs', slug: 'bonk_nfts', floorPrice: 3, listed: 800, supply: 15000, holders: 8000, marketplace: 'tensor' },
  { name: 'Marinade Chefs', slug: 'marinade_chefs', floorPrice: 5, listed: 150, supply: 5000, holders: 2800, marketplace: 'tensor' },
  { name: 'Aurory', slug: 'aurory', floorPrice: 4, listed: 320, supply: 10000, holders: 4100, marketplace: 'magiceden' },
];

async function fetchFromMagicEden(): Promise<NFTCollection[]> {
  try {
    const res = await fetch(
      'https://api-mainnet.magiceden.dev/v2/marketplace/popular_collections?timeRange=1d&limit=10',
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((c: Record<string, unknown>) => ({
      name: (c.name as string) || 'Unknown',
      slug: (c.symbol as string) || '',
      image: (c.image as string) || undefined,
      floorPrice: ((c.floorPrice as number) || 0) / 1e9, // lamports to SOL
      volume24h: ((c.volumeAll as number) || 0) / 1e9,
      volumeChange24h: typeof c.volumeChange === 'number' ? Math.round(c.volumeChange) : 0,
      listed: (c.listedCount as number) || 0,
      supply: (c.totalItems as number) || 10000,
      holders: typeof c.holders === 'number' ? c.holders : 0,
      marketplace: 'magiceden' as const,
    })).filter((c: NFTCollection) => c.floorPrice > 0);
  } catch (e) {
    console.warn('[NFT] Magic Eden API failed:', e);
    return [];
  }
}

function generateFallbackNFTData(): NFTCollection[] {
  // Static fallback with known approximate values (no Math.random)
  return KNOWN_COLLECTIONS.map(c => ({
    ...c,
    volume24h: 0, // unknown — show 0 rather than fake
    volumeChange24h: 0,
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
