/**
 * X Insights Service
 *
 * Combines LunarCrush multi-topic social data with
 * Bright Data on-demand keyword search for X/Twitter.
 */

import {
  fetchSocialPulse,
  type SocialPulseData,
  type SocialPost,
  type SocialTopicSummary,
} from './social-pulse';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TopicMetrics {
  topic: string;
  label: string;
  posts24h: number;
  interactions24h: number;
  sentiment: number; // 1-5
  socialDominance: number;
  volumeChange: number; // percentage
}

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

export interface XInsightsData {
  solana: SocialPulseData | null;
  topics: TopicMetrics[];
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/*  LunarCrush multi-topic                                             */
/* ------------------------------------------------------------------ */

const LUNARCRUSH_KEY = import.meta.env.VITE_LUNARCRUSH_KEY || '';
const LC_BASE = 'https://lunarcrush.com/api4/public';
const TOPIC_CACHE_TTL = 5 * 60_000;

const TRACKED_TOPICS = [
  { topic: 'solana', label: 'Solana' },
  { topic: 'bitcoin', label: 'Bitcoin' },
  { topic: 'ethereum', label: 'Ethereum' },
  { topic: 'defi', label: 'DeFi' },
  { topic: 'memecoin', label: 'Memecoins' },
  { topic: 'nft', label: 'NFTs' },
];

let topicsCache: { data: TopicMetrics[]; ts: number } | null = null;

async function lcFetch<T>(path: string): Promise<T | null> {
  if (!LUNARCRUSH_KEY) return null;
  try {
    const res = await fetch(`${LC_BASE}${path}`, {
      headers: { Authorization: `Bearer ${LUNARCRUSH_KEY}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

interface LCTopicData {
  data?: {
    title?: string;
    num_posts?: number;
    interactions?: number;
    sentiment?: number;
    social_dominance?: number;
    num_posts_previous?: number;
  };
}

async function fetchTopicMetrics(topic: string, label: string): Promise<TopicMetrics | null> {
  const raw = await lcFetch<LCTopicData>(`/topic/${topic}/v1`);
  const d = raw?.data;
  if (!d) return null;

  const posts = d.num_posts || 0;
  const prev = d.num_posts_previous || 0;
  const volChange = prev > 0 ? ((posts - prev) / prev) * 100 : 0;

  return {
    topic,
    label,
    posts24h: posts,
    interactions24h: d.interactions || 0,
    sentiment: d.sentiment || 3,
    socialDominance: d.social_dominance || 0,
    volumeChange: volChange,
  };
}

async function fetchAllTopicMetrics(): Promise<TopicMetrics[]> {
  if (topicsCache && Date.now() - topicsCache.ts < TOPIC_CACHE_TTL) {
    return topicsCache.data;
  }

  const results = await Promise.allSettled(
    TRACKED_TOPICS.map(t => fetchTopicMetrics(t.topic, t.label))
  );

  const metrics = results
    .filter((r): r is PromiseFulfilledResult<TopicMetrics | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((m): m is TopicMetrics => m !== null);

  if (metrics.length > 0) {
    topicsCache = { data: metrics, ts: Date.now() };
  }

  return metrics;
}

/* ------------------------------------------------------------------ */
/*  Bright Data X search (on-demand keyword search)                    */
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
/*  Combined fetch                                                     */
/* ------------------------------------------------------------------ */

let insightsCache: XInsightsData | null = null;

export async function fetchXInsights(): Promise<XInsightsData> {
  // Return cache if fresh
  if (insightsCache && Date.now() - insightsCache.fetchedAt < TOPIC_CACHE_TTL) {
    return insightsCache;
  }

  const [solana, topics] = await Promise.all([
    fetchSocialPulse().catch(() => null),
    fetchAllTopicMetrics().catch(() => [] as TopicMetrics[]),
  ]);

  insightsCache = {
    solana,
    topics,
    fetchedAt: Date.now(),
  };

  return insightsCache;
}

export function clearXInsightsCache(): void {
  insightsCache = null;
  topicsCache = null;
}

// Re-export types used by panel
export type { SocialPost, SocialTopicSummary, SocialPulseData };
