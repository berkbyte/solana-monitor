// X/Twitter Keyword Search — SocialData.tools API
// General-purpose X search (any keyword/phrase)
// Env vars: SOCIALDATA_API_KEY

import { corsHeaders } from './_cors.js';

const API_KEY = process.env.SOCIALDATA_API_KEY;
const SD_BASE = 'https://api.socialdata.tools/twitter';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (!API_KEY) {
    return res.status(503).json({ error: 'X search not configured — SOCIALDATA_API_KEY missing' });
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const q = searchParams.get('q');

  if (!q) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    // SocialData search is synchronous — no polling needed
    const query = encodeURIComponent(q);
    const searchRes = await fetch(`${SD_BASE}/search?query=${query}&type=Latest`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error('[x-search] SocialData search failed:', searchRes.status, errText);
      if (searchRes.status === 402) {
        return res.status(503).json({ error: 'SocialData credits exhausted' });
      }
      return res.status(502).json({ error: 'Search failed' });
    }

    const searchData = await searchRes.json();
    const rawTweets = searchData.tweets || [];

    const tweets = rawTweets.slice(0, 30).map((t) => ({
      id: t.id_str || String(t.id || ''),
      text: (t.full_text || t.text || '').slice(0, 500),
      author: t.user?.name || 'Unknown',
      handle: t.user?.screen_name || '',
      avatar: t.user?.profile_image_url_https || '',
      followers: t.user?.followers_count || 0,
      likes: t.favorite_count || 0,
      retweets: t.retweet_count || 0,
      replies: t.reply_count || 0,
      views: t.views_count || 0,
      date: t.tweet_created_at || t.created_at || '',
      url: t.user?.screen_name
        ? `https://x.com/${t.user.screen_name}/status/${t.id_str || t.id}`
        : '',
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=60');
    return res.status(200).json({ status: 'ready', tweets });
  } catch (err) {
    console.error('[x-search] Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
