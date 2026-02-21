export type PropagandaRisk = 'low' | 'medium' | 'high';

export interface Feed {
  name: string;
  url: string;
  type?: string;
  region?: string;
  category?: string;
  tier?: number;
  propagandaRisk?: PropagandaRisk;
  stateAffiliated?: string;
}

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  tier?: number;
  threat?: import('@/services/threat-classifier').ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
}

export type VelocityLevel = 'normal' | 'elevated' | 'spike';
export type SentimentType = 'negative' | 'neutral' | 'positive';
export type DeviationLevel = 'normal' | 'elevated' | 'spike' | 'quiet';

export interface VelocityMetrics {
  sourcesPerHour: number;
  level: VelocityLevel;
  trend: 'rising' | 'stable' | 'falling';
  sentiment: SentimentType;
  sentimentScore: number;
}

export interface ClusteredEvent {
  id: string;
  primaryTitle: string;
  primarySource: string;
  primaryLink: string;
  sourceCount: number;
  topSources: Array<{ name: string; tier: number; url: string }>;
  allItems: NewsItem[];
  firstSeen: Date;
  lastUpdated: Date;
  isAlert: boolean;
  velocity?: VelocityMetrics;
  threat?: import('@/services/threat-classifier').ThreatClassification;
  lat?: number;
  lon?: number;
}

export type AssetType = 'pipeline' | 'cable' | 'datacenter' | 'base' | 'nuclear';

export interface RelatedAsset {
  id: string;
  name: string;
  type: AssetType;
  distanceKm: number;
}

export interface RelatedAssetContext {
  origin: { label: string; lat: number; lon: number };
  types: AssetType[];
  assets: RelatedAsset[];
}

export interface Sector {
  symbol: string;
  name: string;
}

export interface Commodity {
  symbol: string;
  name: string;
  display: string;
}

export interface MarketSymbol {
  symbol: string;
  name: string;
  display: string;
}

export interface MarketData {
  symbol: string;
  name: string;
  display: string;
  price: number | null;
  change: number | null;
  sparkline?: number[];
}

export interface CryptoData {
  name: string;
  symbol: string;
  price: number;
  change: number;
  sparkline?: number[];
}

// AIS Disruption (used by signal-aggregator)
export type AisDisruptionType = 'gap_spike' | 'chokepoint_congestion';

export interface AisDisruptionEvent {
  id: string;
  name: string;
  type: AisDisruptionType;
  lat: number;
  lon: number;
  severity: 'low' | 'elevated' | 'high';
  changePct: number;
  windowHours: number;
  darkShips?: number;
  vesselCount?: number;
  region?: string;
  description: string;
}

// Social Unrest (used by signal-aggregator / country-instability)
export type ProtestSeverity = 'low' | 'medium' | 'high';
export type ProtestSource = 'acled' | 'gdelt' | 'rss';
export type ProtestEventType = 'protest' | 'riot' | 'strike' | 'demonstration' | 'civil_unrest';

export interface SocialUnrestEvent {
  id: string;
  title: string;
  summary?: string;
  eventType: ProtestEventType;
  city?: string;
  country: string;
  region?: string;
  lat: number;
  lon: number;
  time: Date;
  severity: ProtestSeverity;
  fatalities?: number;
  sources: string[];
  sourceType: ProtestSource;
  tags?: string[];
  actors?: string[];
  relatedHotspots?: string[];
  confidence: 'high' | 'medium' | 'low';
  validated: boolean;
  imageUrl?: string;
  sentiment?: 'angry' | 'peaceful' | 'mixed';
}

// Military Flight Tracking (used by InsightsPanel / signal-aggregator)
export type MilitaryAircraftType =
  | 'fighter' | 'bomber' | 'transport' | 'tanker'
  | 'awacs' | 'reconnaissance' | 'helicopter' | 'drone'
  | 'patrol' | 'special_ops' | 'vip' | 'unknown';

export type MilitaryOperator =
  | 'usaf' | 'usn' | 'usmc' | 'usa'
  | 'raf' | 'rn' | 'faf' | 'gaf'
  | 'plaaf' | 'plan' | 'vks' | 'iaf'
  | 'nato' | 'other';

export interface MilitaryFlight {
  id: string;
  callsign: string;
  hexCode: string;
  registration?: string;
  aircraftType: MilitaryAircraftType;
  aircraftModel?: string;
  operator: MilitaryOperator;
  operatorCountry: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
  speed: number;
  verticalRate?: number;
  onGround: boolean;
  squawk?: string;
  origin?: string;
  destination?: string;
  lastSeen: Date;
  firstSeen?: Date;
  track?: [number, number][];
  confidence: 'high' | 'medium' | 'low';
  isInteresting?: boolean;
  note?: string;
  enriched?: {
    manufacturer?: string;
    owner?: string;
    operatorName?: string;
    typeCode?: string;
    builtYear?: string;
    confirmedMilitary?: boolean;
    militaryBranch?: string;
  };
}

// Military Vessel Tracking (used by signal-aggregator / country-instability)
export type MilitaryVesselType =
  | 'carrier' | 'destroyer' | 'frigate' | 'submarine'
  | 'amphibious' | 'patrol' | 'auxiliary' | 'research'
  | 'icebreaker' | 'special' | 'unknown';

export interface MilitaryVessel {
  id: string;
  mmsi: string;
  name: string;
  vesselType: MilitaryVesselType;
  aisShipType?: string;
  hullNumber?: string;
  operator: MilitaryOperator | 'other';
  operatorCountry: string;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  course?: number;
  destination?: string;
  lastAisUpdate: Date;
  aisGapMinutes?: number;
  isDark?: boolean;
  nearChokepoint?: string;
  nearBase?: string;
  track?: [number, number][];
  confidence: 'high' | 'medium' | 'low';
  isInteresting?: boolean;
  note?: string;
}

// Country instability transitives
export interface CountryDisplacement {
  code: string;
  name: string;
  refugees: number;
  asylumSeekers: number;
  idps: number;
  stateless: number;
  totalDisplaced: number;
  hostRefugees: number;
  hostAsylumSeekers: number;
  hostTotal: number;
  lat?: number;
  lon?: number;
}

export type AnomalySeverity = 'normal' | 'moderate' | 'extreme';

export interface ClimateAnomaly {
  zone: string;
  lat: number;
  lon: number;
  tempDelta: number;
  precipDelta: number;
  severity: AnomalySeverity;
  type: 'warm' | 'cold' | 'wet' | 'dry' | 'mixed';
  period: string;
}

// Internet Outage (used by outages service / signal-aggregator)
export interface InternetOutage {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  country: string;
  region?: string;
  lat: number;
  lon: number;
  severity: 'partial' | 'major' | 'total';
  categories: string[];
  cause?: string;
  outageType?: string;
  endDate?: Date;
}

export interface PanelConfig {
  name: string;
  enabled: boolean;
  priority?: number;
}

export interface MapLayers {
  validators: boolean;
  stakeHeatmap: boolean;
  dcClusters: boolean;
  delinquent: boolean;
  depinHelium: boolean;
  depinRender: boolean;
  depinIonet: boolean;
  whaleFlows: boolean;
  dcRisk: boolean;
}

export interface PredictionMarket {
  title: string;
  yesPrice: number;
  volume?: number;
  url?: string;
}

// ============================================================================
// FOCAL POINT DETECTION (Intelligence Synthesis)
// ============================================================================

export type FocalPointUrgency = 'watch' | 'elevated' | 'critical';

export interface HeadlineWithUrl {
  title: string;
  url: string;
}

export interface EntityMention {
  entityId: string;
  entityType: 'country' | 'company' | 'index' | 'commodity' | 'crypto' | 'sector';
  displayName: string;
  mentionCount: number;
  avgConfidence: number;
  clusterIds: string[];
  topHeadlines: HeadlineWithUrl[];
}

export interface FocalPoint {
  id: string;
  entityId: string;
  entityType: 'country' | 'company' | 'index' | 'commodity' | 'crypto' | 'sector';
  displayName: string;
  newsMentions: number;
  newsVelocity: number;
  topHeadlines: HeadlineWithUrl[];
  signalTypes: string[];
  signalCount: number;
  highSeverityCount: number;
  signalDescriptions: string[];
  focalScore: number;
  urgency: FocalPointUrgency;
  narrative: string;
  correlationEvidence: string[];
}

export interface FocalPointSummary {
  timestamp: Date;
  focalPoints: FocalPoint[];
  aiContext: string;
  topCountries: FocalPoint[];
  topCompanies: FocalPoint[];
}

// ============================================================================
// SOLANA TERMINAL — Domain Types
// ============================================================================

export type GlobeMode = 'validators' | 'depin' | 'risk' | 'defi';

export interface SolanaValidator {
  pubkey: string;
  name?: string;
  lat?: number;
  lon?: number;
  city?: string;
  country?: string;
  datacenter?: string;
  activatedStake: number;
  commission: number;
  lastVote: number;
  delinquent: boolean;
  version?: string;
  clientType?: 'solana-labs' | 'jito' | 'firedancer' | 'unknown';
  skipRate?: number;
  apy?: number;
}

export interface ValidatorCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  totalStake: number;
  validators: SolanaValidator[];
  datacenter?: string;
  country: string;
  stakeConcentration: number;
}

export interface SolanaNetworkStatus {
  tps: number;
  slot: number;
  epoch: number;
  epochProgress: number;
  validatorCount: number;
  delinquentCount: number;
  totalStake: number;
  feeLevels: { min: number; low: number; medium: number; high: number; veryHigh: number; unsafeMax: number };
  health: 'healthy' | 'degraded' | 'down';
  blockTime?: number;
}

export interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
  liquidity: number;
  fdv?: number;
  logoUri?: string;
  rugScore: number;
  pairAge?: number;
}

export interface WhaleTransaction {
  signature: string;
  type: 'transfer' | 'swap' | 'stake' | 'nft_trade' | 'unknown';
  wallet: string;
  walletLabel: string;
  direction: 'in' | 'out';
  amount: number;
  amountUsd: number;
  tokenSymbol: string;
  counterpartyLabel: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface DeFiProtocol {
  name: string;
  slug: string;
  tvl: number;
  tvlChange24h: number;
  category: string;
  chain: string;
  url?: string;
}

export interface LiquidStakingToken {
  name: string;
  symbol: string;
  mint: string;
  tvlSol: number;
  tvlUsd: number;
  apy: number;
  pegDeviation: number;
  validators: number;
  marketShare: number;
}

export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  marketCap: number;
  priceUsd: number;
  bondingProgress: number;
  holders: number;
  volume24h: number;
  createdAt: number;
  isGraduated: boolean;
  replies: number;
}

export interface MevBundle {
  bundleId: string;
  tipLamports: number;
  txCount: number;
  slot: number;
  timestamp: number;
  landedTxCount: number;
  type: 'arb' | 'liquidation' | 'sandwich' | 'backrun' | 'unknown';
}

export interface DePINNode {
  id: string;
  network: 'helium-iot' | 'helium-mobile' | 'render' | 'ionet' | 'hivemapper' | 'grass' | 'geodnet' | 'nosana' | 'shadow' | 'other';
  lat: number;
  lon: number;
  status: 'active' | 'offline' | 'relay';
  rewardToken: string;
  dailyRewards?: number;
  uptimePercent?: number;
}
