// Helium Hotspot Proxy — fetches real IoT & Mobile hotspot locations
// Paginates through entities.nft.helium.io to get 50K+ coordinates
// Heavy endpoint — cache aggressively (10 min s-maxage)

import { corsHeaders } from './_cors.js';

const HELIUM_API = 'https://entities.nft.helium.io/v2/hotspots';
const IOT_PAGES = 3;    // 3 × 10K = ~30K IoT (reduced for Vercel timeout)
const MOBILE_PAGES = 2;  // 2 × 10K = ~20K Mobile

async function fetchPages(subnetwork, maxPages) {
  const allItems = [];
  let cursor = null;
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const url = cursor
      ? `${HELIUM_API}?subnetwork=${subnetwork}&limit=10000&cursor=${encodeURIComponent(cursor)}`
      : `${HELIUM_API}?subnetwork=${subnetwork}&limit=10000`;

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const items = d.items || [];
      allItems.push(...items);
      cursor = d.cursor || null;
      hasMore = !!cursor;
    } catch (e) {
      console.warn(`[helium-hotspots] ${subnetwork} page ${page + 1} failed: ${e.message}`);
      break;
    }
  }

  return allItems;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const [iotItems, mobileItems] = await Promise.all([
      fetchPages('iot', IOT_PAGES),
      fetchPages('mobile', MOBILE_PAGES),
    ]);

    const iot = iotItems
      .filter((h) => h.lat && h.long)
      .map((h) => ({ lat: h.lat, lon: h.long, active: h.is_active, key: (h.entity_key_str || '').slice(0, 12) }));

    const mobile = mobileItems
      .filter((h) => h.lat && h.long)
      .map((h) => ({ lat: h.lat, lon: h.long, active: h.is_active, key: (h.entity_key_str || '').slice(0, 12) }));

    const result = {
      iot,
      mobile,
      totalIot: 400000,
      totalMobile: 50000,
    };

    console.log(`[helium-hotspots] ✅ IoT: ${iot.length}, Mobile: ${mobile.length}`);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[helium-hotspots] Error:', err);
    return res.status(502).json({ iot: [], mobile: [], totalIot: 0, totalMobile: 0 });
  }
}
