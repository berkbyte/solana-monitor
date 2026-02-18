// Configuration exports — Solana Terminal

// Variant (always 'full')
export { SITE_VARIANT } from './variant';

// Shared base configuration (always included)
export {
  API_URLS,
  REFRESH_INTERVALS,
  STORAGE_KEYS,
} from './variants/base';

// Market data (shared — crypto markets, sectors, commodities)
export { SECTORS, COMMODITIES, MARKET_SYMBOLS, CRYPTO_MAP } from './markets';

// Solana feeds configuration
export {
  FEEDS,
  INTEL_SOURCES,
  SOURCE_TIERS,
  getSourceTier,
  SOURCE_TYPES,
  getSourceType,
  getSourcePropagandaRisk,
  ALERT_KEYWORDS,
  ALERT_EXCLUSIONS,
  type SourceRiskProfile,
  type SourceType,
} from './solana-feeds';

// Legacy feeds — kept for now, will be removed
// (removing duplicate exports from legacy feeds module)

// Panel configuration
export {
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
} from './panels';
