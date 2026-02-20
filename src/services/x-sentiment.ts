/**
 * X/Twitter Sentiment Analysis Service
 *
 * Fetches tweets mentioning a Solana token CA and performs
 * keyword-based sentiment analysis to generate a sentiment report.
 */

import { fetchCATweets, type CATweet } from './twitter-ca-search';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SentimentLabel = 'bullish' | 'bearish' | 'neutral';

export interface TweetSentiment {
  tweet: CATweet;
  sentiment: SentimentLabel;
  score: number;           // -1 to +1
  matchedKeywords: string[];
}

export interface SentimentReport {
  status: 'ready' | 'error' | 'no-data';
  mint: string;
  totalTweets: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  overallScore: number;     // -100 to +100
  overallLabel: SentimentLabel;
  avgFollowers: number;
  totalEngagement: number;  // likes + retweets + replies
  weightedScore: number;    // engagement-weighted sentiment
  tweets: TweetSentiment[];
  error?: string;
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Keyword dictionaries                                               */
/* ------------------------------------------------------------------ */

const BULLISH_KEYWORDS = [
  'buy', 'bullish', 'moon', 'pump', 'gem', 'ape', 'long', '100x', '1000x',
  'breakout', 'undervalued', 'accumulate', 'hodl', 'strong', 'rally', 'green',
  'profit', 'fire', 'rocket', 'diamond', 'hands', 'degen', 'alpha', 'early',
  'next', 'huge', 'massive', 'insane', 'flying', 'send', 'sending', 'bags',
  'load', 'loading', 'loaded', 'bruh', 'letsgo', 'lfg', 'wagmi',
  'bullrun', 'bull run', 'good entry', 'easy money', 'to the moon',
  '🚀', '🔥', '💎', '🙌', '📈', '💰', '🤑', '✅', '🟢',
];

const BEARISH_KEYWORDS = [
  'sell', 'bearish', 'dump', 'rug', 'scam', 'short', 'avoid', 'crash',
  'drop', 'exit', 'ponzi', 'honeypot', 'fake', 'dead', 'rekt', 'wreck',
  'fraud', 'warning', 'danger', 'red flag', 'rugpull', 'rug pull',
  'stay away', 'dont buy', "don't buy", 'overvalued', 'bubble', 'ngmi',
  'cope', 'copium', 'bag holder', 'painful', 'bleeding', 'drain',
  'bot', 'bots', 'wash', 'manipulation', 'insider',
  '🔴', '💀', '☠️', '📉', '🚨', '⚠️', '🗑️', '❌',
];

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

const CACHE_TTL = 5 * 60_000;
const cache = new Map<string, { data: SentimentReport; ts: number }>();

/* ------------------------------------------------------------------ */
/*  Sentiment engine                                                   */
/* ------------------------------------------------------------------ */

function analyzeTweetSentiment(tweet: CATweet): TweetSentiment {
  const text = tweet.text.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      score += 1;
      matched.push('+' + kw);
    }
  }

  for (const kw of BEARISH_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      score -= 1;
      matched.push('-' + kw);
    }
  }

  // Normalize
  const normalizedScore = score === 0 ? 0 : Math.max(-1, Math.min(1, score / 3));
  const sentiment: SentimentLabel =
    normalizedScore > 0.1 ? 'bullish' :
    normalizedScore < -0.1 ? 'bearish' : 'neutral';

  return { tweet, sentiment, score: normalizedScore, matchedKeywords: matched };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function fetchSentimentReport(mint: string): Promise<SentimentReport> {
  // Return cache if fresh
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const tweetResult = await fetchCATweets(mint);

    if (tweetResult.status === 'error') {
      return {
        status: 'error',
        mint,
        totalTweets: 0,
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        overallScore: 0,
        overallLabel: 'neutral',
        avgFollowers: 0,
        totalEngagement: 0,
        weightedScore: 0,
        tweets: [],
        error: tweetResult.error || 'Failed to fetch tweets',
        fetchedAt: Date.now(),
      };
    }

    if (!tweetResult.tweets || tweetResult.tweets.length === 0) {
      return {
        status: 'no-data',
        mint,
        totalTweets: 0,
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        overallScore: 0,
        overallLabel: 'neutral',
        avgFollowers: 0,
        totalEngagement: 0,
        weightedScore: 0,
        tweets: [],
        fetchedAt: Date.now(),
      };
    }

    // Analyze each tweet
    const analyzed = tweetResult.tweets.map(t => analyzeTweetSentiment(t));

    const bullishCount = analyzed.filter(t => t.sentiment === 'bullish').length;
    const bearishCount = analyzed.filter(t => t.sentiment === 'bearish').length;
    const neutralCount = analyzed.filter(t => t.sentiment === 'neutral').length;
    const totalTweets = analyzed.length;

    // Simple overall score: -100 to +100
    const rawScore = totalTweets > 0 ? ((bullishCount - bearishCount) / totalTweets) * 100 : 0;
    const overallScore = Math.round(rawScore);

    // Engagement-weighted sentiment score
    let weightedSum = 0;
    let totalWeight = 0;
    for (const t of analyzed) {
      const engagement = t.tweet.likes + t.tweet.retweets * 2 + t.tweet.replies;
      const weight = Math.max(1, engagement);
      weightedSum += t.score * weight;
      totalWeight += weight;
    }
    const weightedScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;

    const avgFollowers = totalTweets > 0
      ? Math.round(analyzed.reduce((s, t) => s + t.tweet.followers, 0) / totalTweets)
      : 0;

    const totalEngagement = analyzed.reduce(
      (s, t) => s + t.tweet.likes + t.tweet.retweets + t.tweet.replies, 0
    );

    const overallLabel: SentimentLabel =
      overallScore > 15 ? 'bullish' :
      overallScore < -15 ? 'bearish' : 'neutral';

    // Sort: most engaged tweets first
    analyzed.sort((a, b) => {
      const engA = a.tweet.likes + a.tweet.retweets + a.tweet.replies;
      const engB = b.tweet.likes + b.tweet.retweets + b.tweet.replies;
      return engB - engA;
    });

    const report: SentimentReport = {
      status: 'ready',
      mint,
      totalTweets,
      bullishCount,
      bearishCount,
      neutralCount,
      overallScore,
      overallLabel,
      avgFollowers,
      totalEngagement,
      weightedScore,
      tweets: analyzed,
      fetchedAt: Date.now(),
    };

    cache.set(mint, { data: report, ts: Date.now() });
    return report;
  } catch (err) {
    console.error('[XSentiment] Error:', err);
    return {
      status: 'error',
      mint,
      totalTweets: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      overallScore: 0,
      overallLabel: 'neutral',
      avgFollowers: 0,
      totalEngagement: 0,
      weightedScore: 0,
      tweets: [],
      error: 'Analysis failed',
      fetchedAt: Date.now(),
    };
  }
}

export function clearSentimentCache(mint: string): void {
  cache.delete(mint);
}
