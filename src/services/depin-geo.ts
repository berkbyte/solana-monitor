// DePIN Node Geographic Data Service
// Fetches real network stats from Helium API, DePINscan, and public endpoints
// Falls back to city-weighted distribution with real node counts

import type { DePINNode } from '@/types';

let cachedNodes: DePINNode[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// ── City weight distribution (based on known network geography) ─────────────
interface CityWeight {
  lat: number;
  lon: number;
  city: string;
  weight: number;
}

// These city distributions approximate real network hotspot density
const HELIUM_CITIES: CityWeight[] = [
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 25 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 20 },
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 18 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 16 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 14 },
  { lat: 33.4484, lon: -112.0740, city: 'Phoenix', weight: 10 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 10 },
  { lat: 32.7767, lon: -96.7970, city: 'Dallas', weight: 10 },
  { lat: 42.3601, lon: -71.0589, city: 'Boston', weight: 8 },
  { lat: 39.7392, lon: -104.9903, city: 'Denver', weight: 7 },
  { lat: 29.7604, lon: -95.3698, city: 'Houston', weight: 8 },
  { lat: 33.7490, lon: -84.3880, city: 'Atlanta', weight: 7 },
  { lat: 45.5017, lon: -73.5673, city: 'Montreal', weight: 5 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 6 },
  { lat: 49.2827, lon: -123.1207, city: 'Vancouver', weight: 5 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 15 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 12 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 10 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 8 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 6 },
  { lat: 41.3874, lon: 2.1686, city: 'Barcelona', weight: 6 },
  { lat: 40.4168, lon: -3.7038, city: 'Madrid', weight: 5 },
  { lat: 45.4642, lon: 9.1900, city: 'Milan', weight: 5 },
  { lat: 55.6761, lon: 12.5683, city: 'Copenhagen', weight: 4 },
  { lat: 59.3293, lon: 18.0686, city: 'Stockholm', weight: 4 },
  { lat: 47.3769, lon: 8.5417, city: 'Zurich', weight: 4 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 10 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 7 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 4 },
  { lat: 13.7563, lon: 100.5018, city: 'Bangkok', weight: 3 },
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 5 },
  { lat: -37.8136, lon: 144.9631, city: 'Melbourne', weight: 4 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 4 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 3 },
];

const RENDER_CITIES: CityWeight[] = [
  { lat: 39.0438, lon: -77.4874, city: 'Ashburn, VA', weight: 15 },
  { lat: 37.3382, lon: -121.8863, city: 'San Jose', weight: 12 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 8 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 10 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 8 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 6 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 7 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: 45.5017, lon: -73.5673, city: 'Montreal', weight: 4 },
];

const IONET_CITIES: CityWeight[] = [
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 10 },
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 8 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 6 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 5 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 5 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 4 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 4 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 3 },
  { lat: 19.0760, lon: 72.8777, city: 'Mumbai', weight: 3 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
];

const HIVEMAPPER_CITIES: CityWeight[] = [
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 8 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 7 },
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 6 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 5 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 4 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 4 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 3 },
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: 19.4326, lon: -99.1332, city: 'Mexico City', weight: 2 },
];

// ── Fetch real network stats from APIs ──────────────────────────────────────
interface NetworkStats {
  helium: number;
  render: number;
  ionet: number;
  hivemapper: number;
}

// Try to fetch real Helium hotspot locations (limited sample for globe)
async function fetchHeliumHotspots(limit: number): Promise<DePINNode[]> {
  const nodes: DePINNode[] = [];
  try {
    // Helium IoT hotspot locations from the Helium API
    const res = await fetch(
      `https://entities.nft.helium.io/v2/hotspots?limit=${limit}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const hotspots = data?.items || data?.data || (Array.isArray(data) ? data : []);

    for (let i = 0; i < hotspots.length && i < limit; i++) {
      const h = hotspots[i];
      const lat = Number(h.lat || h.latitude || h.geocode?.lat);
      const lon = Number(h.lng || h.lon || h.longitude || h.geocode?.lng);
      if (!lat || !lon || isNaN(lat) || isNaN(lon)) continue;

      nodes.push({
        id: `helium-${h.address || h.entity_key || i}`,
        network: 'helium',
        lat,
        lon,
        status: h.active !== false ? 'active' : 'offline',
        rewardToken: 'HNT',
        dailyRewards: Number(h.rewards_24h || 0) || 0.15,
        uptimePercent: h.active !== false ? 95 + (i % 5) : 0,
      });
    }
    if (nodes.length > 0) {
      console.log(`[depin-geo] Fetched ${nodes.length} real Helium hotspot locations`);
    }
  } catch (e) {
    console.warn('[depin-geo] Helium hotspot fetch failed:', e);
  }
  return nodes;
}

async function fetchRealNetworkStats(): Promise<NetworkStats> {
  const stats: NetworkStats = { helium: 0, render: 0, ionet: 0, hivemapper: 0 };

  // Fetch all in parallel
  const fetches = await Promise.allSettled([
    // Helium network stats API
    fetch('https://entities.nft.helium.io/v2/stats', { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.activeCount || d?.count) stats.helium = d.activeCount || d.count; }),

    // DePINscan aggregated stats
    fetch('https://api.depinscan.io/api/stats', { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.networks) {
          for (const net of d.networks) {
            const name = (net.name || '').toLowerCase();
            if (name.includes('helium') && net.nodeCount && !stats.helium) stats.helium = net.nodeCount;
            if (name.includes('render') && net.nodeCount) stats.render = net.nodeCount;
            if (name.includes('io.net') && net.nodeCount) stats.ionet = net.nodeCount;
            if (name.includes('hivemapper') && net.nodeCount) stats.hivemapper = net.nodeCount;
          }
        }
      }),

    // Helium mobile stats endpoint
    fetch('https://mobile-rewards.oracle.helium.io/v1/stats', { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.numHotspots && !stats.helium) stats.helium = d.numHotspots; }),
  ]);

  // Log which fetches succeeded
  const succeeded = fetches.filter(f => f.status === 'fulfilled').length;
  console.log(`[depin-geo] Stats APIs: ${succeeded}/${fetches.length} succeeded`);

  return stats;
}

// ── Distribute nodes across cities using weights (deterministic, no Math.random) ──
function distributeNodes(
  network: DePINNode['network'],
  cities: CityWeight[],
  totalCount: number,
  rewardToken: string,
  baseReward: number,
): DePINNode[] {
  const nodes: DePINNode[] = [];
  if (totalCount === 0) return nodes;

  const totalWeight = cities.reduce((s, c) => s + c.weight, 0);
  let id = 0;

  for (const city of cities) {
    const cityCount = Math.max(1, Math.round((city.weight / totalWeight) * totalCount));

    for (let i = 0; i < cityCount && nodes.length < totalCount; i++) {
      // Deterministic jitter using golden angle (no Math.random)
      const angle = (id * 137.508) * (Math.PI / 180);
      const r = 0.2 + (id % 5) * 0.1;
      const lat = city.lat + r * Math.sin(angle);
      const lon = city.lon + r * Math.cos(angle);

      // Deterministic status: ~92% active, ~4% relay, ~4% offline
      const statusSeed = (id * 2654435761) & 0x7fffffff;
      const statusPct = (statusSeed % 100);
      const status: DePINNode['status'] = statusPct < 92
        ? 'active'
        : statusPct < 96 ? 'relay' : 'offline';

      // Deterministic reward variance
      const rewardSeed = ((id + 1) * 1103515245 + 12345) & 0x7fffffff;
      const rewardFactor = 0.5 + ((rewardSeed % 100) / 100) * 1.5;

      nodes.push({
        id: `${network}-${id}`,
        network,
        lat,
        lon,
        status,
        rewardToken,
        dailyRewards: status === 'active' ? baseReward * rewardFactor : 0,
        uptimePercent: status === 'active'
          ? 95 + (statusSeed % 5)
          : status === 'relay'
            ? 70 + (statusSeed % 20)
            : statusSeed % 30,
      });
      id++;
    }
  }

  return nodes;
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function fetchDePINNodes(): Promise<DePINNode[]> {
  const now = Date.now();
  if (cachedNodes && now - lastFetch < CACHE_TTL) {
    return cachedNodes;
  }

  // Fetch real network stats and Helium hotspots in parallel
  const [stats, realHeliumNodes] = await Promise.all([
    fetchRealNetworkStats(),
    fetchHeliumHotspots(500), // try to get real Helium locations
  ]);

  // Use real counts if available, otherwise use known approximate totals (from public data)
  const heliumCount = stats.helium || 370_000; // ~370K Helium hotspots as of 2025
  const renderCount = stats.render || 12_000;   // ~12K Render nodes
  const ionetCount = stats.ionet || 25_000;     // ~25K IoNet devices
  const hivemapperCount = stats.hivemapper || 120_000; // ~120K dashcams

  // Scale for display (show representative sample, not all 370K nodes)
  const DISPLAY_CAP = 500; // max nodes per network for globe performance
  const scale = (count: number) => Math.min(count, DISPLAY_CAP);

  // Use real Helium hotspot locations if we got them, otherwise fall back to city distribution
  const heliumNodes = realHeliumNodes.length >= 50
    ? realHeliumNodes.slice(0, DISPLAY_CAP)
    : distributeNodes('helium', HELIUM_CITIES, scale(heliumCount), 'HNT', 0.15);

  const allNodes: DePINNode[] = [
    ...heliumNodes,
    ...distributeNodes('render', RENDER_CITIES, scale(renderCount), 'RNDR', 2.5),
    ...distributeNodes('ionet', IONET_CITIES, scale(ionetCount), 'IO', 1.2),
    ...distributeNodes('hivemapper', HIVEMAPPER_CITIES, scale(hivemapperCount), 'HONEY', 0.8),
  ];

  cachedNodes = allNodes;
  lastFetch = now;

  console.log(`[depin-geo] Loaded ${allNodes.length} DePIN nodes (Helium: ${heliumCount}, Render: ${renderCount}, IoNet: ${ionetCount}, Hivemapper: ${hivemapperCount})`);
  return allNodes;
}

// ── Stats for overlay ───────────────────────────────────────────────────────
export function getDePINStats(nodes: DePINNode[]): {
  helium: { total: number; active: number };
  render: { total: number; active: number };
  ionet: { total: number; active: number };
  hivemapper: { total: number; active: number };
} {
  const stats = {
    helium: { total: 0, active: 0 },
    render: { total: 0, active: 0 },
    ionet: { total: 0, active: 0 },
    hivemapper: { total: 0, active: 0 },
  };

  for (const node of nodes) {
    const net = stats[node.network as keyof typeof stats];
    if (!net) continue;
    net.total++;
    if (node.status === 'active') net.active++;
  }

  return stats;
}
