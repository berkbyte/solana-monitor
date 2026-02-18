// X/Twitter Keyword Search — Bright Data Web Scraper API
// General-purpose X search (not just CA — any keyword/phrase)
// Env vars: BRIGHTDATA_API_KEY

import { corsHeaders } from './_cors.js';

const API_KEY = process.env.BRIGHTDATA_API_KEY;
const BD_BASE = 'https://api.brightdata.com/datasets/v3';
const DATASET_ID = 'gd_lwdb4vjm1ehrp8b98v'; // Twitter/X Search Posts

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (!API_KEY) {
    return res.status(503).json({ error: 'X search not configured' });
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const q = searchParams.get('q');
  const snapshotId = searchParams.get('snapshot_id');

  if (!q) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    // Poll phase — check existing snapshot
    if (snapshotId) {
      const result = await checkAndDownload(snapshotId);
      if (result.status === 'ready') {
        res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=60');
      }
      return res.status(result.httpStatus).json(result.body);
    }

    // Trigger new scrape
    const triggerRes = await fetch(`${BD_BASE}/trigger?dataset_id=${DATASET_ID}&include_errors=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ keyword: q }]),
    });

    if (!triggerRes.ok) {
      console.error('[x-search] Bright Data trigger failed:', await triggerRes.text());
      return res.status(502).json({ error: 'Search trigger failed' });
    }

    const triggerData = await triggerRes.json();
    const snapId = triggerData.snapshot_id;

    if (!snapId) {
      return res.status(502).json({ error: 'No snapshot_id returned' });
    }

    // Poll for up to ~8 seconds
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const progressRes = await fetch(`${BD_BASE}/progress/${snapId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });

      if (progressRes.ok) {
        const progress = await progressRes.json();
        if (progress.status === 'ready') {
          const data = await downloadSnapshot(snapId);
          res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=60');
          return res.status(200).json(data);
        }
        if (progress.status === 'failed') {
          return res.status(502).json({ error: 'Scrape failed', status: 'failed' });
        }
      }
    }

    // Not ready yet
    return res.status(202).json({ status: 'pending', snapshot_id: snapId });
  } catch (err) {
    console.error('[x-search] Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function checkAndDownload(snapshotId) {
  try {
    const progressRes = await fetch(`${BD_BASE}/progress/${snapshotId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!progressRes.ok) {
      return { httpStatus: 502, body: { error: 'Progress check failed' } };
    }

    const progress = await progressRes.json();

    if (progress.status === 'ready') {
      const data = await downloadSnapshot(snapshotId);
      return { httpStatus: 200, status: 'ready', body: data };
    }

    if (progress.status === 'failed') {
      return { httpStatus: 502, body: { error: 'Scrape failed', status: 'failed' } };
    }

    return { httpStatus: 202, body: { status: 'pending', snapshot_id: snapshotId } };
  } catch {
    return { httpStatus: 502, body: { error: 'Progress check error' } };
  }
}

async function downloadSnapshot(snapshotId) {
  const dataRes = await fetch(`${BD_BASE}/snapshot/${snapshotId}?format=json`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!dataRes.ok) {
    return { status: 'ready', tweets: [] };
  }

  const raw = await dataRes.json();
  const items = Array.isArray(raw) ? raw : [];

  const tweets = items.slice(0, 30).map((t) => ({
    id: String(t.id || t.post_id || t.tweet_id || ''),
    text: (t.text || t.description || t.content || t.body || '').slice(0, 500),
    author: t.user_name || t.author_name || t.name || 'Unknown',
    handle: t.user_screen_name || t.user_handle || t.screen_name || '',
    avatar: t.user_profile_image || t.avatar || '',
    followers: t.user_followers || t.followers_count || 0,
    likes: t.likes || t.favorite_count || 0,
    retweets: t.retweets || t.retweet_count || 0,
    replies: t.replies || t.reply_count || 0,
    date: t.date || t.timestamp || t.created_at || '',
    url: t.url || t.tweet_url || t.post_url || '',
  }));

  return { status: 'ready', tweets };
}
