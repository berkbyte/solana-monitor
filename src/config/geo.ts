// Solana Terminal - geo data stubs (original geopolitical data removed)
// These empty arrays satisfy imports from country-instability.ts and other legacy services
interface Hotspot {
  id: string; name: string; lat: number; lon: number; keywords: string[];
  subtext?: string; location?: string; agencies?: string[];
  level?: 'low' | 'elevated' | 'high'; description?: string; status?: string;
  escalationScore?: number; escalationTrend?: string; escalationIndicators?: string[];
  history?: unknown; whyItMatters?: string;
}
interface ConflictZone {
  id: string; name: string; coords: [number, number][]; center: [number, number];
  intensity?: 'high' | 'medium' | 'low'; parties?: string[]; casualties?: string;
  displaced?: string; keywords?: string[]; startDate?: string; location?: string;
  description?: string; keyDevelopments?: string[];
}
interface StrategicWaterway {
  id: string; name: string; lat: number; lon: number; description?: string;
}
export const INTEL_HOTSPOTS: Hotspot[] = [];
export const CONFLICT_ZONES: ConflictZone[] = [];
export const STRATEGIC_WATERWAYS: StrategicWaterway[] = [];
export const UNDERSEA_CABLES: never[] = [];
export const NUCLEAR_FACILITIES: never[] = [];
export const APT_GROUPS: never[] = [];
export const ECONOMIC_CENTERS: never[] = [];
export const SPACEPORTS: never[] = [];
export const CRITICAL_MINERAL_PROJECTS: never[] = [];
