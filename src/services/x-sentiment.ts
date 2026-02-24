/**
 * X/Twitter Sentiment Analysis Service
 *
 * Fetches tweets mentioning a Solana token CA and performs
 * keyword-based sentiment analysis with bot detection & duplicate filtering.
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
  botScore: number;        // 0 (human) to 1 (bot)
  isDuplicate: boolean;    // true if near-duplicate of another tweet
}

export interface SentimentReport {
  status: 'ready' | 'error' | 'no-data';
  mint: string;
  totalTweets: number;
  humanTweets: number;       // after bot filter
  botFiltered: number;       // removed by bot filter
  duplicatesRemoved: number; // collapsed duplicates
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  overallScore: number;      // -100 to +100
  overallLabel: SentimentLabel;
  avgFollowers: number;
  totalEngagement: number;   // likes + retweets + replies
  weightedScore: number;     // quality-weighted sentiment
  tweets: TweetSentiment[];  // all tweets (bot-flagged, not removed)
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
  'wash', 'manipulation', 'insider',
  '🔴', '💀', '☠️', '📉', '🚨', '⚠️', '🗑️', '❌',
];

/* ------------------------------------------------------------------ */
/*  Bot detection                                                      */
/* ------------------------------------------------------------------ */

/** Random-looking handle: mostly alpha + long digit suffix */
const RANDOM_HANDLE_RE = /^[A-Za-z]{2,10}\d{5,}$/;

/** Shill bot templates: CA-only or very short generic spam */
const SHILL_PATTERNS = [
  /^(buy|gem|next\s*100x|ape|don't miss|dyor)\b/i,
  /^.{0,20}(ca|contract)\s*[:=]?\s*[A-Za-z0-9]{32,}/i,
];

/**
 * Compute a bot probability score from 0 (likely human) to 1 (likely bot).
 */
function computeBotScore(tweet: CATweet): number {
  let score = 0;

  // 1. Low followers (< 50)
  if (tweet.followers < 50) score += 0.2;
  else if (tweet.followers < 200) score += 0.1;

  // 2. New account (< 30 days old)
  if (tweet.accountCreated) {
    const ageDays = (Date.now() - new Date(tweet.accountCreated).getTime()) / 86_400_000;
    if (ageDays < 14) score += 0.25;
    else if (ageDays < 30) score += 0.15;
    else if (ageDays < 90) score += 0.05;
  }

  // 3. Default avatar
  if (tweet.defaultAvatar) score += 0.15;

  // 4. Random handle pattern
  if (RANDOM_HANDLE_RE.test(tweet.handle)) score += 0.15;

  // 5. High tweet count but low followers → automated poster
  if (tweet.statusesCount > 5000 && tweet.followers < 100) score += 0.2;
  else if (tweet.statusesCount > 2000 && tweet.followers < 50) score += 0.15;

  // 6. Following/followers ratio anomaly
  if (tweet.following > 0 && tweet.followers > 0) {
    const ratio = tweet.following / tweet.followers;
    if (ratio > 20) score += 0.15; // follows 20x more than followers
  } else if (tweet.following > 500 && tweet.followers < 10) {
    score += 0.2;
  }

  // 7. Zero engagement on tweet
  const engagement = tweet.likes + tweet.retweets + tweet.replies;
  if (engagement === 0) score += 0.1;

  // 8. Shill template text
  const text = tweet.text.trim();
  for (const pat of SHILL_PATTERNS) {
    if (pat.test(text)) {
      score += 0.15;
      break;
    }
  }

  // 9. Very short tweet (< 40 chars) that's just CA + emoji
  if (text.length < 40) score += 0.1;

  // 10. Verified accounts get a big bonus (negative score)
  if (tweet.verified) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/* ------------------------------------------------------------------ */
/*  Duplicate detection (Jaccard on word sets)                         */
/* ------------------------------------------------------------------ */

function tokenize(text: string): Set<string> {
  // Remove CA-like strings (32+ alnum) and normalize
  const cleaned = text.toLowerCase()
    .replace(/[A-Za-z0-9]{32,}/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  return new Set(cleaned.split(/\s+/).filter(w => w.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Mark near-duplicate tweets (Jaccard > 0.75).
 *  The first occurrence (by engagement desc) is kept, later ones are flagged. */
function markDuplicates(tweets: TweetSentiment[]): number {
  let count = 0;
  const tokenSets: Set<string>[] = tweets.map(t => tokenize(t.tweet.text));

  for (let i = 0; i < tweets.length; i++) {
    const ti = tweets[i]!;
    if (ti.isDuplicate) continue;
    const setI = tokenSets[i]!;
    for (let j = i + 1; j < tweets.length; j++) {
      const tj = tweets[j]!;
      if (tj.isDuplicate) continue;
      if (jaccardSimilarity(setI, tokenSets[j]!) > 0.75) {
        tj.isDuplicate = true;
        count++;
      }
    }
  }
  return count;
}

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

  const botScore = computeBotScore(tweet);

  return { tweet, sentiment, score: normalizedScore, matchedKeywords: matched, botScore, isDuplicate: false };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Bot score threshold: tweets above this are excluded from sentiment calc */
const BOT_THRESHOLD = 0.6;

export async function fetchSentimentReport(mint: string): Promise<SentimentReport> {
  // Return cache if fresh
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const emptyReport = (status: 'error' | 'no-data', error?: string): SentimentReport => ({
    status,
    mint,
    totalTweets: 0,
    humanTweets: 0,
    botFiltered: 0,
    duplicatesRemoved: 0,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    overallScore: 0,
    overallLabel: 'neutral',
    avgFollowers: 0,
    totalEngagement: 0,
    weightedScore: 0,
    tweets: [],
    error,
    fetchedAt: Date.now(),
  });

  try {
    const tweetResult = await fetchCATweets(mint);

    if (tweetResult.status === 'error') {
      return emptyReport('error', tweetResult.error || 'Failed to fetch tweets');
    }

    if (!tweetResult.tweets || tweetResult.tweets.length === 0) {
      return emptyReport('no-data');
    }

    // Analyze each tweet (sentiment + bot score)
    const analyzed = tweetResult.tweets.map(t => analyzeTweetSentiment(t));

    // Sort by engagement desc first (so duplicate detection keeps the best one)
    analyzed.sort((a, b) => {
      const engA = a.tweet.likes + a.tweet.retweets * 2 + a.tweet.replies;
      const engB = b.tweet.likes + b.tweet.retweets * 2 + b.tweet.replies;
      return engB - engA;
    });

    // Mark near-duplicate tweets
    const duplicatesRemoved = markDuplicates(analyzed);

    // Split: quality tweets (human + non-duplicate) vs filtered
    const quality = analyzed.filter(t => t.botScore < BOT_THRESHOLD && !t.isDuplicate);
    const botFiltered = analyzed.filter(t => t.botScore >= BOT_THRESHOLD).length;

    const totalTweets = analyzed.length;
    const humanTweets = quality.length;

    // Sentiment counts (only from quality tweets)
    const bullishCount = quality.filter(t => t.sentiment === 'bullish').length;
    const bearishCount = quality.filter(t => t.sentiment === 'bearish').length;
    const neutralCount = quality.filter(t => t.sentiment === 'neutral').length;

    // Overall score from quality tweets: -100 to +100
    const rawScore = humanTweets > 0 ? ((bullishCount - bearishCount) / humanTweets) * 100 : 0;
    const overallScore = Math.round(rawScore);

    // Quality-weighted sentiment: engagement + follower tier + bot penalty
    let weightedSum = 0;
    let totalWeight = 0;
    for (const t of analyzed) {
      const engagement = t.tweet.likes + t.tweet.retweets * 2 + t.tweet.replies;

      // Follower tier multiplier
      let followerMult = 1;
      if (t.tweet.followers >= 10_000) followerMult = 3;
      else if (t.tweet.followers >= 1_000) followerMult = 2;
      else if (t.tweet.followers >= 500) followerMult = 1.5;

      // Verified bonus
      const verifiedMult = t.tweet.verified ? 1.5 : 1;

      // Bot penalty: reduce weight by bot probability
      const botPenalty = 1 - t.botScore;

      // Duplicate penalty
      const dupePenalty = t.isDuplicate ? 0.1 : 1;

      const weight = Math.max(0.1, engagement + 1) * followerMult * verifiedMult * botPenalty * dupePenalty;
      weightedSum += t.score * weight;
      totalWeight += weight;
    }
    const weightedScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;

    // Avg followers (quality tweets only)
    const avgFollowers = humanTweets > 0
      ? Math.round(quality.reduce((s, t) => s + t.tweet.followers, 0) / humanTweets)
      : 0;

    // Total engagement (all tweets)
    const totalEngagement = analyzed.reduce(
      (s, t) => s + t.tweet.likes + t.tweet.retweets + t.tweet.replies, 0
    );

    const overallLabel: SentimentLabel =
      overallScore > 15 ? 'bullish' :
      overallScore < -15 ? 'bearish' : 'neutral';

    const report: SentimentReport = {
      status: 'ready',
      mint,
      totalTweets,
      humanTweets,
      botFiltered,
      duplicatesRemoved,
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
    return emptyReport('error', 'Analysis failed');
  }
}

export function clearSentimentCache(mint: string): void {
  cache.delete(mint);
}
