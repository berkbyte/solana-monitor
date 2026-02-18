/**
 * Twitter/X CA Search Service
 *
 * Searches X/Twitter for tweets mentioning a Solana token's contract address.
 * Uses the /api/twitter-ca serverless endpoint (Bright Data Web Scraper).
 *
 * The API is async: first call triggers the scrape, subsequent calls poll
 * with a snapshot_id until results are ready.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CATweet {
  id: string;
  text: string;
  author: string;
  handle: string;
  avatar: string;
  followers: number;
  likes: number;
  retweets: number;
  replies: number;
  date: string;
  url: string;
}

export interface CATweetResult {
  status: 'ready' | 'pending' | 'error';
  tweets: CATweet[];
  snapshotId?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

const CACHE_TTL = 5 * 60_000; // 5 minutes
const cache = new Map<string, { data: CATweetResult; ts: number }>();

// In-flight snapshot IDs for pending scrapes
const pendingSnapshots = new Map<string, string>();

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch tweets mentioning the given mint/CA.
 *
 * - First call triggers BrightData scrape; may return { status: 'pending' }
 * - Call again to poll; once ready returns { status: 'ready', tweets: [...] }
 * - Results are cached for 5 minutes
 */
export async function fetchCATweets(mint: string): Promise<CATweetResult> {
  // Return cache if fresh
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    // If we have a pending snapshot, poll with it
    const existingSnapshot = pendingSnapshots.get(mint);
    const queryParams = existingSnapshot
      ? `mint=${encodeURIComponent(mint)}&snapshot_id=${encodeURIComponent(existingSnapshot)}`
      : `mint=${encodeURIComponent(mint)}`;

    const res = await fetch(`/api/twitter-ca?${queryParams}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (res.status === 202 && data.snapshot_id) {
      // Scrape still in progress — store snapshot_id for next poll
      pendingSnapshots.set(mint, data.snapshot_id);
      return { status: 'pending', tweets: [], snapshotId: data.snapshot_id };
    }

    if (res.ok && data.status === 'ready') {
      // Scrape complete — cache and return
      pendingSnapshots.delete(mint);
      const result: CATweetResult = {
        status: 'ready',
        tweets: (data.tweets || []) as CATweet[],
      };
      cache.set(mint, { data: result, ts: Date.now() });
      return result;
    }

    // Error cases
    pendingSnapshots.delete(mint);
    return { status: 'error', tweets: [], error: data.error || 'Unknown error' };
  } catch (err) {
    console.warn('[TwitterCA] Fetch error:', err);
    return { status: 'error', tweets: [], error: 'Network error' };
  }
}

/**
 * Clear cached tweets for a mint (e.g., when re-analyzing).
 */
export function clearCATweetCache(mint: string): void {
  cache.delete(mint);
  pendingSnapshots.delete(mint);
}
