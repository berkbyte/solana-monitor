/**
 * Social Pulse Service — SocialData.tools Integration
 *
 * Fetches Solana-related social media data from X/Twitter
 * via the /api/x-search SocialData serverless endpoint.
 *
 * No API key needed on the frontend — the serverless function
 * uses SOCIALDATA_API_KEY on the backend.
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

/* ------------------------------------------------------------------ */
/*  Normalized tweet from /api/x-search                                */
/* ------------------------------------------------------------------ */

interface NormalizedTweet {
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

async function fetchSolanaTweets(): Promise<{ tweets: NormalizedTweet[]; status: string }> {
  try {
    const res = await fetch('/api/x-search?q=solana', {
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (res.ok && data.status === 'ready') {
      return { tweets: data.tweets || [], status: 'ready' };
    }

    return { tweets: [], status: 'error' };
  } catch (err) {
    console.warn('[SocialPulse] Fetch error:', err);
    return { tweets: [], status: 'error' };
  }
}

function tweetsToSocialPosts(tweets: NormalizedTweet[]): SocialPost[] {
  return tweets.slice(0, 15).map((t): SocialPost => {
    const interactions = (t.likes || 0) + (t.retweets || 0) + (t.replies || 0);
    const dateStr = t.date || '';
    const ts = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0;

    return {
      id: t.id || String(Math.random()),
      text: (t.text || '').slice(0, 280),
      creator: t.handle || 'unknown',
      creatorDisplayName: t.author || 'Unknown',
      creatorFollowers: t.followers || 0,
      creatorProfileImage: t.avatar || '',
      interactions,
      sentimentDetail: 3, // neutral default — no sentiment analysis
      postCreated: ts,
      postUrl: t.url || '',
      network: 'twitter',
    };
  });
}

function computeSummaryFromTweets(tweets: NormalizedTweet[]): SocialTopicSummary | null {
  if (tweets.length === 0) return null;

  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  const uniqueAuthors = new Set<string>();

  for (const t of tweets) {
    totalLikes += t.likes || 0;
    totalRetweets += t.retweets || 0;
    totalReplies += t.replies || 0;
    if (t.handle) uniqueAuthors.add(t.handle);
  }

  const totalInteractions = totalLikes + totalRetweets + totalReplies;

  return {
    title: 'Solana',
    socialVolume24h: tweets.length,
    socialVolumePrev24h: 0,
    socialDominance: 0,
    sentiment: 3,
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
}
