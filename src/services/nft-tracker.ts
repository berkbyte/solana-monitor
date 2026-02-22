// NFT Tracker service — Solana NFT ecosystem data
// Uses Magic Eden v2 API (via serverless proxy) for real collection stats

export interface NFTCollection {
  name: string;
  slug: string;
  floorPrice: number;   // SOL
  avgPrice24h: number;  // SOL (avg sale price last 24h)
  volumeAll: number;    // SOL (all-time volume)
  listed: number;
  marketplace: 'tensor' | 'magiceden' | 'both';
}

export interface NFTSummary {
  topCollections: NFTCollection[];
  totalFloorValue: number; // sum of (floorPrice * listed) across collections
}

let cachedSummary: NFTSummary | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Collection metadata — slug must match Magic Eden /v2/collections/{slug}/stats
const COLLECTION_META: Record<string, { name: string; marketplace: NFTCollection['marketplace'] }> = {
  mad_lads:                         { name: 'Mad Lads',                         marketplace: 'tensor'    },
  tensorians:                       { name: 'Tensorians',                       marketplace: 'tensor'    },
  claynosaurz:                      { name: 'Claynosaurz',                      marketplace: 'both'      },
  famous_fox_federation:            { name: 'Famous Fox Federation',            marketplace: 'both'      },
  okay_bears:                       { name: 'Okay Bears',                       marketplace: 'magiceden' },
  degods:                           { name: 'DeGods',                           marketplace: 'both'      },
  solana_monkey_business:           { name: 'Solana Monkey Business',           marketplace: 'both'      },
  froganas:                         { name: 'Frogana',                          marketplace: 'both'      },
  transdimensional_fox_federation:  { name: 'Transdimensional Fox Federation',  marketplace: 'both'      },
  aurory:                           { name: 'Aurory',                           marketplace: 'magiceden' },
};

export async function fetchNFTData(): Promise<NFTSummary> {
  const now = Date.now();
  if (cachedSummary && now - lastFetch < CACHE_TTL) return cachedSummary;

  try {
    const res = await fetch('/api/nft-stats', {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);

    const data = await res.json() as {
      collections: Array<{
        slug: string;
        floorPrice: number;      // lamports
        listedCount: number;
        avgPrice24hr: number;    // lamports
        volumeAll: number;       // lamports
      }>;
    };

    const items = data.collections || [];

    const collections: NFTCollection[] = items
      .filter(d => d && d.floorPrice > 0)
      .map(d => {
        const slug = d.slug || '';
        const meta = COLLECTION_META[slug];
        return {
          name: meta?.name || slug,
          slug,
          floorPrice: d.floorPrice / 1e9,
          avgPrice24h: (d.avgPrice24hr || 0) / 1e9,
          volumeAll: (d.volumeAll || 0) / 1e9,
          listed: d.listedCount || 0,
          marketplace: meta?.marketplace || 'both',
        };
      })
      .sort((a, b) => b.volumeAll - a.volumeAll);

    const totalFloorValue = collections.reduce(
      (sum, c) => sum + c.floorPrice * c.listed, 0
    );

    const summary: NFTSummary = {
      topCollections: collections,
      totalFloorValue,
    };

    cachedSummary = summary;
    lastFetch = now;
    return summary;
  } catch (e) {
    console.warn('[NFT] Failed to fetch NFT data:', e);
    // Return stale cache if available, otherwise empty
    if (cachedSummary) return cachedSummary;
    return { topCollections: [], totalFloorValue: 0 };
  }
}
