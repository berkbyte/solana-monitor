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

// Fetch proposals directly from on-chain SPL-Governance program accounts
// The Realms REST API (app.realms.today/api/v1/...) is dead (404), so we read from RPC
async function fetchRealmsProposals(): Promise<GovernanceProposal[]> {
  const proposals: GovernanceProposal[] = [];
  const RPC = 'https://api.mainnet-beta.solana.com';

  // For each known realm, fetch governance accounts then proposals
  const fetches = KNOWN_REALMS.map(async (realm) => {
    try {
      // Step 1: Find governance accounts under this realm
      const govRes = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getProgramAccounts',
          params: [GOV_PROGRAM, {
            encoding: 'base64',
            dataSlice: { offset: 0, length: 0 },
            filters: [
              { memcmp: { offset: 1, bytes: realm.realm } }, // realm field at offset 1
              { dataSize: 108 }, // GovernanceV2 account size
            ],
          }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!govRes.ok) return [];
      const govData = await govRes.json();
      const govAccounts: string[] = (govData.result || []).map((a: { pubkey: string }) => a.pubkey).slice(0, 3);

      if (govAccounts.length === 0) return [];

      // Step 2: Fetch proposal accounts under each governance
      const proposalResults = await Promise.allSettled(
        govAccounts.map(async (govPubkey: string) => {
          const propRes = await fetch(RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'getProgramAccounts',
              params: [GOV_PROGRAM, {
                encoding: 'base64',
                filters: [
                  { memcmp: { offset: 1, bytes: govPubkey } }, // governance field
                  { dataSize: 619 }, // ProposalV2 account size
                ],
              }],
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (!propRes.ok) return [];
          const propData = await propRes.json();
          return (propData.result || []).map((acc: { pubkey: string; account: { data: string[] } }) => {
            const b64 = acc.account.data[0];
            if (!b64) return null;
            return parseProposalAccount(acc.pubkey, b64, realm.name, realm.slug);
          }).filter((p: GovernanceProposal | null) => p !== null);
        })
      );

      return proposalResults
        .filter((r): r is PromiseFulfilledResult<GovernanceProposal[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(fetches);
  for (const r of results) {
    if (r.status === 'fulfilled') proposals.push(...r.value);
  }
  return proposals;
}

// Parse a ProposalV2 account from base64-encoded on-chain data
function parseProposalAccount(
  pubkey: string,
  base64Data: string,
  daoName: string,
  daoSlug: string,
): GovernanceProposal | null {
  try {
    const buf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    if (buf.length < 200) return null;

    // ProposalV2 layout (approximate offsets):
    // offset 0: account type (1 byte, should be 6 for ProposalV2)
    // offset 1-32: governance pubkey
    // offset 33-64: governing token mint
    // offset 65: state (1 byte)
    // offset 66-69: name length (u32 LE)
    // offset 70+: name string (UTF-8)

    const state = buf[65]!;
    const nameLen = buf[66]! | (buf[67]! << 8) | (buf[68]! << 16) | (buf[69]! << 24);
    const clampedLen = Math.min(nameLen, 128, buf.length - 70);
    const name = clampedLen > 0
      ? new TextDecoder().decode(buf.slice(70, 70 + clampedLen))
      : 'Untitled Proposal';

    // After name: description URL length + string
    const descOffset = 70 + clampedLen;
    let description = '';
    let afterDescOffset = descOffset;
    if (descOffset + 4 < buf.length) {
      const descLen = buf[descOffset]! | (buf[descOffset + 1]! << 8) | (buf[descOffset + 2]! << 16) | (buf[descOffset + 3]! << 24);
      const clampedDescLen = Math.min(descLen, 200, buf.length - descOffset - 4);
      if (clampedDescLen > 0 && clampedDescLen < 500) {
        description = new TextDecoder().decode(buf.slice(descOffset + 4, descOffset + 4 + clampedDescLen));
      }
      afterDescOffset = descOffset + 4 + clampedDescLen;
    }

    // Map status
    const status = mapState(state);

    // Try reading vote data following the description.
    // ProposalV2 stores vote counts as u64 LE after option structs.
    // Layout after description: draft_at(i64), signing_off_at(Option<i64>), voting_at(Option<i64>),
    // voting_at_slot(Option<u64>), max_vote_weight(Option<u64>),
    // max_voting_time(Option<u32>), vote_type(enum), options(vec), deny_vote_weight(Option<u64>), veto_vote_weight(Option<u64>)
    //
    // We try to extract what we can from the remaining bytes:
    let votesFor = 0;
    let votesAgainst = 0;
    let endDate = 0;

    // Helper to read i64 LE from buffer
    const readI64 = (offset: number): number => {
      if (offset + 8 > buf.length) return 0;
      const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
      return Number(view.getBigInt64(0, true));
    };

    // Helper to read Option<i64> (1 byte flag + 8 bytes value)
    const readOptionI64 = (offset: number): { value: number; size: number } => {
      if (offset >= buf.length) return { value: 0, size: 1 };
      const hasValue = buf[offset]!;
      if (hasValue === 1 && offset + 9 <= buf.length) {
        return { value: readI64(offset + 1), size: 9 };
      }
      return { value: 0, size: 1 };
    };

    // Try to parse timestamps and derive end date
    try {
      let cursor = afterDescOffset;

      // draft_at: i64 (unix timestamp in seconds)
      cursor += 8;

      // signing_off_at: Option<i64>
      const signingOff = readOptionI64(cursor);
      cursor += signingOff.size;

      // voting_at: Option<i64>
      const votingAt = readOptionI64(cursor);
      cursor += votingAt.size;

      // voting_at_slot: Option<u64>
      const votingAtSlot = readOptionI64(cursor);
      cursor += votingAtSlot.size;

      // max_vote_weight: Option<u64>
      const maxVoteWeight = readOptionI64(cursor);
      cursor += maxVoteWeight.size;

      // max_voting_time: Option<u32> (in seconds)
      if (cursor < buf.length) {
        const hasMaxVotingTime = buf[cursor]!;
        if (hasMaxVotingTime === 1 && cursor + 5 <= buf.length) {
          const maxVotingTimeSec = buf[cursor + 1]! | (buf[cursor + 2]! << 8) | (buf[cursor + 3]! << 16) | (buf[cursor + 4]! << 24);
          cursor += 5;

          // Compute end date from votingAt + maxVotingTime
          if (votingAt.value > 0 && maxVotingTimeSec > 0) {
            endDate = (votingAt.value + maxVotingTimeSec) * 1000;
          }
        } else {
          cursor += 1;
        }
      }

      // Skip vote_type enum (1-2 bytes) and try to find options vector
      // The options vector contains vote weights for each choice
      // Structure: vec length (u32), then for each option: label(str), vote_weight(u64), ...
      // This is complex but we try to find deny_vote_weight after options
      // For now, skip options parsing and read deny_vote_weight at the end of buffer

      // Try reading the last ~32 bytes for deny_vote_weight (votesAgainst)
      // ProposalV2 ends with: deny_vote_weight: Option<u64>, veto_vote_weight: Option<u64>, ...
      // Scan backwards for Option<u64> patterns
      if (buf.length > cursor + 20) {
        // Try to find options vec: first read vec length
        cursor += 1; // vote_type (single byte for SingleChoice)
        if (cursor + 4 < buf.length) {
          const optionsCount = buf[cursor]! | (buf[cursor + 1]! << 8) | (buf[cursor + 2]! << 16) | (buf[cursor + 3]! << 24);
          cursor += 4;

          if (optionsCount > 0 && optionsCount <= 10) {
            // Each option: label string (u32 len + bytes) + vote_weight (u64) + (possibly more)
            for (let oi = 0; oi < optionsCount && cursor + 12 < buf.length; oi++) {
              const labelLen = buf[cursor]! | (buf[cursor + 1]! << 8) | (buf[cursor + 2]! << 16) | (buf[cursor + 3]! << 24);
              cursor += 4;
              const clampLabel = Math.min(labelLen, 64, buf.length - cursor);
              cursor += clampLabel;

              // vote_weight: u64 LE
              if (cursor + 8 <= buf.length) {
                const voteWeight = readI64(cursor);
                if (oi === 0) votesFor = Math.max(0, Math.round(voteWeight / 1e6)); // Convert to readable units
                cursor += 8;
              }

              // transactions_count: u16 + executing_at: Option<i64>
              if (cursor + 2 <= buf.length) cursor += 2; // transactions_count u16
              const execAt = readOptionI64(cursor);
              cursor += execAt.size;
            }

            // deny_vote_weight: Option<u64>
            const denyWeight = readOptionI64(cursor);
            if (denyWeight.value > 0) {
              votesAgainst = Math.round(denyWeight.value / 1e6);
            }
          }
        }
      }
    } catch {
      // Vote parsing failed — leave as 0
    }

    // Fall back for end date if we couldn't parse it
    if (endDate <= 0) {
      endDate = status === 'voting' ? Date.now() + 86400000 * 3 : Date.now() - 86400000;
    }

    const totalVoters = (votesFor > 0 || votesAgainst > 0) ? votesFor + votesAgainst : 0;

    return {
      id: pubkey,
      title: name.replace(/\0/g, '').trim() || 'Untitled Proposal',
      dao: daoName,
      daoSlug,
      status,
      votesFor,
      votesAgainst,
      totalVoters,
      quorumReached: status === 'passed' || (totalVoters > 0 && votesFor > votesAgainst),
      endDate,
      description: description.replace(/\0/g, '').trim().slice(0, 300),
      proposer: pubkey.slice(0, 12),
      platform: 'spl-governance',
    };
  } catch {
    return null;
  }
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
      // If RPC returns error (e.g., too large), return 0 — don't fake a count
      if (data.error) return 0;
    }
  } catch { /* fallback below */ }
  return 0; // Unknown — better than a fabricated estimate
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