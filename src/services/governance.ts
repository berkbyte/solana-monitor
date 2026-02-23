// Governance service — Solana DAO proposal tracking
// Reads ProposalV2 accounts directly from SPL-Governance program on-chain.
// Account type reference (spl-governance v3):
//   ProposalV2 = 14, GovernanceV2 = 18, RealmV2 = 16
//   State: 0=Draft, 1=SigningOff, 2=Voting, 3=Succeeded, 4=Executing, 5=Completed, 6=Cancelled, 7=Defeated

const RPC = 'https://api.mainnet-beta.solana.com';

// SPL-Governance program ID
const GOV_PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';

// Base58 alphabet for single-byte encoding in memcmp filters
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

// Cache realm names so we don't re-fetch them every cycle
const realmNameCache = new Map<string, string>();

// ── Helpers ────────────────────────────────────────────────

/** Encode a single byte as a base58 character for memcmp filters */
function byteToBase58(byte: number): string {
  return B58_ALPHABET[byte] || '1';
}

/** Read u32 LE from buffer */
function readU32(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) return 0;
  return (buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)) >>> 0;
}

/** Read i64 LE from buffer (returns number, safe for timestamps) */
function readI64(buf: Uint8Array, offset: number): number {
  if (offset + 8 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return Number(view.getBigInt64(0, true));
}

/** Read Option<T> — returns [value, bytesConsumed] where value=null if None */
function readOptionI64(buf: Uint8Array, offset: number): [number | null, number] {
  if (offset >= buf.length) return [null, 1];
  if (buf[offset] === 1 && offset + 9 <= buf.length) {
    return [readI64(buf, offset + 1), 9];
  }
  return [null, 1];
}

function readOptionU32(buf: Uint8Array, offset: number): [number | null, number] {
  if (offset >= buf.length) return [null, 1];
  if (buf[offset] === 1 && offset + 5 <= buf.length) {
    return [readU32(buf, offset + 1), 5];
  }
  return [null, 1];
}

/** Convert 32 bytes to base58 pubkey string */
function bytesToBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! * 256;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += B58_ALPHABET[digits[i]!];
  }
  return result;
}

function mapState(state: number): GovernanceProposal['status'] {
  if (state === 2 || state === 1) return 'voting';
  if (state === 3 || state === 4 || state === 5) return 'passed';
  if (state === 7) return 'defeated';
  if (state === 6) return 'cancelled';
  return 'draft';
}

// ── ProposalV2 Parser ──────────────────────────────────────
// ProposalV2 borsh layout (spl-governance v3):
//
// offset 0:    account_type       (u8)   = 14
// offset 1:    governance         (Pubkey, 32 bytes)
// offset 33:   governing_token_mint (Pubkey, 32 bytes)
// offset 65:   state              (u8)
// offset 66:   token_owner_record (Pubkey, 32 bytes)
// offset 98:   signatories_count  (u8)
// offset 99:   signatories_signed_off_count (u8)
// offset 100:  vote_type          (enum: 0=SingleChoice, 1=MultiChoice{u16,u16})
// offset 101+: options            (Vec<ProposalOption>)
//   Each ProposalOption: label(String), vote_weight(u64), vote_result(u8),
//     transactions_executed_count(u16), transactions_count(u16), transactions_next_index(u16)
// then: deny_vote_weight, veto_vote_weight, abstain_vote_weight (Option<u64>)
//       start_voting_at (Option<i64>), draft_at (i64), signing_off_at (Option<i64>)
//       voting_at (Option<i64>), voting_at_slot (Option<u64>)
//       max_vote_weight (Option<u64>), max_voting_time (Option<u32>)
//       vote_threshold (Option<VoteThreshold {u8,u8}>)
//       reserved ([u8; 64])
//       name (String), description_link (String)

interface ParsedProposal {
  pubkey: string;
  governancePubkey: string;
  state: number;
  votesFor: number;
  votesAgainst: number;
  name: string;
  descriptionLink: string;
  votingAt: number;
  maxVotingTime: number;
  draftAt: number;
}

function parseProposalV2(pubkey: string, base64Data: string): ParsedProposal | null {
  try {
    const buf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    if (buf.length < 120) return null;
    if (buf[0] !== 14) return null;

    const governancePubkey = bytesToBase58(buf.slice(1, 33));
    const state = buf[65]!;

    // Parse vote_type
    let cursor = 100;
    const voteTypeTag = buf[cursor]!;
    cursor += 1;
    if (voteTypeTag === 1) cursor += 4; // MultiChoice: max_voter_options(u16) + max_winning_options(u16)

    // Parse options vector
    const optionsCount = readU32(buf, cursor);
    cursor += 4;

    let votesFor = 0;
    for (let i = 0; i < optionsCount && i < 10 && cursor + 12 < buf.length; i++) {
      const labelLen = readU32(buf, cursor); cursor += 4;
      cursor += Math.min(labelLen, 200, buf.length - cursor); // skip label string
      const weight = readI64(buf, cursor); cursor += 8; // vote_weight
      if (i === 0) votesFor = weight;
      cursor += 1;  // vote_result
      cursor += 2;  // transactions_executed_count
      cursor += 2;  // transactions_count
      cursor += 2;  // transactions_next_index
    }

    // deny_vote_weight: Option<u64>
    let votesAgainst = 0;
    { const [val, size] = readOptionI64(buf, cursor); if (val !== null) votesAgainst = val; cursor += size; }
    // veto_vote_weight
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // abstain_vote_weight
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // start_voting_at
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // draft_at: i64
    const draftAt = readI64(buf, cursor); cursor += 8;
    // signing_off_at
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // voting_at: Option<i64>
    let votingAt = 0;
    { const [val, size] = readOptionI64(buf, cursor); if (val !== null) votingAt = val; cursor += size; }
    // voting_at_slot
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // max_vote_weight
    { const [, size] = readOptionI64(buf, cursor); cursor += size; }
    // max_voting_time: Option<u32>
    let maxVotingTime = 0;
    { const [val, size] = readOptionU32(buf, cursor); if (val !== null) maxVotingTime = val; cursor += size; }
    // vote_threshold: Option<VoteThreshold{u8,u8}>
    if (cursor < buf.length && buf[cursor] === 1) cursor += 3; else cursor += 1;
    // reserved: [u8; 64]
    cursor += 64;

    // name: String
    let name = '';
    if (cursor + 4 <= buf.length) {
      const nameLen = readU32(buf, cursor); cursor += 4;
      const clampedLen = Math.min(nameLen, 256, buf.length - cursor);
      if (clampedLen > 0) name = new TextDecoder().decode(buf.slice(cursor, cursor + clampedLen));
      cursor += clampedLen;
    }

    // description_link: String
    let descriptionLink = '';
    if (cursor + 4 <= buf.length) {
      const descLen = readU32(buf, cursor); cursor += 4;
      const clampedLen = Math.min(descLen, 500, buf.length - cursor);
      if (clampedLen > 0) descriptionLink = new TextDecoder().decode(buf.slice(cursor, cursor + clampedLen));
    }

    // Fallback: scan for a readable name string if structured parsing missed it
    if (!name || name.replace(/\0/g, '').trim().length === 0) {
      name = scanForName(buf) || 'Untitled Proposal';
    }

    return {
      pubkey,
      governancePubkey,
      state,
      votesFor: Math.max(0, votesFor),
      votesAgainst: Math.max(0, votesAgainst),
      name: name.replace(/\0/g, '').trim(),
      descriptionLink: descriptionLink.replace(/\0/g, '').trim(),
      votingAt,
      maxVotingTime,
      draftAt,
    };
  } catch {
    return null;
  }
}

/** Fallback: scan account data for a readable string with u32 length prefix */
function scanForName(buf: Uint8Array): string | null {
  const start = Math.max(100, buf.length - 300);
  for (let pos = start; pos < buf.length - 8; pos++) {
    try {
      const len = readU32(buf, pos);
      if (len >= 3 && len < 200 && pos + 4 + len <= buf.length) {
        const str = new TextDecoder().decode(buf.slice(pos + 4, pos + 4 + len));
        if (/^[\x20-\x7E\u00C0-\u024F\u0400-\u04FF]+$/.test(str) && str.length >= 3) {
          return str;
        }
      }
    } catch { /* continue */ }
  }
  return null;
}

// ── RPC Helpers ────────────────────────────────────────────

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ── Fetch Proposals by State ───────────────────────────────

interface RpcAccount {
  pubkey: string;
  account: { data: [string, string] };
}

async function fetchProposalsByState(stateCode: number): Promise<ParsedProposal[]> {
  try {
    const result = await rpcCall('getProgramAccounts', [
      GOV_PROGRAM,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 0, bytes: byteToBase58(14) } },       // ProposalV2
          { memcmp: { offset: 65, bytes: byteToBase58(stateCode) } }, // state
        ],
      },
    ]) as RpcAccount[];

    if (!Array.isArray(result)) return [];

    return result
      .map(acc => parseProposalV2(acc.pubkey, acc.account.data[0]))
      .filter((p): p is ParsedProposal => p !== null);
  } catch (e) {
    console.warn(`[Governance] Failed to fetch proposals (state=${stateCode}):`, e);
    return [];
  }
}

// ── Realm Name Resolution ──────────────────────────────────

async function resolveRealmName(governancePubkey: string): Promise<string> {
  if (realmNameCache.has(governancePubkey)) {
    return realmNameCache.get(governancePubkey)!;
  }

  try {
    // Get governance account — realm pubkey at bytes 1-32
    const govInfo = await rpcCall('getAccountInfo', [
      governancePubkey,
      { encoding: 'base64' },
    ]) as { value: { data: [string, string] } | null };

    if (!govInfo?.value?.data?.[0]) {
      realmNameCache.set(governancePubkey, 'Unknown DAO');
      return 'Unknown DAO';
    }

    const govBuf = Uint8Array.from(atob(govInfo.value.data[0]), c => c.charCodeAt(0));
    if (govBuf.length < 33) {
      realmNameCache.set(governancePubkey, 'Unknown DAO');
      return 'Unknown DAO';
    }

    const realmPubkey = bytesToBase58(govBuf.slice(1, 33));

    if (realmNameCache.has(realmPubkey)) {
      const name = realmNameCache.get(realmPubkey)!;
      realmNameCache.set(governancePubkey, name);
      return name;
    }

    // Get realm account — name is a Borsh String in the data
    const realmInfo = await rpcCall('getAccountInfo', [
      realmPubkey,
      { encoding: 'base64' },
    ]) as { value: { data: [string, string] } | null };

    if (!realmInfo?.value?.data?.[0]) {
      const fallback = realmPubkey.slice(0, 8) + '…';
      realmNameCache.set(governancePubkey, fallback);
      return fallback;
    }

    const realmBuf = Uint8Array.from(atob(realmInfo.value.data[0]), c => c.charCodeAt(0));
    const name = scanForName(realmBuf) || realmPubkey.slice(0, 8) + '…';

    realmNameCache.set(realmPubkey, name);
    realmNameCache.set(governancePubkey, name);
    return name;
  } catch {
    realmNameCache.set(governancePubkey, 'Unknown DAO');
    return 'Unknown DAO';
  }
}

// ── Main Export ────────────────────────────────────────────

export async function fetchGovernanceData(): Promise<GovernanceData> {
  const now = Date.now();
  if (cachedData && now - lastFetch < CACHE_TTL) return cachedData;

  // Fetch voting (state=2) and recently completed (state=3 succeeded, state=7 defeated) proposals
  const [votingProposals, succeededProposals, defeatedProposals] = await Promise.all([
    fetchProposalsByState(2),  // Voting
    fetchProposalsByState(3),  // Succeeded
    fetchProposalsByState(7),  // Defeated
  ]);

  const allParsed = [...votingProposals, ...succeededProposals, ...defeatedProposals];

  // Resolve realm names for unique governance pubkeys (batch with concurrency limit)
  const uniqueGovPubkeys = [...new Set(allParsed.map(p => p.governancePubkey))];
  const keysToResolve = uniqueGovPubkeys.slice(0, 20);

  for (let i = 0; i < keysToResolve.length; i += 5) {
    const batch = keysToResolve.slice(i, i + 5);
    await Promise.allSettled(batch.map(k => resolveRealmName(k)));
  }

  // Build proposal objects
  const proposals: GovernanceProposal[] = allParsed.map(p => {
    const daoName = realmNameCache.get(p.governancePubkey) || 'Unknown DAO';
    const status = mapState(p.state);

    let endDate = 0;
    if (p.votingAt > 0 && p.maxVotingTime > 0) {
      endDate = (p.votingAt + p.maxVotingTime) * 1000;
    } else if (status === 'voting') {
      endDate = Date.now() + 86400000 * 3;
    } else {
      endDate = p.draftAt > 0 ? p.draftAt * 1000 : Date.now() - 86400000;
    }

    const totalVoters = (p.votesFor > 0 || p.votesAgainst > 0) ? p.votesFor + p.votesAgainst : 0;

    return {
      id: p.pubkey,
      title: p.name || 'Untitled Proposal',
      dao: daoName,
      daoSlug: daoName.toLowerCase().replace(/\s+/g, '-'),
      status,
      votesFor: p.votesFor,
      votesAgainst: p.votesAgainst,
      totalVoters,
      quorumReached: status === 'passed' || (totalVoters > 0 && p.votesFor > p.votesAgainst),
      endDate,
      description: p.descriptionLink.slice(0, 300),
      proposer: p.pubkey.slice(0, 12),
      platform: 'spl-governance',
    };
  });

  const activeProposals = proposals
    .filter(p => p.status === 'voting')
    .sort((a, b) => a.endDate - b.endDate);

  const recentPassed = proposals
    .filter(p => p.status === 'passed' || p.status === 'defeated')
    .sort((a, b) => b.endDate - a.endDate)
    .slice(0, 10);

  const uniqueDaos = new Set(proposals.map(p => p.dao));

  const result: GovernanceData = {
    activeProposals: activeProposals.slice(0, 25),
    recentPassed,
    totalDaos: uniqueDaos.size,
  };

  if (proposals.length > 0) {
    cachedData = result;
    lastFetch = now;
  }

  return result;
}