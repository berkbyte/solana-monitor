// Governance service — Solana DAO proposal tracking
// Fetches real proposals from Realms governance API + Solana RPC

export interface GovernanceProposal {
  id: string;
  title: string;
  dao: string;
  daoSlug: string;
  status: 'voting' | 'passed' | 'defeated' | 'cancelled' | 'draft';
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  quorumReached: boolean;
  endDate: number;
  description: string;
  proposer: string;
  platform: 'realms' | 'squads' | 'spl-governance' | 'other';
}

export interface GovernanceData {
  activeProposals: GovernanceProposal[];
  recentPassed: GovernanceProposal[];
  totalDaos: number;
}

let cachedData: GovernanceData | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Well-known Solana DAO Realms with their on-chain governance pubkeys
const KNOWN_REALMS: { slug: string; name: string; realm: string }[] = [
  { slug: 'jupiter', name: 'Jupiter DAO', realm: 'GCPbr2FjyPzjFTbzDYmqgPhYY5bkHi98jQQZXiXWghZE' },
  { slug: 'jito-governance', name: 'Jito Governance', realm: 'GVXRSBjFk6e6J3NbVPXmhM5DdsM36Bbku9oC1EcQhFAL' },
  { slug: 'marinade', name: 'Marinade Finance', realm: '6zGfRiFSaPwT2BvBk6k1RQNfGeaPDqUwyFp5sKTxQS4y' },
  { slug: 'pyth-network', name: 'Pyth Network', realm: 'pytS9TjG1qyAZypk7n8rw8gfW9sUaqqYyMhJQ4E7JCQ' },
  { slug: 'mango-dao', name: 'Mango DAO', realm: 'DPiH3H3c7t47BMxqTxLsuPQpEC6Kne8GA9VXbxpnZxFE' },
  { slug: 'helium', name: 'Helium', realm: 'hpbHLJ6mbTFWg8hRt9LScWK7sZT4FEHqKs82PPLPBiQ' },
];

// SPL-Governance program ID
const GOV_PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';

// Map proposal state byte to status
function mapState(state: number): GovernanceProposal['status'] {
  // 0=Draft, 1=SigningOff, 2=Voting, 3=Succeeded, 4=Executing, 5=Completed, 6=Cancelled, 7=Defeated
  if (state === 2 || state === 1) return 'voting';
  if (state === 3 || state === 4 || state === 5) return 'passed';
  if (state === 7) return 'defeated';
  if (state === 6) return 'cancelled';
  return 'draft';
}

// Fetch proposals directly from Realms REST API (Governance UI backend)
async function fetchRealmsProposals(): Promise<GovernanceProposal[]> {
  const proposals: GovernanceProposal[] = [];

  // Try aggregated Realms Hub API
  try {
    const res = await fetch(
      'https://app.realms.today/api/v1/proposals?limit=30',
      { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      const items: Record<string, unknown>[] = Array.isArray(data) ? data : data.proposals || data.data || [];
      for (const p of items) {
        proposals.push(parseRealmItem(p));
      }
      if (proposals.length > 3) return proposals;
    }
  } catch { /* fallback below */ }

  // Fallback: fetch per-realm from Realms v2 REST
  const fetches = KNOWN_REALMS.slice(0, 6).map(async (realm) => {
    try {
      const res = await fetch(
        `https://app.realms.today/api/v1/realm/${realm.slug}/proposals?limit=5`,
        { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return [];
      const data = await res.json();
      const items: Record<string, unknown>[] = Array.isArray(data) ? data : data.proposals || data.data || [];
      return items.map((p) => parseRealmItem(p, realm.name, realm.slug));
    } catch { return []; }
  });

  const results = await Promise.allSettled(fetches);
  for (const r of results) {
    if (r.status === 'fulfilled') proposals.push(...r.value);
  }
  return proposals;
}

function parseRealmItem(
  p: Record<string, unknown>,
  defaultDao?: string,
  defaultSlug?: string
): GovernanceProposal {
  const yesVotes = Number(p.yesVotesCount || p.votesFor || p.yes_votes || 0);
  const noVotes = Number(p.noVotesCount || p.votesAgainst || p.no_votes || 0);
  const voters = Number(p.totalVoters || p.voterCount || 0) || Math.max(1, Math.floor((yesVotes + noVotes) / 1000));
  const endTs = p.votingEndedAt || p.endDate || p.voting_ended_at;
  const endDate = endTs ? new Date(endTs as string | number).getTime() : Date.now() + 86400000 * 3;

  return {
    id: String(p.pubkey || p.id || p.proposalId || `p-${Date.now()}`),
    title: String(p.name || p.title || 'Untitled Proposal'),
    dao: String(p.realmName || p.dao || p.realm || defaultDao || 'Unknown DAO'),
    daoSlug: String(p.realmSlug || p.daoSlug || defaultSlug || 'unknown'),
    status: typeof p.state === 'number' ? mapState(p.state) : mapState(2),
    votesFor: yesVotes,
    votesAgainst: noVotes,
    totalVoters: voters,
    quorumReached: Boolean(p.quorumReached ?? (yesVotes > noVotes * 2)),
    endDate: typeof endDate === 'number' && endDate > 0 ? endDate : Date.now() + 86400000,
    description: String(p.description || p.descriptionLink || '').slice(0, 300),
    proposer: String(p.tokenOwnerRecord || p.proposer || p.authority || '').slice(0, 12) || 'Unknown',
    platform: 'realms',
  };
}

// Count DAOs using SPL-Governance program accounts
async function fetchDaoCount(): Promise<number> {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getProgramAccounts',
        params: [GOV_PROGRAM, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: 619 }] }]
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) return data.result.length;
    }
  } catch { /* fallback below */ }
  return 0;
}

export async function fetchGovernanceData(): Promise<GovernanceData> {
  const now = Date.now();
  if (cachedData && now - lastFetch < CACHE_TTL) return cachedData;

  const [proposalsResult, daoCountResult] = await Promise.allSettled([
    fetchRealmsProposals(),
    fetchDaoCount(),
  ]);

  const allProposals = proposalsResult.status === 'fulfilled' ? proposalsResult.value : [];
  const totalDaos = daoCountResult.status === 'fulfilled' && daoCountResult.value > 0 ? daoCountResult.value : 0;

  const activeProposals = allProposals
    .filter(p => p.status === 'voting')
    .sort((a, b) => a.endDate - b.endDate);

  const recentPassed = allProposals
    .filter(p => p.status === 'passed' || p.status === 'defeated')
    .sort((a, b) => b.endDate - a.endDate);

  const result: GovernanceData = {
    activeProposals: activeProposals.slice(0, 15),
    recentPassed: recentPassed.slice(0, 10),
    totalDaos: totalDaos || (allProposals.length > 0 ? KNOWN_REALMS.length : 0),
  };

  if (allProposals.length > 0 || totalDaos > 0) {
    cachedData = result;
    lastFetch = now;
  }

  return result;
}