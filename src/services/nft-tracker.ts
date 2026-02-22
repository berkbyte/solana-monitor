// NFT Tracker service — fetches Solana NFT collection stats from /api/nft-stats
// All data sourced from Magic Eden v2 API (proxied to avoid CORS)
// Prices arrive in lamports from the proxy; we convert to SOL (÷ 1e9) here.

export interface NFTCollection {
  name: string;
  slug: string;          // Magic Eden slug, used for marketplace URL
  floorPrice: number;    // SOL
  avgPrice24h: number;   // SOL — average sale price last 24 h
  volumeAll: number;     // SOL — all-time trading volume
  listed: number;        // items currently listed
}

export interface NFTSummary {
  topCollections: NFTCollection[];
  totalFloorValue: number; // Σ (floorPrice × listed)
}

// ── client-side cache ────────────────────────────────────────
let cachedSummary: NFTSummary | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Pretty names for each slug
const NAMES: Record<string, string> = {
  mad_lads:                        'Mad Lads',
  tensorians:                      'Tensorians',
  claynosaurz:                     'Claynosaurz',
  famous_fox_federation:           'Famous Fox Federation',
  okay_bears:                      'Okay Bears',
  degods:                          'DeGods',
  solana_monkey_business:          'Solana Monkey Business',
  froganas:                        'Frogana',
  transdimensional_fox_federation: 'Transdimensional Fox Federation',
  aurory:                          'Aurory',
};

const LAMPORTS = 1_000_000_000; // 1 SOL = 1e9 lamports

/** Proxy response shape — values in lamports */
interface ProxyCollection {
  slug: string;
  floorPrice: number;
  listedCount: number;
  avgPrice24hr: number;
  volumeAll: number;
}

export async function fetchNFTData(): Promise<NFTSummary> {
  const now = Date.now();
  if (cachedSummary && now - lastFetch < CACHE_TTL) return cachedSummary;

  try {
    const res = await fetch('/api/nft-stats', {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Proxy ${res.status}`);

    const body = (await res.json()) as { collections: ProxyCollection[] };
    const raw = body.collections ?? [];

    const collections: NFTCollection[] = raw
      .filter((d) => d && d.floorPrice > 0)
      .map((d) => ({
        name: NAMES[d.slug] ?? d.slug,
        slug: d.slug,
        floorPrice:  d.floorPrice  / LAMPORTS,
        avgPrice24h: (d.avgPrice24hr ?? 0) / LAMPORTS,
        volumeAll:   (d.volumeAll ?? 0)    / LAMPORTS,
        listed:      d.listedCount ?? 0,
      }))
      .sort((a, b) => b.volumeAll - a.volumeAll);

    const totalFloorValue = collections.reduce(
      (sum, c) => sum + c.floorPrice * c.listed,
      0,
    );

    const summary: NFTSummary = { topCollections: collections, totalFloorValue };
    cachedSummary = summary;
    lastFetch = now;
    return summary;
  } catch (e) {
    console.warn('[NFT] fetch failed:', e);
    if (cachedSummary) return cachedSummary;
    return { topCollections: [], totalFloorValue: 0 };
  }
}
