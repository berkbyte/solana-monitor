// DePIN Node Geographic Data Service
// Provides realistic DePIN node locations for Helium, Render, IoNet, Hivemapper
// Used by the globe's DePIN layer mode

import type { DePINNode } from '@/types';

let cachedNodes: DePINNode[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// ── Hotspot distribution based on real network data ─────────────────────────
interface CityWeight {
  lat: number;
  lon: number;
  city: string;
  weight: number; // relative density
}

// Helium hotspots are heavily concentrated in NA/EU urban areas
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
  // Europe
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
  // Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 10 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 7 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 4 },
  { lat: 13.7563, lon: 100.5018, city: 'Bangkok', weight: 3 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 5 },
  { lat: -37.8136, lon: 144.9631, city: 'Melbourne', weight: 4 },
  // South America
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 4 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 3 },
];

// Render GPU nodes — concentrated in render farm regions
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

// IoNet distributed compute nodes
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

// Hivemapper dashcam coverage
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

// ── Generate nodes with jitter from city coordinates ────────────────────────
function generateNodes(
  network: DePINNode['network'],
  cities: CityWeight[],
  rewardToken: string,
  baseReward: number,
): DePINNode[] {
  const nodes: DePINNode[] = [];
  let id = 0;

  for (const city of cities) {
    for (let i = 0; i < city.weight; i++) {
      const angle = (id * 137.508) * (Math.PI / 180);
      const r = 0.2 + Math.random() * 0.5;
      const lat = city.lat + r * Math.sin(angle);
      const lon = city.lon + r * Math.cos(angle);

      const status: DePINNode['status'] = Math.random() < 0.92
        ? 'active'
        : Math.random() < 0.5 ? 'relay' : 'offline';

      nodes.push({
        id: `${network}-${id}`,
        network,
        lat,
        lon,
        status,
        rewardToken,
        dailyRewards: status === 'active'
          ? baseReward * (0.5 + Math.random() * 1.5)
          : 0,
        uptimePercent: status === 'active'
          ? 95 + Math.random() * 5
          : status === 'relay'
            ? 70 + Math.random() * 20
            : Math.random() * 30,
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

  // In a production app, these would be fetched from various APIs
  // (Helium Explorer, Render Network, IoNet dashboard, etc.)
  // For now, generate realistic distribution based on known network data
  const allNodes: DePINNode[] = [
    ...generateNodes('helium', HELIUM_CITIES, 'HNT', 0.15),
    ...generateNodes('render', RENDER_CITIES, 'RNDR', 2.5),
    ...generateNodes('ionet', IONET_CITIES, 'IO', 1.2),
    ...generateNodes('hivemapper', HIVEMAPPER_CITIES, 'HONEY', 0.8),
  ];

  cachedNodes = allNodes;
  lastFetch = now;

  console.log(`[depin-geo] Generated ${allNodes.length} DePIN nodes`);
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
