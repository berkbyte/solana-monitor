/**
 * X Insights Service — Bright Data Only
 *
 * Auto-fetches trending Solana tweets via Bright Data Web Scraper
 * and provides on-demand keyword search. No LunarCrush dependency.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface XSearchResult {
  status: 'ready' | 'pending' | 'error';
  tweets: XTweet[];
  snapshotId?: string;
  error?: string;
}

export interface XTweet {
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

export interface XInsightsMetrics {
  tweetCount: number;
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  totalEngagement: number;
  avgEngagement: number;
  topReach: number; // highest follower count
}

export interface XInsightsData {
  trending: XTweet[];
  metrics: XInsightsMetrics | null;
  status: 'ready' | 'pending' | 'loading';
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Bright Data X search (shared for auto-feed and manual search)      */
/* ------------------------------------------------------------------ */

const searchCache = new Map<string, { data: XSearchResult; ts: number }>();
const pendingSnapshots = new Map<string, string>();
const SEARCH_CACHE_TTL = 5 * 60_000;

export async function searchX(query: string): Promise<XSearchResult> {
  const key = query.toLowerCase().trim();

  // Return cache if fresh
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    return cached.data;
  }

  try {
    const existingSnapshot = pendingSnapshots.get(key);
    const params = existingSnapshot
      ? `q=${encodeURIComponent(key)}&snapshot_id=${encodeURIComponent(existingSnapshot)}`
      : `q=${encodeURIComponent(key)}`;

    const res = await fetch(`/api/x-search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (res.status === 202 && data.snapshot_id) {
      pendingSnapshots.set(key, data.snapshot_id);
      return { status: 'pending', tweets: [], snapshotId: data.snapshot_id };
    }

    if (res.ok && data.status === 'ready') {
      pendingSnapshots.delete(key);
      const result: XSearchResult = {
        status: 'ready',
        tweets: (data.tweets || []) as XTweet[],
      };
      searchCache.set(key, { data: result, ts: Date.now() });
      return result;
    }

    pendingSnapshots.delete(key);
    return { status: 'error', tweets: [], error: data.error || 'Search failed' };
  } catch (err) {
    console.warn('[XInsights] Search error:', err);
    return { status: 'error', tweets: [], error: 'Network error' };
  }
}

export function clearSearchCache(query?: string): void {
  if (query) {
    const key = query.toLowerCase().trim();
    searchCache.delete(key);
    pendingSnapshots.delete(key);
  } else {
    searchCache.clear();
    pendingSnapshots.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  Compute metrics from tweets                                        */
/* ------------------------------------------------------------------ */

function computeMetrics(tweets: XTweet[]): XInsightsMetrics | null {
  if (tweets.length === 0) return null;

  const totalLikes = tweets.reduce((s, t) => s + t.likes, 0);
  const totalRetweets = tweets.reduce((s, t) => s + t.retweets, 0);
  const totalReplies = tweets.reduce((s, t) => s + t.replies, 0);
  const totalEngagement = totalLikes + totalRetweets + totalReplies;
  const topReach = Math.max(...tweets.map(t => t.followers));

  return {
    tweetCount: tweets.length,
    totalLikes,
    totalRetweets,
    totalReplies,
    totalEngagement,
    avgEngagement: Math.round(totalEngagement / tweets.length),
    topReach,
  };
}

/* ------------------------------------------------------------------ */
/*  Auto-feed: fetch trending Solana tweets via Bright Data            */
/* ------------------------------------------------------------------ */

let insightsCache: XInsightsData | null = null;

export async function fetchXInsights(): Promise<XInsightsData> {
  // Return cache if fresh and ready
  if (insightsCache && insightsCache.status === 'ready' && Date.now() - insightsCache.fetchedAt < SEARCH_CACHE_TTL) {
    return insightsCache;
  }

  // Search "solana" via Bright Data
  const result = await searchX('solana');

  if (result.status === 'pending') {
    return { trending: [], metrics: null, status: 'pending', fetchedAt: Date.now() };
  }

  if (result.status === 'error') {
    // Return previous cache if available, otherwise empty
    if (insightsCache && insightsCache.status === 'ready') return insightsCache;
    return { trending: [], metrics: null, status: 'ready', fetchedAt: Date.now() };
  }

  const metrics = computeMetrics(result.tweets);

  insightsCache = {
    trending: result.tweets,
    metrics,
    status: 'ready',
    fetchedAt: Date.now(),
  };

  return insightsCache;
}

export function clearXInsightsCache(): void {
  insightsCache = null;
}
