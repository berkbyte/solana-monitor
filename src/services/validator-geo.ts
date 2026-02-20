// Validator Geographic Data Service — powered by validators.app API
// Single source of truth: https://www.validators.app/api/v1/validators/mainnet.json
// Provides: geo coordinates, Jito flag, client type, stake, commission, scores, etc.
// Rate limit: 20 req / 5 min → server-side proxy caches 5 min
// Fallback: Solana RPC getVoteAccounts + getClusterNodes if validators.app is down

import type { SolanaValidator, ValidatorCluster } from '@/types';

// ── Cache ──────────────────────────────────────────────────────────────────────
let cachedValidators: SolanaValidator[] | null = null;
let cachedClusters: ValidatorCluster[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min — matches server-side proxy cache

// ── Jitter: offset overlapping coordinates ──────────────────────────────────
function addJitter(lat: number, lon: number, index: number): { lat: number; lon: number } {
  const angle = (index * 137.508) * (Math.PI / 180); // golden angle
  const r = 0.10 + (index % 7) * 0.03;
  return { lat: lat + r * Math.sin(angle), lon: lon + r * Math.cos(angle) };
}

// ── Map software_client string to our clientType ────────────────────────────
// validators.app provides: "Agave", "AgaveBam", "JitoLabs", "Firedancer",
// "Frankendancer", "Harmonic", "Paladin", "AgavePaladin", "Unknown"
function mapClientType(
  softwareClient: string | null | undefined,
  jito: boolean,
): SolanaValidator['clientType'] {
  if (!softwareClient) return jito ? 'jito' : 'unknown';
  const sc = softwareClient.toLowerCase();
  if (sc.includes('firedancer') || sc.includes('frankendancer') || sc.includes('harmonic')) return 'firedancer';
  if (jito) return 'jito';
  if (sc.includes('jito')) return 'jito';
  if (sc.includes('agave') || sc.includes('paladin')) return 'solana-labs'; // Agave = ex-Solana Labs
  return 'unknown';
}

// ── Parse data_center_key → country code ────────────────────────────────────
// Format: "ASN-CC-City" e.g. "24940-FI-Helsinki", "16276-DE-Frankfurt"
function parseDataCenterKey(key: string | null | undefined): { country: string; city: string; dc: string } {
  if (!key) return { country: '', city: '', dc: '' };
  const parts = key.split('-');
  if (parts.length >= 3) {
    return {
      country: parts[1] || '',
      city: parts.slice(2).join('-') || '',
      dc: key,
    };
  }
  return { country: '', city: key, dc: key };
}

// ── Fetch from validators.app (primary source) ─────────────────────────────
async function fetchFromValidatorsApp(): Promise<SolanaValidator[]> {
  try {
    console.log('[validator-geo] Fetching from validators.app via proxy...');
    const res = await fetch('/api/validators-app', {
      signal: AbortSignal.timeout(50000),
    });

    if (!res.ok) {
      console.warn(`[validator-geo] validators.app proxy → HTTP ${res.status}`);
      return [];
    }

    const data: Array<Record<string, unknown>> = await res.json();
    if (!Array.isArray(data) || data.length < 100) {
      console.warn(`[validator-geo] validators.app returned only ${Array.isArray(data) ? data.length : 0} entries`);
      return [];
    }

    console.log(`[validator-geo] ✅ validators.app: ${data.length} raw validators`);

    const validators: SolanaValidator[] = [];
    let geoHit = 0, geoMiss = 0;
    let jitoCount = 0, fdCount = 0, agaveCount = 0;

    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;

      // Geo coordinates — validators.app provides latitude/longitude as strings
      const rawLat = parseFloat(String(v.latitude || ''));
      const rawLon = parseFloat(String(v.longitude || ''));
      const hasGeo = !isNaN(rawLat) && !isNaN(rawLon) && (rawLat !== 0 || rawLon !== 0);

      let lat: number | undefined;
      let lon: number | undefined;

      if (hasGeo) {
        const j = addJitter(rawLat, rawLon, i);
        lat = j.lat;
        lon = j.lon;
        geoHit++;
      } else {
        geoMiss++;
        // No fallback — skip validators without geo (they won't appear on map)
      }

      // Data center info
      const dcInfo = parseDataCenterKey(v.data_center_key as string);
      const country = dcInfo.country;
      const city = dcInfo.city;
      const datacenter = dcInfo.dc || undefined;

      // Client type — validators.app gives us both software_client AND jito flag
      const jito = Boolean(v.jito);
      const softwareClient = (v.software_client || '') as string;
      const clientType = mapClientType(softwareClient, jito);

      if (clientType === 'firedancer') fdCount++;
      else if (clientType === 'jito') jitoCount++;
      else if (clientType === 'solana-labs') agaveCount++;

      // Stake: active_stake from validators.app is in LAMPORTS
      const stakeRaw = Number(v.active_stake || 0);
      const activatedStake = Math.round(stakeRaw / 1e9); // Convert to SOL

      // Commission is already in percent (0-100)
      const commission = Number(v.commission ?? 10);

      // Skip rate: validators.app returns skipped_slot_percent as string percent
      const skipRate = parseFloat(String(v.skipped_slot_percent || '0'));

      // Version
      const version = (v.software_version || 'unknown') as string;

      validators.push({
        pubkey: (v.vote_account || v.account || `unknown-${i}`) as string,
        name: (v.name || undefined) as string | undefined,
        lat, lon, city, country, datacenter,
        activatedStake,
        commission,
        lastVote: Number(v.epoch_credits || 0),
        delinquent: Boolean(v.delinquent),
        version,
        clientType,
        skipRate,
        apy: 0, // validators.app doesn't provide APY directly
      });
    }

    console.log(
      `[validator-geo] Mapped: ${geoHit} with geo, ${geoMiss} without | ` +
      `Jito: ${jitoCount}, FD: ${fdCount}, Agave: ${agaveCount}, Unknown: ${validators.length - jitoCount - fdCount - agaveCount}`
    );
    return validators;
  } catch (err) {
    console.error('[validator-geo] validators.app fetch failed:', (err as Error).message);
    return [];
  }
}

// ── Known datacenter coordinates (fallback for RPC path) ────────────────────
interface DCLocation { lat: number; lon: number; city: string; country: string }

const DC: Record<string, DCLocation> = {
  'hetzner-fsn':    { lat: 50.3155, lon: 11.3271, city: 'Falkenstein',    country: 'DE' },
  'hetzner-nbg':    { lat: 49.4521, lon: 11.0767, city: 'Nuremberg',     country: 'DE' },
  'hetzner-hel':    { lat: 60.1699, lon: 24.9384, city: 'Helsinki',      country: 'FI' },
  'hetzner-ash':    { lat: 39.0438, lon: -77.4874, city: 'Ashburn',      country: 'US' },
  'equinix-dc':     { lat: 38.9072, lon: -77.0369, city: 'Washington DC', country: 'US' },
  'equinix-ny':     { lat: 40.7128, lon: -74.0060, city: 'New York',     country: 'US' },
  'equinix-ch':     { lat: 41.8781, lon: -87.6298, city: 'Chicago',      country: 'US' },
  'equinix-am':     { lat: 52.3676, lon: 4.9041,  city: 'Amsterdam',     country: 'NL' },
  'equinix-fr':     { lat: 50.1109, lon: 8.6821,  city: 'Frankfurt',     country: 'DE' },
  'equinix-sg':     { lat: 1.3521,  lon: 103.8198, city: 'Singapore',    country: 'SG' },
  'equinix-tk':     { lat: 35.6762, lon: 139.6503, city: 'Tokyo',        country: 'JP' },
  'equinix-ld':     { lat: 51.5074, lon: -0.1278, city: 'London',        country: 'GB' },
  'aws-us-east':    { lat: 39.0438, lon: -77.4874, city: 'Ashburn',      country: 'US' },
  'aws-eu':         { lat: 50.1109, lon: 8.6821,  city: 'Frankfurt',     country: 'DE' },
  'gcp-us':         { lat: 41.2619, lon: -95.8608, city: 'Council Bluffs', country: 'US' },
  'ovh-gra':        { lat: 50.6292, lon: 3.0573,  city: 'Gravelines',    country: 'FR' },
  'teraswitch-dal': { lat: 32.7767, lon: -96.7970, city: 'Dallas',       country: 'US' },
  'latitude-mia':   { lat: 25.7617, lon: -80.1918, city: 'Miami',        country: 'US' },
  'vultr-nj':       { lat: 40.7128, lon: -74.0060, city: 'New Jersey',   country: 'US' },
};

const DC_KEYS = Object.keys(DC);

// ── IP prefix → datacenter mapping (for RPC fallback) ───────────────────────
const IP_PREFIX_MAP: Array<{ prefix: string; dc: string }> = [
  { prefix: '65.21.',    dc: 'hetzner-fsn' },
  { prefix: '65.108.',   dc: 'hetzner-fsn' },
  { prefix: '65.109.',   dc: 'hetzner-fsn' },
  { prefix: '95.216.',   dc: 'hetzner-fsn' },
  { prefix: '95.217.',   dc: 'hetzner-nbg' },
  { prefix: '135.181.',  dc: 'hetzner-hel' },
  { prefix: '148.251.',  dc: 'hetzner-nbg' },
  { prefix: '168.119.',  dc: 'hetzner-fsn' },
  { prefix: '49.12.',    dc: 'hetzner-fsn' },
  { prefix: '49.13.',    dc: 'hetzner-nbg' },
  { prefix: '157.90.',   dc: 'hetzner-fsn' },
  { prefix: '5.161.',    dc: 'hetzner-ash' },
  { prefix: '37.27.',    dc: 'hetzner-hel' },
  { prefix: '51.38.',    dc: 'ovh-gra' },
  { prefix: '51.68.',    dc: 'ovh-gra' },
  { prefix: '51.89.',    dc: 'ovh-gra' },
  { prefix: '139.178.',  dc: 'equinix-dc' },
  { prefix: '145.40.',   dc: 'equinix-dc' },
  { prefix: '141.98.',   dc: 'teraswitch-dal' },
  { prefix: '74.118.',   dc: 'teraswitch-dal' },
  { prefix: '45.32.',    dc: 'vultr-nj' },
  { prefix: '45.76.',    dc: 'vultr-nj' },
].sort((a, b) => b.prefix.length - a.prefix.length);

function ipToLocation(ip: string): { dc: string; loc: DCLocation } | null {
  if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  for (const entry of IP_PREFIX_MAP) {
    if (ip.startsWith(entry.prefix)) {
      const loc = DC[entry.dc];
      if (loc) return { dc: entry.dc, loc };
    }
  }
  return null;
}

// ── RPC helper ──────────────────────────────────────────────────────────────
const RPC_ENDPOINTS = [
  import.meta.env.VITE_HELIUS_RPC_URL || '',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean);

async function rpcCall(method: string, params: unknown[] = [], timeoutMs = 30000): Promise<unknown> {
  // Try proxy first
  try {
    const res = await fetch('/api/solana-rpc-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs + 15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result !== undefined) return data.result;
    }
  } catch { /* fall through */ }

  // Direct RPC
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.result !== undefined) return data.result;
    } catch { continue; }
  }
  return null;
}

// ── Fetch from RPC (fallback only) ─────────────────────────────────────────
async function fetchFromRPC(): Promise<SolanaValidator[]> {
  console.log('[validator-geo] ── RPC Fallback Start ──');

  const voteResult = await rpcCall('getVoteAccounts', [{ commitment: 'confirmed' }], 45000) as {
    current?: Array<Record<string, unknown>>;
    delinquent?: Array<Record<string, unknown>>;
  } | null;

  if (!voteResult) {
    console.error('[validator-geo] ❌ getVoteAccounts failed');
    return [];
  }

  const current = voteResult.current || [];
  const delinquent = voteResult.delinquent || [];
  console.log(`[validator-geo] Vote: ${current.length} current + ${delinquent.length} delinquent`);

  // Get cluster nodes for IP/version
  const clusterNodes = await rpcCall('getClusterNodes', [], 25000) as Array<{
    pubkey: string; gossip?: string | null; version?: string | null;
  }> | null;

  const nodeMap = new Map<string, { ip: string; version: string }>();
  if (clusterNodes && Array.isArray(clusterNodes)) {
    for (const node of clusterNodes) {
      const ip = (node.gossip || '').split(':')[0] || '';
      if (ip && ip !== '0.0.0.0') {
        nodeMap.set(node.pubkey, { ip, version: node.version || 'unknown' });
      }
    }
  }

  const validators: SolanaValidator[] = [];
  const allVotes: Array<Record<string, unknown> & { delinquent: boolean }> = [
    ...current.map(v => ({ ...v, delinquent: false })),
    ...delinquent.map(v => ({ ...v, delinquent: true })),
  ];

  for (let i = 0; i < allVotes.length; i++) {
    const v = allVotes[i]!;
    const nodePubkey = String(v.nodePubkey || '');
    const nodeInfo = nodeMap.get(nodePubkey);
    const ip = nodeInfo?.ip || '';
    const version = nodeInfo?.version || 'unknown';
    const ipLoc = ipToLocation(ip);

    let lat: number | undefined, lon: number | undefined;
    let city = '', country = '', datacenter: string | undefined;

    if (ipLoc) {
      const j = addJitter(ipLoc.loc.lat, ipLoc.loc.lon, i);
      lat = j.lat; lon = j.lon;
      city = ipLoc.loc.city; country = ipLoc.loc.country; datacenter = ipLoc.dc;
    } else {
      // Hash-based fallback
      let hash = 0;
      for (let c = 0; c < nodePubkey.length; c++) hash = ((hash << 5) - hash + nodePubkey.charCodeAt(c)) | 0;
      const dcKey = DC_KEYS[Math.abs(hash) % DC_KEYS.length]!;
      const baseLoc = DC[dcKey]!;
      const j = addJitter(baseLoc.lat, baseLoc.lon, i);
      lat = j.lat; lon = j.lon;
      city = baseLoc.city; country = baseLoc.country; datacenter = dcKey;
    }

    validators.push({
      pubkey: String(v.votePubkey || ''),
      lat, lon, city, country, datacenter,
      activatedStake: Math.round(Number(v.activatedStake || 0) / 1e9),
      commission: Number(v.commission ?? 10),
      lastVote: Number(v.lastVote || 0),
      delinquent: Boolean(v.delinquent),
      version,
      clientType: version.toLowerCase().includes('jito') ? 'jito' : 'solana-labs',
      skipRate: 0,
      apy: 0,
    });
  }

  console.log(`[validator-geo] ✅ RPC fallback: ${validators.length} validators`);
  return validators;
}

// ── Cluster validators by proximity ─────────────────────────────────────────
function clusterValidators(validators: SolanaValidator[]): ValidatorCluster[] {
  const clusterMap = new Map<string, SolanaValidator[]>();

  for (const v of validators) {
    if (v.lat == null || v.lon == null) continue;
    const latKey = Math.round(v.lat / 2) * 2;
    const lonKey = Math.round(v.lon / 2) * 2;
    const key = `${latKey},${lonKey}`;
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key)!.push(v);
  }

  const totalStakeGlobal = validators.reduce((s, v) => s + v.activatedStake, 0);
  const clusters: ValidatorCluster[] = [];

  for (const [clusterKey, cvs] of clusterMap) {
    const avgLat = cvs.reduce((s, v) => s + (v.lat || 0), 0) / cvs.length;
    const avgLon = cvs.reduce((s, v) => s + (v.lon || 0), 0) / cvs.length;
    const totalStake = cvs.reduce((s, v) => s + v.activatedStake, 0);

    const countries = cvs.map(v => v.country).filter((c): c is string => Boolean(c));
    const dominantCountry = arrMode(countries) || 'Unknown';
    const datacenters = cvs.map(v => v.datacenter).filter((d): d is string => Boolean(d));
    const dominantDC = arrMode(datacenters) || undefined;

    clusters.push({
      id: clusterKey,
      lat: avgLat, lon: avgLon,
      count: cvs.length, totalStake,
      validators: cvs,
      datacenter: dominantDC,
      country: dominantCountry,
      stakeConcentration: totalStakeGlobal > 0 ? totalStake / totalStakeGlobal : 0,
    });
  }

  return clusters.sort((a, b) => b.totalStake - a.totalStake);
}

function arrMode(arr: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const x of arr) counts.set(x, (counts.get(x) || 0) + 1);
  let best: string | undefined;
  let bestC = 0;
  for (const [k, c] of counts) {
    if (c > bestC) { best = k; bestC = c; }
  }
  return best;
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export async function fetchValidatorGeoData(): Promise<{
  validators: SolanaValidator[];
  clusters: ValidatorCluster[];
}> {
  const now = Date.now();
  if (cachedValidators && cachedClusters && now - lastFetch < CACHE_TTL) {
    console.log(`[validator-geo] Cache hit (${cachedValidators.length} validators)`);
    return { validators: cachedValidators, clusters: cachedClusters };
  }

  console.log('[validator-geo] ════════════════════════════════════════');
  console.log('[validator-geo] Starting validator data fetch...');

  // Primary: validators.app (has everything — geo, jito, client, scores)
  let validators = await fetchFromValidatorsApp();

  // Fallback: Solana RPC (no client type, limited geo)
  if (validators.length < 50) {
    console.log('[validator-geo] validators.app unavailable, falling back to RPC...');
    validators = await fetchFromRPC();
  }

  if (validators.length === 0) {
    console.error('[validator-geo] ❌ All data sources failed!');
    return { validators: [], clusters: [] };
  }

  // Only include validators with geo coordinates for map rendering
  const geoValidators = validators.filter(v => v.lat != null && v.lon != null);
  const clusters = clusterValidators(geoValidators);

  cachedValidators = geoValidators;
  cachedClusters = clusters;
  lastFetch = now;

  // Stats summary
  const totalStake = geoValidators.reduce((s, v) => s + v.activatedStake, 0);
  const activeCount = geoValidators.filter(v => !v.delinquent).length;
  const delinqCount = geoValidators.filter(v => v.delinquent).length;
  const countryCount = new Set(geoValidators.map(v => v.country).filter(Boolean)).size;
  const jitoCount = geoValidators.filter(v => v.clientType === 'jito').length;
  const fdCount = geoValidators.filter(v => v.clientType === 'firedancer').length;

  console.log(
    `[validator-geo] ✅ DONE: ${geoValidators.length} validators (${activeCount} active, ${delinqCount} delinquent) | ` +
    `${clusters.length} clusters | ${countryCount} countries | ` +
    `Jito: ${jitoCount}, FD: ${fdCount} | ${(totalStake / 1e6).toFixed(1)}M SOL`
  );
  console.log('[validator-geo] ════════════════════════════════════════');

  return { validators: geoValidators, clusters };
}

export function computeNakamoto(validators: SolanaValidator[]): number {
  const stakes = validators.filter(v => !v.delinquent).map(v => v.activatedStake).sort((a, b) => b - a);
  const totalStake = stakes.reduce((s, v) => s + v, 0);
  if (totalStake === 0) return 0;
  const threshold = totalStake / 3;
  let cum = 0;
  for (let i = 0; i < stakes.length; i++) {
    cum += stakes[i]!;
    if (cum >= threshold) return i + 1;
  }
  return stakes.length;
}

export function getDatacenterConcentration(clusters: ValidatorCluster[]): {
  dc: string; country: string; count: number; stakePercent: number;
}[] {
  return clusters
    .filter(c => c.count >= 3)
    .map(c => ({
      dc: c.datacenter || c.country,
      country: c.country,
      count: c.count,
      stakePercent: Math.round(c.stakeConcentration * 10000) / 100,
    }))
    .sort((a, b) => b.stakePercent - a.stakePercent)
    .slice(0, 20);
}

export function getValidatorStats(validators: SolanaValidator[]): {
  total: number; active: number; delinquent: number; nakamoto: number;
  totalStakeSOL: number; avgCommission: number;
  clientBreakdown: Record<string, number>;
  countryBreakdown: Array<{ country: string; count: number; stakePercent: number }>;
  versionBreakdown: Array<{ version: string; count: number }>;
  avgSkipRate: number; top10StakePct: number;
} {
  const active = validators.filter(v => !v.delinquent);
  const totalStake = validators.reduce((s, v) => s + v.activatedStake, 0);
  const nakamoto = computeNakamoto(validators);

  // Client breakdown
  const clients: Record<string, number> = {};
  for (const v of validators) {
    const ct = v.clientType || 'unknown';
    clients[ct] = (clients[ct] || 0) + 1;
  }

  // Country breakdown
  const countryMap = new Map<string, { count: number; stake: number }>();
  for (const v of validators) {
    const c = v.country || 'Unknown';
    const e = countryMap.get(c) || { count: 0, stake: 0 };
    e.count++; e.stake += v.activatedStake;
    countryMap.set(c, e);
  }
  const countryBreakdown = [...countryMap.entries()]
    .map(([country, { count, stake }]) => ({
      country, count,
      stakePercent: totalStake > 0 ? Math.round(stake / totalStake * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count).slice(0, 10);

  // Version breakdown
  const versionMap = new Map<string, number>();
  for (const v of validators) {
    const ver = v.version || 'unknown';
    versionMap.set(ver, (versionMap.get(ver) || 0) + 1);
  }
  const versionBreakdown = [...versionMap.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5);

  // Averages
  const avgCommission = active.length > 0
    ? Math.round(active.reduce((s, v) => s + v.commission, 0) / active.length * 10) / 10 : 0;
  const withSkip = active.filter(v => (v.skipRate || 0) > 0);
  const avgSkipRate = withSkip.length > 0
    ? Math.round(withSkip.reduce((s, v) => s + (v.skipRate || 0), 0) / withSkip.length * 100) / 100 : 0;

  // Top 10 stake concentration
  const sorted = active.map(v => v.activatedStake).sort((a, b) => b - a);
  const activeStake = sorted.reduce((s, v) => s + v, 0);
  const top10Stake = sorted.slice(0, 10).reduce((s, v) => s + v, 0);
  const top10StakePct = activeStake > 0 ? Math.round(top10Stake / activeStake * 1000) / 10 : 0;

  return {
    total: validators.length, active: active.length,
    delinquent: validators.length - active.length,
    nakamoto, totalStakeSOL: totalStake, avgCommission,
    clientBreakdown: clients, countryBreakdown, versionBreakdown,
    avgSkipRate, top10StakePct,
  };
}
