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
  aiCommentary: string | null;
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
    const res = await fetch('/api/x-api?q=solana', {
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

// Simple keyword-based sentiment analysis (1=very negative, 5=very positive)
function analyzeSentiment(text: string): number {
  const lower = text.toLowerCase();
  const bullishWords = [
    'bullish', 'moon', 'pump', 'ath', 'breakout', 'rally', 'surge', 'soaring',
    'amazing', 'incredible', 'love', 'great', 'best', 'huge', 'massive gains',
    'buy', 'accumulate', 'undervalued', 'gem', '🚀', '🔥', '💎', '📈',
    'adoption', 'partnership', 'launch', 'upgrade', 'growth', 'profitable',
  ];
  const bearishWords = [
    'bearish', 'dump', 'crash', 'scam', 'rug', 'sell', 'dead', 'rekt',
    'hack', 'exploit', 'vulnerability', 'down', 'fear', 'panic', 'warning',
    'overvalued', 'bubble', 'ponzi', 'fraud', 'broken', '📉', '💀', '🐻',
    'loss', 'losing', 'fail', 'failed', 'bankrupt', 'insolvent', 'fud',
  ];

  let score = 0;
  for (const word of bullishWords) {
    if (lower.includes(word)) score++;
  }
  for (const word of bearishWords) {
    if (lower.includes(word)) score--;
  }

  // Map score to 1-5 scale
  if (score >= 3) return 5;
  if (score >= 1) return 4;
  if (score <= -3) return 1;
  if (score <= -1) return 2;
  return 3; // neutral
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
      sentimentDetail: analyzeSentiment(t.text || ''),
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
  let sentimentSum = 0;
  const uniqueAuthors = new Set<string>();

  for (const t of tweets) {
    totalLikes += t.likes || 0;
    totalRetweets += t.retweets || 0;
    totalReplies += t.replies || 0;
    if (t.handle) uniqueAuthors.add(t.handle);
    sentimentSum += analyzeSentiment(t.text || '');
  }

  const totalInteractions = totalLikes + totalRetweets + totalReplies;
  const avgSentiment = tweets.length > 0 ? Math.round((sentimentSum / tweets.length) * 10) / 10 : 3;

  return {
    title: 'Solana',
    socialVolume24h: tweets.length,
    socialVolumePrev24h: 0, // No previous period data available from single API call
    socialDominance: 0, // Would need cross-topic comparison data
    sentiment: avgSentiment,
    interactions24h: totalInteractions,
    contributors24h: uniqueAuthors.size,
    postsCount24h: tweets.length,
  };
}

/* ------------------------------------------------------------------ */
/*  AI Commentary via Groq                                             */
/* ------------------------------------------------------------------ */

async function fetchAICommentary(tweets: NormalizedTweet[]): Promise<string | null> {
  if (tweets.length === 0) return null;

  // Build tweet summaries for the LLM — include author, followers, text snippet
  const headlines = tweets.slice(0, 15).map((t) => {
    const followStr = t.followers >= 1000 ? `${(t.followers / 1000).toFixed(1)}K` : String(t.followers);
    const engStr = `${t.likes}♥ ${t.retweets}🔁 ${t.views || 0}👀`;
    return `@${t.handle} (${followStr} followers) [${engStr}]: ${t.text.slice(0, 200)}`;
  });

  try {
    const res = await fetch('/api/summarize?provider=groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headlines,
        mode: 'social',
        variant: 'full',
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.summary || null;
  } catch (err) {
    console.warn('[SocialPulse] AI commentary failed:', err);
    return null;
  }
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

  // Fetch AI commentary in parallel (non-blocking for data display)
  const aiCommentary = await fetchAICommentary(result.tweets).catch(() => null);

  cachedData = {
    summary,
    posts,
    aiCommentary,
    fetchedAt: Date.now(),
  };

  return cachedData;
}

export function clearSocialPulseCache(): void {
  cachedData = null;
}
