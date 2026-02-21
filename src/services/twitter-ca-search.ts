/**
 * Twitter/X CA Search Service
 *
 * Searches X/Twitter for tweets mentioning a Solana token's contract address.
 * Uses the /api/x-api serverless endpoint (SocialData.tools API).
 *
 * The API is synchronous — results are returned immediately.
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
  views: number;
  date: string;
  url: string;
}

export interface CATweetResult {
  status: 'ready' | 'pending' | 'error';
  tweets: CATweet[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

const CACHE_TTL = 5 * 60_000; // 5 minutes
const cache = new Map<string, { data: CATweetResult; ts: number }>();

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch tweets mentioning the given mint/CA.
 * Results are returned synchronously and cached for 5 minutes.
 */
export async function fetchCATweets(mint: string): Promise<CATweetResult> {
  // Return cache if fresh
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/x-api?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (res.ok && data.status === 'ready') {
      const result: CATweetResult = {
        status: 'ready',
        tweets: (data.tweets || []) as CATweet[],
      };
      cache.set(mint, { data: result, ts: Date.now() });
      return result;
    }

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
}
