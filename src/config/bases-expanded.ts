// Solana Terminal - military bases stub (geo data removed)
interface MilitaryBase {
  id: string; name: string; lat: number; lon: number;
  type: string; description?: string; country?: string;
  arm?: string; status?: string; source?: string;
}
export const MILITARY_BASES_EXPANDED: MilitaryBase[] = [];
