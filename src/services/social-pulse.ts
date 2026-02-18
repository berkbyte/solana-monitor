/**
 * Social Pulse Service — LunarCrush Integration
 *
 * Fetches Solana-related social media data (primarily X/Twitter)
 * via LunarCrush's public topic API.
 *
 * Requires VITE_LUNARCRUSH_KEY environment variable.
 */

const LUNARCRUSH_KEY = import.meta.env.VITE_LUNARCRUSH_KEY || '';
const CACHE_TTL = 5 * 60_000; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SocialPost {
  id: string;
  text: string;
  creator: string;
  creatorDisplayName: string;
  creatorFollowers: number;
  creatorProfileImage: string;
  interactions: number;
  sentimentDetail: number; // 1-5 scale
  postCreated: number; // unix timestamp
  postUrl: string;
  network: string; // 'twitter', 'reddit', etc.
}

export interface SocialTopicSummary {
  title: string;
  socialVolume24h: number;
  socialVolumePrev24h: number;
  socialDominance: number;
  sentiment: number; // 1-5 average
  interactions24h: number;
  contributors24h: number;
  postsCount24h: number;
}

export interface SocialPulseData {
  summary: SocialTopicSummary | null;
  posts: SocialPost[];
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

let cachedData: SocialPulseData | null = null;

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const BASE = 'https://lunarcrush.com/api4/public';

async function lcFetch<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn('[SocialPulse] Invalid or expired API key');
        return null;
      }
      console.warn(`[SocialPulse] HTTP ${res.status} for ${path}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    console.warn('[SocialPulse] Fetch error:', err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Topic Summary                                                      */
/* ------------------------------------------------------------------ */

interface LCTopicSummaryResponse {
  data?: {
    title?: string;
    num_posts?: number;
    interactions?: number;
    contributors?: number;
    sentiment?: number;
    social_dominance?: number;
    num_posts_previous?: number;
    interactions_previous?: number;
  };
}

async function fetchTopicSummary(apiKey: string): Promise<SocialTopicSummary | null> {
  const raw = await lcFetch<LCTopicSummaryResponse>('/topic/solana/v1', apiKey);
  const d = raw?.data;
  if (!d) return null;

  return {
    title: d.title || 'Solana',
    socialVolume24h: d.num_posts || 0,
    socialVolumePrev24h: d.num_posts_previous || 0,
    socialDominance: d.social_dominance || 0,
    sentiment: d.sentiment || 3,
    interactions24h: d.interactions || 0,
    contributors24h: d.contributors || 0,
    postsCount24h: d.num_posts || 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Topic Posts (X / Twitter)                                          */
/* ------------------------------------------------------------------ */

interface LCPost {
  id?: string | number;
  post_id?: string;
  body?: string;
  post_title?: string;
  creator_name?: string;
  creator_display_name?: string;
  creator_followers?: number;
  creator_profile_image?: string;
  interactions_total?: number;
  sentiment_detail?: number;
  post_created?: number;
  post_url?: string;
  network?: string;
}

interface LCTopicPostsResponse {
  data?: LCPost[];
}

async function fetchTopicPosts(apiKey: string): Promise<SocialPost[]> {
  const raw = await lcFetch<LCTopicPostsResponse>('/topic/solana/posts/v1', apiKey);
  const posts = raw?.data;
  if (!Array.isArray(posts)) return [];

  return posts
    .filter((p) => p.body || p.post_title)
    .slice(0, 15) // max 15 posts
    .map((p): SocialPost => ({
      id: String(p.id || p.post_id || Math.random()),
      text: (p.body || p.post_title || '').slice(0, 280),
      creator: p.creator_name || 'Unknown',
      creatorDisplayName: p.creator_display_name || p.creator_name || 'Unknown',
      creatorFollowers: p.creator_followers || 0,
      creatorProfileImage: p.creator_profile_image || '',
      interactions: p.interactions_total || 0,
      sentimentDetail: p.sentiment_detail || 3,
      postCreated: p.post_created || 0,
      postUrl: p.post_url || '',
      network: p.network || 'twitter',
    }));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function fetchSocialPulse(): Promise<SocialPulseData | null> {
  if (!LUNARCRUSH_KEY) return null;

  // Return cache if fresh
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return cachedData;
  }

  // Fetch summary + posts in parallel
  const [summary, posts] = await Promise.all([
    fetchTopicSummary(LUNARCRUSH_KEY),
    fetchTopicPosts(LUNARCRUSH_KEY),
  ]);

  if (!summary && posts.length === 0) return null;

  cachedData = {
    summary,
    posts,
    fetchedAt: Date.now(),
  };

  return cachedData;
}

export function clearSocialPulseCache(): void {
  cachedData = null;
}
