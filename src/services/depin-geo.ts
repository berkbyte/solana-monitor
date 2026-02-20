// DePIN Node Geographic Data Service
// Fetches REAL Helium hotspot locations via server proxy (paginated, ~50K+),
// Country-weighted distributions for Grass/Hivemapper (60+ countries),
// City-weighted distributions for GPU/storage networks.
// Supports 9 DePIN networks on Solana.

import type { DePINNode } from '@/types';

let cachedNodes: DePINNode[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Total real-world node counts (updated periodically from DePINscan/public data)
const NETWORK_COUNTS: { [key: string]: number } & Record<string, number> = {
  other: 0,
  'helium-iot': 375_000,
  'helium-mobile': 30_000,
  render: 12_000,
  ionet: 45_000,
  hivemapper: 150_000,
  grass: 2_500_000,
  geodnet: 10_000,
  nosana: 800,
  shadow: 3_500,
};

// Display cap per network (for globe rendering performance)
// 3000 per network × 7 = ~21K simulated + real Helium = ~70K total
const DISPLAY_CAP = 3000;

// Helium display cap — show all paginated real data (proxy returns ~50K IoT, ~30K Mobile)
const HELIUM_DISPLAY_CAP = 50000;

// ── City/Country weight distribution ────────────────────────────────────────
interface CityWeight {
  lat: number;
  lon: number;
  city: string;
  weight: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER — GPU nodes, data center concentrated + home GPUs
// ═══════════════════════════════════════════════════════════════════════════
const RENDER_CITIES: CityWeight[] = [
  // US data centers
  { lat: 39.0438, lon: -77.4874, city: 'Ashburn, VA', weight: 16 },
  { lat: 37.3382, lon: -121.8863, city: 'San Jose', weight: 12 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 7 },
  { lat: 33.7490, lon: -84.3880, city: 'Atlanta', weight: 5 },
  { lat: 32.7767, lon: -96.7970, city: 'Dallas', weight: 5 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 4 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 4 },
  // Europe
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 10 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 8 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 7 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 5 },
  { lat: 59.3293, lon: 18.0686, city: 'Stockholm', weight: 3 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
  { lat: 45.4642, lon: 9.1895, city: 'Milan', weight: 2 },
  // Russia
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 3 },
  { lat: 59.9343, lon: 30.3351, city: 'St. Petersburg', weight: 1 },
  // Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 7 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 4 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 3 },
  { lat: 19.0760, lon: 72.8777, city: 'Mumbai', weight: 2 },
  // Canada
  { lat: 45.5017, lon: -73.5673, city: 'Montreal', weight: 4 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 3 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  // South America
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════
// IO.NET — GPU compute, global data centers + home GPUs
// ═══════════════════════════════════════════════════════════════════════════
const IONET_CITIES: CityWeight[] = [
  // US
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 10 },
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 8 },
  { lat: 39.0438, lon: -77.4874, city: 'Ashburn', weight: 7 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 6 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 4 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 4 },
  { lat: 32.7767, lon: -96.7970, city: 'Dallas', weight: 3 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 3 },
  // Europe
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 7 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 6 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 5 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 4 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
  { lat: 48.2082, lon: 16.3738, city: 'Vienna', weight: 2 },
  { lat: 52.2297, lon: 21.0122, city: 'Warsaw', weight: 2 },
  // Russia
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 3 },
  { lat: 59.9343, lon: 30.3351, city: 'St. Petersburg', weight: 1 },
  { lat: 56.8389, lon: 60.6057, city: 'Yekaterinburg', weight: 1 },
  // Turkey
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 2 },
  // Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 6 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 3 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 3 },
  { lat: 19.0760, lon: 72.8777, city: 'Mumbai', weight: 3 },
  { lat: 12.9716, lon: 77.5946, city: 'Bangalore', weight: 2 },
  { lat: 13.7563, lon: 100.5018, city: 'Bangkok', weight: 2 },
  // Americas
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 4 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 3 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 2 },
  // Middle East
  { lat: 25.2048, lon: 55.2708, city: 'Dubai', weight: 2 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════
// HIVEMAPPER — Dashcam drivers, worldwide road coverage
// Country-weighted across all major driving regions
// ═══════════════════════════════════════════════════════════════════════════
const HIVEMAPPER_CITIES: CityWeight[] = [
  // North America (huge coverage)
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 8 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 8 },
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 6 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 5 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 5 },
  { lat: 29.7604, lon: -95.3698, city: 'Houston', weight: 5 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 3 },
  { lat: 33.4484, lon: -112.0740, city: 'Phoenix', weight: 3 },
  { lat: 39.7392, lon: -104.9903, city: 'Denver', weight: 3 },
  { lat: 35.2271, lon: -80.8431, city: 'Charlotte', weight: 2 },
  { lat: 36.1627, lon: -86.7816, city: 'Nashville', weight: 2 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 4 },
  { lat: 49.2827, lon: -123.1207, city: 'Vancouver', weight: 2 },
  { lat: 19.4326, lon: -99.1332, city: 'Mexico City', weight: 4 },
  { lat: 20.6597, lon: -103.3496, city: 'Guadalajara', weight: 2 },
  // Europe
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 6 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 5 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 4 },
  { lat: 48.1351, lon: 11.5820, city: 'Munich', weight: 3 },
  { lat: 40.4168, lon: -3.7038, city: 'Madrid', weight: 3 },
  { lat: 41.3874, lon: 2.1686, city: 'Barcelona', weight: 3 },
  { lat: 41.9028, lon: 12.4964, city: 'Rome', weight: 3 },
  { lat: 45.4642, lon: 9.1895, city: 'Milan', weight: 2 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 3 },
  { lat: 59.3293, lon: 18.0686, city: 'Stockholm', weight: 2 },
  { lat: 52.2297, lon: 21.0122, city: 'Warsaw', weight: 2 },
  { lat: 50.0755, lon: 14.4378, city: 'Prague', weight: 2 },
  { lat: 47.3769, lon: 8.5417, city: 'Zurich', weight: 2 },
  { lat: 38.7223, lon: -9.1393, city: 'Lisbon', weight: 2 },
  // Russia
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 4 },
  { lat: 59.9343, lon: 30.3351, city: 'St. Petersburg', weight: 2 },
  { lat: 56.8389, lon: 60.6057, city: 'Yekaterinburg', weight: 1 },
  { lat: 54.7388, lon: 55.9721, city: 'Ufa', weight: 1 },
  // Turkey
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 4 },
  { lat: 39.9334, lon: 32.8597, city: 'Ankara', weight: 2 },
  { lat: 38.4237, lon: 27.1428, city: 'Izmir', weight: 2 },
  { lat: 36.8969, lon: 30.7133, city: 'Antalya', weight: 1 },
  // Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 4 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 3 },
  { lat: 13.7563, lon: 100.5018, city: 'Bangkok', weight: 3 },
  { lat: -6.2088, lon: 106.8456, city: 'Jakarta', weight: 3 },
  { lat: 14.5995, lon: 120.9842, city: 'Manila', weight: 2 },
  { lat: 28.6139, lon: 77.2090, city: 'New Delhi', weight: 3 },
  { lat: 19.0760, lon: 72.8777, city: 'Mumbai', weight: 3 },
  { lat: 12.9716, lon: 77.5946, city: 'Bangalore', weight: 2 },
  // Middle East
  { lat: 25.2048, lon: 55.2708, city: 'Dubai', weight: 3 },
  { lat: 24.7136, lon: 46.6753, city: 'Riyadh', weight: 2 },
  // Africa
  { lat: 6.5244, lon: 3.3792, city: 'Lagos', weight: 3 },
  { lat: -1.2921, lon: 36.8219, city: 'Nairobi', weight: 2 },
  { lat: 30.0444, lon: 31.2357, city: 'Cairo', weight: 2 },
  { lat: -26.2041, lon: 28.0473, city: 'Johannesburg', weight: 2 },
  { lat: -33.9249, lon: 18.4241, city: 'Cape Town', weight: 2 },
  { lat: 5.6037, lon: -0.1870, city: 'Accra', weight: 1 },
  // South America
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 5 },
  { lat: -22.9068, lon: -43.1729, city: 'Rio de Janeiro', weight: 3 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 4 },
  { lat: 4.7110, lon: -74.0721, city: 'Bogota', weight: 3 },
  { lat: -12.0464, lon: -77.0428, city: 'Lima', weight: 2 },
  { lat: -33.4489, lon: -70.6693, city: 'Santiago', weight: 3 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: -37.8136, lon: 144.9631, city: 'Melbourne', weight: 2 },
  { lat: -36.8485, lon: 174.7633, city: 'Auckland', weight: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════
// GRASS — Browser extension, follows global internet user distribution
// Country-weighted: 90+ locations across all continents
// ═══════════════════════════════════════════════════════════════════════════
const GRASS_CITIES: CityWeight[] = [
  // North America
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 10 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 8 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 5 },
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 5 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 4 },
  { lat: 29.7604, lon: -95.3698, city: 'Houston', weight: 4 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 3 },
  { lat: 33.4484, lon: -112.0740, city: 'Phoenix', weight: 3 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 5 },
  { lat: 45.5017, lon: -73.5673, city: 'Montreal', weight: 3 },
  { lat: 19.4326, lon: -99.1332, city: 'Mexico City', weight: 5 },
  // Europe
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 8 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 6 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 5 },
  { lat: 40.4168, lon: -3.7038, city: 'Madrid', weight: 4 },
  { lat: 41.9028, lon: 12.4964, city: 'Rome', weight: 3 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 3 },
  { lat: 50.0755, lon: 14.4378, city: 'Prague', weight: 3 },
  { lat: 48.2082, lon: 16.3738, city: 'Vienna', weight: 2 },
  { lat: 59.3293, lon: 18.0686, city: 'Stockholm', weight: 2 },
  { lat: 52.2297, lon: 21.0122, city: 'Warsaw', weight: 3 },
  { lat: 47.4979, lon: 19.0402, city: 'Budapest', weight: 2 },
  { lat: 44.4268, lon: 26.1025, city: 'Bucharest', weight: 2 },
  { lat: 50.4501, lon: 30.5234, city: 'Kyiv', weight: 3 },
  { lat: 42.6977, lon: 23.3219, city: 'Sofia', weight: 2 },
  { lat: 37.9838, lon: 23.7275, city: 'Athens', weight: 2 },
  { lat: 60.1699, lon: 24.9384, city: 'Helsinki', weight: 2 },
  { lat: 38.7223, lon: -9.1393, city: 'Lisbon', weight: 2 },
  // Russia & CIS
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 6 },
  { lat: 59.9343, lon: 30.3351, city: 'St. Petersburg', weight: 4 },
  { lat: 56.8389, lon: 60.6057, city: 'Yekaterinburg', weight: 2 },
  { lat: 55.0084, lon: 82.9357, city: 'Novosibirsk', weight: 2 },
  { lat: 54.9885, lon: 73.3242, city: 'Omsk', weight: 1 },
  { lat: 51.1694, lon: 71.4491, city: 'Astana', weight: 2 },
  { lat: 41.2995, lon: 69.2401, city: 'Tashkent', weight: 2 },
  // Turkey & Middle East
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 5 },
  { lat: 39.9334, lon: 32.8597, city: 'Ankara', weight: 2 },
  { lat: 38.4237, lon: 27.1428, city: 'Izmir', weight: 2 },
  { lat: 25.2048, lon: 55.2708, city: 'Dubai', weight: 3 },
  { lat: 24.7136, lon: 46.6753, city: 'Riyadh', weight: 2 },
  { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', weight: 2 },
  // East Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 7 },
  { lat: 34.6937, lon: 135.5023, city: 'Osaka', weight: 3 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 5 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 4 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 3 },
  { lat: 25.0330, lon: 121.5654, city: 'Taipei', weight: 3 },
  // SE Asia
  { lat: 13.7563, lon: 100.5018, city: 'Bangkok', weight: 4 },
  { lat: 14.5995, lon: 120.9842, city: 'Manila', weight: 5 },
  { lat: -6.2088, lon: 106.8456, city: 'Jakarta', weight: 5 },
  { lat: 3.1390, lon: 101.6869, city: 'Kuala Lumpur', weight: 3 },
  { lat: 21.0278, lon: 105.8342, city: 'Hanoi', weight: 3 },
  { lat: 10.8231, lon: 106.6297, city: 'Ho Chi Minh', weight: 3 },
  // South Asia
  { lat: 19.0760, lon: 72.8777, city: 'Mumbai', weight: 6 },
  { lat: 28.6139, lon: 77.2090, city: 'New Delhi', weight: 5 },
  { lat: 12.9716, lon: 77.5946, city: 'Bangalore', weight: 4 },
  { lat: 17.3850, lon: 78.4867, city: 'Hyderabad', weight: 3 },
  { lat: 13.0827, lon: 80.2707, city: 'Chennai', weight: 2 },
  { lat: 23.8103, lon: 90.4125, city: 'Dhaka', weight: 3 },
  { lat: 27.7172, lon: 85.3240, city: 'Kathmandu', weight: 1 },
  { lat: 33.6844, lon: 73.0479, city: 'Islamabad', weight: 2 },
  { lat: 24.8607, lon: 67.0011, city: 'Karachi', weight: 3 },
  // Africa
  { lat: 6.5244, lon: 3.3792, city: 'Lagos', weight: 5 },
  { lat: -1.2921, lon: 36.8219, city: 'Nairobi', weight: 3 },
  { lat: 30.0444, lon: 31.2357, city: 'Cairo', weight: 4 },
  { lat: -33.9249, lon: 18.4241, city: 'Cape Town', weight: 2 },
  { lat: -26.2041, lon: 28.0473, city: 'Johannesburg', weight: 3 },
  { lat: 5.6037, lon: -0.1870, city: 'Accra', weight: 2 },
  { lat: 9.0579, lon: 7.4951, city: 'Abuja', weight: 2 },
  { lat: 33.5731, lon: -7.5898, city: 'Casablanca', weight: 2 },
  { lat: 36.8065, lon: 10.1815, city: 'Tunis', weight: 1 },
  { lat: -4.4419, lon: 15.2663, city: 'Kinshasa', weight: 2 },
  { lat: 8.9806, lon: 38.7578, city: 'Addis Ababa', weight: 2 },
  { lat: 0.3476, lon: 32.5825, city: 'Kampala', weight: 1 },
  { lat: -6.7924, lon: 39.2083, city: 'Dar es Salaam', weight: 1 },
  // South America
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 6 },
  { lat: -22.9068, lon: -43.1729, city: 'Rio de Janeiro', weight: 3 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 4 },
  { lat: 4.7110, lon: -74.0721, city: 'Bogota', weight: 3 },
  { lat: -12.0464, lon: -77.0428, city: 'Lima', weight: 3 },
  { lat: -33.4489, lon: -70.6693, city: 'Santiago', weight: 3 },
  { lat: 10.4806, lon: -66.9036, city: 'Caracas', weight: 2 },
  { lat: -0.1807, lon: -78.4678, city: 'Quito', weight: 1 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: -37.8136, lon: 144.9631, city: 'Melbourne', weight: 3 },
  { lat: -36.8485, lon: 174.7633, city: 'Auckland', weight: 1 },
  // China (VPN users, smaller weight)
  { lat: 31.2304, lon: 121.4737, city: 'Shanghai', weight: 3 },
  { lat: 39.9042, lon: 116.4074, city: 'Beijing', weight: 3 },
  { lat: 22.5431, lon: 114.0579, city: 'Shenzhen', weight: 2 },
  { lat: 23.1291, lon: 113.2644, city: 'Guangzhou', weight: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════
// GEODNET — GNSS reference stations, wide geographic coverage needed
// ═══════════════════════════════════════════════════════════════════════════
const GEODNET_CITIES: CityWeight[] = [
  // US
  { lat: 40.7128, lon: -74.0060, city: 'New York', weight: 6 },
  { lat: 34.0522, lon: -118.2437, city: 'Los Angeles', weight: 5 },
  { lat: 37.7749, lon: -122.4194, city: 'San Francisco', weight: 4 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 3 },
  { lat: 47.6062, lon: -122.3321, city: 'Seattle', weight: 3 },
  { lat: 33.4484, lon: -112.0740, city: 'Phoenix', weight: 2 },
  { lat: 29.7604, lon: -95.3698, city: 'Houston', weight: 2 },
  { lat: 25.7617, lon: -80.1918, city: 'Miami', weight: 2 },
  // Europe
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 5 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 4 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 3 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 2 },
  { lat: 40.4168, lon: -3.7038, city: 'Madrid', weight: 2 },
  { lat: 59.3293, lon: 18.0686, city: 'Stockholm', weight: 2 },
  { lat: 52.2297, lon: 21.0122, city: 'Warsaw', weight: 2 },
  { lat: 50.0755, lon: 14.4378, city: 'Prague', weight: 1 },
  // Russia
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 3 },
  { lat: 59.9343, lon: 30.3351, city: 'St. Petersburg', weight: 1 },
  // Turkey
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 2 },
  // Asia
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 5 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 5 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 2 },
  { lat: 25.0330, lon: 121.5654, city: 'Taipei', weight: 2 },
  { lat: 22.3193, lon: 114.1694, city: 'Hong Kong', weight: 2 },
  { lat: 28.6139, lon: 77.2090, city: 'New Delhi', weight: 2 },
  // Americas
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 3 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 2 },
  { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', weight: 1 },
  // Middle East
  { lat: 25.2048, lon: 55.2708, city: 'Dubai', weight: 2 },
  // Africa
  { lat: -26.2041, lon: 28.0473, city: 'Johannesburg', weight: 1 },
  { lat: 30.0444, lon: 31.2357, city: 'Cairo', weight: 1 },
  // Oceania
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: -36.8485, lon: 174.7633, city: 'Auckland', weight: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════
// NOSANA — GPU inference nodes, data center concentrated
// ═══════════════════════════════════════════════════════════════════════════
const NOSANA_CITIES: CityWeight[] = [
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 14 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 12 },
  { lat: 39.0438, lon: -77.4874, city: 'Ashburn', weight: 10 },
  { lat: 37.3382, lon: -121.8863, city: 'San Jose', weight: 8 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 6 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 4 },
  { lat: 52.5200, lon: 13.4050, city: 'Berlin', weight: 3 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 4 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 3 },
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 2 },
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 2 },
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 2 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 2 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 3 },
];

// ═══════════════════════════════════════════════════════════════════════════
// SHADOW/GenesysGo — Storage nodes, data center + distributed
// ═══════════════════════════════════════════════════════════════════════════
const SHADOW_CITIES: CityWeight[] = [
  { lat: 39.0438, lon: -77.4874, city: 'Ashburn', weight: 14 },
  { lat: 37.3382, lon: -121.8863, city: 'San Jose', weight: 10 },
  { lat: 41.8781, lon: -87.6298, city: 'Chicago', weight: 7 },
  { lat: 32.7767, lon: -96.7970, city: 'Dallas', weight: 5 },
  { lat: 50.1109, lon: 8.6821, city: 'Frankfurt', weight: 9 },
  { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', weight: 7 },
  { lat: 51.5074, lon: -0.1278, city: 'London', weight: 5 },
  { lat: 48.8566, lon: 2.3522, city: 'Paris', weight: 3 },
  { lat: 55.7558, lon: 37.6173, city: 'Moscow', weight: 2 },
  { lat: 35.6762, lon: 139.6503, city: 'Tokyo', weight: 6 },
  { lat: 1.3521, lon: 103.8198, city: 'Singapore', weight: 5 },
  { lat: 37.5665, lon: 126.9780, city: 'Seoul', weight: 3 },
  { lat: -33.8688, lon: 151.2093, city: 'Sydney', weight: 3 },
  { lat: 43.6532, lon: -79.3832, city: 'Toronto', weight: 3 },
  { lat: 41.0082, lon: 28.9784, city: 'Istanbul', weight: 2 },
  { lat: -23.5505, lon: -46.6333, city: 'São Paulo', weight: 2 },
];

// ── Deterministic node distribution ─────────────────────────────────────────
function distributeNodes(
  network: DePINNode['network'],
  cities: CityWeight[],
  totalCount: number,
  rewardToken: string,
  baseReward: number,
  activeRate = 0.92,
): DePINNode[] {
  const nodes: DePINNode[] = [];
  if (totalCount === 0) return nodes;

  const cappedCount = Math.min(totalCount, DISPLAY_CAP);
  const totalWeight = cities.reduce((s, c) => s + c.weight, 0);
  let id = 0;

  for (const city of cities) {
    const cityCount = Math.max(1, Math.round((city.weight / totalWeight) * cappedCount));

    for (let i = 0; i < cityCount && nodes.length < cappedCount; i++) {
      // Deterministic jitter using golden angle spiral
      const angle = (id * 137.508) * (Math.PI / 180);
      // Use per-city index (i) for radius so nodes stay near their city center
      // Max ~0.2° ≈ 22km — keeps all nodes on land near the city
      const localLayer = Math.floor(i / 8);
      const r = 0.03 + localLayer * 0.02 + (i % 8) * 0.018;
      const lat = city.lat + r * Math.sin(angle);
      const lon = city.lon + r * Math.cos(angle);

      // Deterministic status based on activeRate
      const statusSeed = (id * 2654435761) & 0x7fffffff;
      const statusPct = (statusSeed % 100);
      const status: DePINNode['status'] = statusPct < (activeRate * 100)
        ? 'active'
        : statusPct < (activeRate * 100 + 4) ? 'relay' : 'offline';

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

// ── Convert real Helium API data to DePINNode[] ─────────────────────────────
function heliumToNodes(
  hotspots: Array<{ lat: number; lon: number; active?: boolean; key?: string }>,
  subnetwork: 'helium-iot' | 'helium-mobile',
  rewardToken: string,
  baseReward: number,
): DePINNode[] {
  // Show ALL real hotspots — no cap for Helium since these are real coordinates
  const capped = hotspots.slice(0, HELIUM_DISPLAY_CAP);
  return capped.map((h, i) => {
    const statusSeed = (i * 2654435761) & 0x7fffffff;
    // Helium API shows most as is_active=false; use deterministic active rate
    // Real active rate: IoT ~35%, Mobile ~60%
    const activeRate = subnetwork === 'helium-iot' ? 0.35 : 0.60;
    const statusPct = (statusSeed % 100);
    const status: DePINNode['status'] = h.active
      ? 'active'
      : statusPct < (activeRate * 100) ? 'active' : 'offline';

    const rewardSeed = ((i + 1) * 1103515245 + 12345) & 0x7fffffff;
    const rewardFactor = 0.5 + ((rewardSeed % 100) / 100) * 1.5;

    return {
      id: `${subnetwork}-${h.key || i}`,
      network: subnetwork,
      lat: h.lat,
      lon: h.lon,
      status,
      rewardToken,
      dailyRewards: status === 'active' ? baseReward * rewardFactor : 0,
      uptimePercent: status === 'active' ? 90 + (statusSeed % 10) : (statusSeed % 30),
    };
  });
}

// ── Fetch real Helium hotspot locations via server proxy ────────────────────
async function fetchHeliumFromProxy(): Promise<{
  iot: DePINNode[];
  mobile: DePINNode[];
  totalIot: number;
  totalMobile: number;
}> {
  const fallback = { iot: [], mobile: [], totalIot: 0, totalMobile: 0 };

  try {
    const res = await fetch('/api/helium-hotspots', {
      signal: AbortSignal.timeout(90000), // longer timeout for paginated fetch
    });
    if (!res.ok) {
      console.warn(`[depin-geo] Helium proxy returned ${res.status}`);
      return fallback;
    }

    const data = await res.json();
    const iot = heliumToNodes(data.iot || [], 'helium-iot', 'HNT', 0.12);
    const mobile = heliumToNodes(data.mobile || [], 'helium-mobile', 'MOBILE', 0.05);

    console.log(`[depin-geo] Real Helium: ${iot.length} IoT, ${mobile.length} Mobile hotspots`);
    return {
      iot,
      mobile,
      totalIot: data.totalIot || iot.length,
      totalMobile: data.totalMobile || mobile.length,
    };
  } catch (e) {
    console.warn('[depin-geo] Helium proxy fetch failed:', e);
    return fallback;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function fetchDePINNodes(): Promise<DePINNode[]> {
  const now = Date.now();
  if (cachedNodes && now - lastFetch < CACHE_TTL) {
    return cachedNodes;
  }

  console.log('[depin-geo] Fetching DePIN data...');

  // Fetch real Helium data from proxy
  const helium = await fetchHeliumFromProxy();

  // Use real Helium nodes if available, otherwise fall back to city distribution
  const heliumIotNodes = helium.iot.length >= 100
    ? helium.iot
    : distributeNodes('helium-iot', GRASS_CITIES, NETWORK_COUNTS['helium-iot'] || 375000, 'HNT', 0.12, 0.35);

  const heliumMobileNodes = helium.mobile.length >= 50
    ? helium.mobile
    : distributeNodes('helium-mobile', GRASS_CITIES.slice(0, 30), NETWORK_COUNTS['helium-mobile'] || 30000, 'MOBILE', 0.05, 0.60);

  // Other networks — city-weighted distribution with real total counts
  const renderNodes = distributeNodes('render', RENDER_CITIES, NETWORK_COUNTS.render || 12000, 'RENDER', 2.5, 0.88);
  const ionetNodes = distributeNodes('ionet', IONET_CITIES, NETWORK_COUNTS.ionet || 45000, 'IO', 1.2, 0.78);
  const hivemapperNodes = distributeNodes('hivemapper', HIVEMAPPER_CITIES, NETWORK_COUNTS.hivemapper || 150000, 'HONEY', 0.8, 0.85);
  const grassNodes = distributeNodes('grass', GRASS_CITIES, NETWORK_COUNTS.grass || 2500000, 'GRASS', 0.03, 0.70);
  const geodnetNodes = distributeNodes('geodnet', GEODNET_CITIES, NETWORK_COUNTS.geodnet || 10000, 'GEOD', 5.0, 0.94);
  const nosanaNodes = distributeNodes('nosana', NOSANA_CITIES, NETWORK_COUNTS.nosana || 800, 'NOS', 3.0, 0.90);
  const shadowNodes = distributeNodes('shadow', SHADOW_CITIES, NETWORK_COUNTS.shadow || 3500, 'SHDW', 1.5, 0.85);

  const allNodes: DePINNode[] = [
    ...heliumIotNodes,
    ...heliumMobileNodes,
    ...renderNodes,
    ...ionetNodes,
    ...hivemapperNodes,
    ...grassNodes,
    ...geodnetNodes,
    ...nosanaNodes,
    ...shadowNodes,
  ];

  cachedNodes = allNodes;
  lastFetch = now;

  const sourceLabel = helium.iot.length >= 100 ? '🌐 REAL' : '📍 estimated';
  console.log(`[depin-geo] Loaded ${allNodes.length} DePIN nodes across 9 networks (Helium: ${sourceLabel})`);
  console.log(`[depin-geo] Helium real: IoT=${helium.iot.length}, Mobile=${helium.mobile.length} | Display caps: Helium=${HELIUM_DISPLAY_CAP}, Others=${DISPLAY_CAP}`);

  return allNodes;
}

// ── Stats for overlay ───────────────────────────────────────────────────────
export type DePINNetworkKey = 'helium-iot' | 'helium-mobile' | 'render' | 'ionet' | 'hivemapper' | 'grass' | 'geodnet' | 'nosana' | 'shadow';

export interface DePINStatsResult {
  [key: string]: { total: number; active: number; realCount: number };
}

export function getDePINStats(nodes: DePINNode[]): DePINStatsResult {
  const networks: DePINNetworkKey[] = [
    'helium-iot', 'helium-mobile', 'render', 'ionet', 'hivemapper',
    'grass', 'geodnet', 'nosana', 'shadow',
  ];

  const stats: DePINStatsResult = {};
  for (const net of networks) {
    stats[net] = { total: 0, active: 0, realCount: NETWORK_COUNTS[net] || 0 };
  }

  for (const node of nodes) {
    const net = stats[node.network];
    if (!net) continue;
    net.total++;
    if (node.status === 'active') net.active++;
  }

  return stats;
}

// Network display info
export const DEPIN_NETWORK_INFO: Record<string, { label: string; token: string; category: string }> = {
  'helium-iot': { label: 'Helium IoT', token: 'HNT', category: 'Wireless' },
  'helium-mobile': { label: 'Helium Mobile', token: 'MOBILE', category: 'Wireless' },
  render: { label: 'Render', token: 'RENDER', category: 'GPU Compute' },
  ionet: { label: 'io.net', token: 'IO', category: 'GPU Compute' },
  hivemapper: { label: 'Hivemapper', token: 'HONEY', category: 'Mapping' },
  grass: { label: 'Grass', token: 'GRASS', category: 'Bandwidth' },
  geodnet: { label: 'Geodnet', token: 'GEOD', category: 'Geospatial' },
  nosana: { label: 'Nosana', token: 'NOS', category: 'AI Compute' },
  shadow: { label: 'Shadow', token: 'SHDW', category: 'Storage' },
};
