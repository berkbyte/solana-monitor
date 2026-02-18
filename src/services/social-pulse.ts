/**
 * Social Pulse Service — Bright Data Integration
 *
 * Fetches Solana-related social media data from X/Twitter
 * via the /api/x-search Bright Data serverless endpoint.
 *
 * No API key needed on the frontend — the serverless function
 * uses BRIGHTDATA_API_KEY on the backend.
 */

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

// Pending snapshot for async polling
let pendingSnapshotId: string | null = null;

/* ------------------------------------------------------------------ */
/*  Bright Data X search                                               */
/* ------------------------------------------------------------------ */

interface BDTweet {
  id?: string;
  post_id?: string;
  tweet_id?: string;
  text?: string;
  description?: string;
  content?: string;
  body?: string;
  user_name?: string;
  author_name?: string;
  name?: string;
  user_screen_name?: string;
  user_handle?: string;
  screen_name?: string;
  user_profile_image?: string;
  avatar?: string;
  user_followers?: number;
  followers_count?: number;
  likes?: number;
  favorite_count?: number;
  retweets?: number;
  retweet_count?: number;
  replies?: number;
  reply_count?: number;
  date?: string;
  timestamp?: string;
  created_at?: string;
  url?: string;
  tweet_url?: string;
  post_url?: string;
}

async function fetchSolanaTweets(): Promise<{ tweets: BDTweet[]; status: string }> {
  try {
    const params = pendingSnapshotId
      ? `q=solana&snapshot_id=${encodeURIComponent(pendingSnapshotId)}`
      : 'q=solana';

    const res = await fetch(`/api/x-search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (res.status === 202 && data.snapshot_id) {
      pendingSnapshotId = data.snapshot_id;
      return { tweets: [], status: 'pending' };
    }

    if (res.ok && data.status === 'ready') {
      pendingSnapshotId = null;
      return { tweets: data.tweets || [], status: 'ready' };
    }

    pendingSnapshotId = null;
    return { tweets: [], status: 'error' };
  } catch (err) {
    console.warn('[SocialPulse] Fetch error:', err);
    return { tweets: [], status: 'error' };
  }
}

function tweetsToSocialPosts(tweets: BDTweet[]): SocialPost[] {
  return tweets.slice(0, 15).map((t): SocialPost => {
    const likes = t.likes || t.favorite_count || 0;
    const retweets = t.retweets || t.retweet_count || 0;
    const replies = t.replies || t.reply_count || 0;
    const text = (t.text || t.description || t.content || t.body || '').slice(0, 280);
    const dateStr = t.date || t.timestamp || t.created_at || '';
    const ts = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0;

    return {
      id: String(t.id || t.post_id || t.tweet_id || Math.random()),
      text,
      creator: t.user_screen_name || t.user_handle || t.screen_name || 'unknown',
      creatorDisplayName: t.user_name || t.author_name || t.name || 'Unknown',
      creatorFollowers: t.user_followers || t.followers_count || 0,
      creatorProfileImage: t.user_profile_image || t.avatar || '',
      interactions: likes + retweets + replies,
      sentimentDetail: 3, // neutral default — no sentiment analysis
      postCreated: ts,
      postUrl: t.url || t.tweet_url || t.post_url || '',
      network: 'twitter',
    };
  });
}

function computeSummaryFromTweets(tweets: BDTweet[]): SocialTopicSummary | null {
  if (tweets.length === 0) return null;

  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  const uniqueAuthors = new Set<string>();

  for (const t of tweets) {
    totalLikes += t.likes || t.favorite_count || 0;
    totalRetweets += t.retweets || t.retweet_count || 0;
    totalReplies += t.replies || t.reply_count || 0;
    const author = t.user_screen_name || t.user_handle || t.screen_name || '';
    if (author) uniqueAuthors.add(author);
  }

  const totalInteractions = totalLikes + totalRetweets + totalReplies;

  return {
    title: 'Solana',
    socialVolume24h: tweets.length,
    socialVolumePrev24h: 0, // no previous data from Bright Data
    socialDominance: 0,
    sentiment: 3, // neutral — no sentiment analysis
    interactions24h: totalInteractions,
    contributors24h: uniqueAuthors.size,
    postsCount24h: tweets.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function fetchSocialPulse(): Promise<SocialPulseData | null> {
  // Return cache if fresh
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return cachedData;
  }

  const result = await fetchSolanaTweets();

  // If still pending, return previous cache or null
  if (result.status === 'pending') {
    return cachedData || null;
  }

  if (result.status === 'error' || result.tweets.length === 0) {
    return cachedData || null;
  }

  const posts = tweetsToSocialPosts(result.tweets);
  const summary = computeSummaryFromTweets(result.tweets);

  cachedData = {
    summary,
    posts,
    fetchedAt: Date.now(),
  };

  return cachedData;
}

export function clearSocialPulseCache(): void {
  cachedData = null;
  pendingSnapshotId = null;
}
