// Governance service — Solana DAO proposal tracking
// Reads ProposalV2 accounts directly from SPL-Governance program on-chain.
//
// Account type reference (spl-governance v3):
//   ProposalV2 = 14, GovernanceV2 = 18, RealmV2 = 16
//   State: 0=Draft, 1=SigningOff, 2=Voting, 3=Succeeded, 4=Executing,
//          5=Completed, 6=Cancelled, 7=Defeated

// Use Helius RPC (private, better rate limits + getProgramAccounts support)
// Fallback to public Solana RPC
const RPC =
  import.meta.env.VITE_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';

// SPL-Governance program ID
const GOV_PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';

// Base58 alphabet for single-byte encoding in memcmp filters
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ── Public Types ───────────────────────────────────────────

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

// ── Cache ──────────────────────────────────────────────────

let cachedData: GovernanceData | null = null;
let lastFetch = 0;
const CACHE_TTL = 300_000; // 5 min

// Realm name cache: governance-pubkey → name (persists across fetches)
const realmNameCache = new Map<string, string>();

// ── Binary Helpers ─────────────────────────────────────────

function readU32(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

function readI64(buf: Uint8Array, off: number): number {
  if (off + 8 > buf.length) return 0;
  return Number(new DataView(buf.buffer, buf.byteOffset + off, 8).getBigInt64(0, true));
}

function readOptionI64(buf: Uint8Array, off: number): [number | null, number] {
  if (off >= buf.length) return [null, 1];
  if (buf[off] === 1 && off + 9 <= buf.length) return [readI64(buf, off + 1), 9];
  return [null, 1];
}

function readOptionU32(buf: Uint8Array, off: number): [number | null, number] {
  if (off >= buf.length) return [null, 1];
  if (buf[off] === 1 && off + 5 <= buf.length) return [readU32(buf, off + 1), 5];
  return [null, 1];
}

/** Convert 32 bytes to base58 pubkey string */
function toBase58(bytes: Uint8Array): string {
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
  for (let i = digits.length - 1; i >= 0; i--) result += B58[digits[i]!];
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
//
// ProposalV2 borsh layout (spl-governance v3):
//   0:   account_type (u8) = 14
//   1:   governance (Pubkey, 32 bytes)
//  33:   governing_token_mint (Pubkey, 32 bytes)
//  65:   state (u8)
//  66:   token_owner_record (Pubkey, 32 bytes)
//  98:   signatories_count (u8)
//  99:   signatories_signed_off_count (u8)
// 100:   vote_type (enum: 0=SingleChoice, 1=MultiChoice{u16,u16})
// 101+:  options (Vec<ProposalOption>)
//   option: label(String) + vote_weight(u64) + vote_result(u8) + txs(3×u16)
// then:  deny_vote_weight, veto, abstain (Option<u64> each)
//        start_voting_at, draft_at(i64), signing_off_at, voting_at, voting_at_slot,
//        max_vote_weight, max_voting_time(Option<u32>), vote_threshold(Option)
//        reserved([64]), name(String), description_link(String)

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
    if (buf.length < 120 || buf[0] !== 14) return null;

    const governancePubkey = toBase58(buf.slice(1, 33));
    const state = buf[65]!;

    // vote_type
    let cursor = 100;
    if (buf[cursor] === 1) cursor += 5; // MultiChoice: tag + u16 + u16
    else cursor += 1;

    // options vector
    const optionsCount = readU32(buf, cursor);
    cursor += 4;

    let votesFor = 0;
    for (let i = 0; i < optionsCount && i < 10 && cursor + 12 < buf.length; i++) {
      const labelLen = readU32(buf, cursor); cursor += 4;
      cursor += Math.min(labelLen, 200, buf.length - cursor);
      const weight = readI64(buf, cursor); cursor += 8;
      if (i === 0) votesFor = weight;
      cursor += 1;  // vote_result
      cursor += 6;  // 3 × u16
    }

    // deny_vote_weight
    let votesAgainst = 0;
    { const [v, s] = readOptionI64(buf, cursor); if (v !== null) votesAgainst = v; cursor += s; }
    // veto_vote_weight
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // abstain_vote_weight
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // start_voting_at
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // draft_at: i64
    const draftAt = readI64(buf, cursor); cursor += 8;
    // signing_off_at
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // voting_at
    let votingAt = 0;
    { const [v, s] = readOptionI64(buf, cursor); if (v !== null) votingAt = v; cursor += s; }
    // voting_at_slot
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // max_vote_weight
    { const [, s] = readOptionI64(buf, cursor); cursor += s; }
    // max_voting_time
    let maxVotingTime = 0;
    { const [v, s] = readOptionU32(buf, cursor); if (v !== null) maxVotingTime = v; cursor += s; }
    // vote_threshold: Option<VoteThreshold{u8,u8}>
    if (cursor < buf.length && buf[cursor] === 1) cursor += 3; else cursor += 1;
    // reserved: [u8; 64]
    cursor += 64;

    // name: String (borsh: u32 length-prefix + utf8)
    let name = '';
    if (cursor + 4 <= buf.length) {
      const len = readU32(buf, cursor); cursor += 4;
      const cl = Math.min(len, 256, buf.length - cursor);
      if (cl > 0) name = new TextDecoder().decode(buf.slice(cursor, cursor + cl));
      cursor += cl;
    }

    // description_link: String
    let descriptionLink = '';
    if (cursor + 4 <= buf.length) {
      const len = readU32(buf, cursor); cursor += 4;
      const cl = Math.min(len, 500, buf.length - cursor);
      if (cl > 0) descriptionLink = new TextDecoder().decode(buf.slice(cursor, cursor + cl));
    }

    // Fallback name scan if structured parse missed it
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

/** Fallback: scan for a readable string with u32 length prefix in the tail */
function scanForName(buf: Uint8Array): string | null {
  const start = Math.max(100, buf.length - 300);
  for (let pos = start; pos < buf.length - 8; pos++) {
    const len = readU32(buf, pos);
    if (len >= 3 && len < 200 && pos + 4 + len <= buf.length) {
      try {
        const str = new TextDecoder().decode(buf.slice(pos + 4, pos + 4 + len));
        if (/^[\x20-\x7E\u00C0-\u024F\u0400-\u04FF]+$/.test(str) && str.length >= 3) return str;
      } catch { /* continue */ }
    }
  }
  return null;
}

// ── RPC Helpers ────────────────────────────────────────────

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ── Fetch Proposals ────────────────────────────────────────

interface RpcAccount {
  pubkey: string;
  account: { data: [string, string] };
}

/**
 * Fetch ProposalV2 accounts by on-chain state code.
 * Uses memcmp filters: offset 0 = account_type 14, offset 65 = state byte.
 */
async function fetchProposalsByState(stateCode: number): Promise<ParsedProposal[]> {
  try {
    const result = await rpcCall('getProgramAccounts', [
      GOV_PROGRAM,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 0, bytes: B58[14] } },            // ProposalV2
          { memcmp: { offset: 65, bytes: B58[stateCode] } },    // state
        ],
      },
    ]) as RpcAccount[];

    if (!Array.isArray(result)) return [];
    return result
      .map(acc => parseProposalV2(acc.pubkey, acc.account.data[0]))
      .filter((p): p is ParsedProposal => p !== null);
  } catch (e) {
    console.warn(`[Governance] fetchProposalsByState(${stateCode}) failed:`, e);
    return [];
  }
}

// ── Batch Realm Name Resolution ────────────────────────────
// Uses getMultipleAccounts (up to 100 per call) to resolve names in 2 RPC
// calls instead of 40+ sequential calls.

async function resolveRealmNames(governancePubkeys: string[]): Promise<void> {
  // Only resolve keys we don't already have cached
  const toResolve = governancePubkeys.filter(k => !realmNameCache.has(k));
  if (toResolve.length === 0) return;

  const batch = toResolve.slice(0, 50); // cap at 50 governance accounts

  try {
    // Step 1: Fetch governance accounts to extract realm pubkeys
    const govResult = await rpcCall('getMultipleAccounts', [
      batch,
      { encoding: 'base64' },
    ]) as { value: Array<{ data: [string, string] } | null> };

    if (!govResult?.value) return;

    // Map governance pubkey → realm pubkey
    const govToRealm = new Map<string, string>();
    const realmPubkeys: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const acct = govResult.value[i];
      if (!acct?.data?.[0]) {
        realmNameCache.set(batch[i]!, 'Unknown DAO');
        continue;
      }
      try {
        const buf = Uint8Array.from(atob(acct.data[0]), c => c.charCodeAt(0));
        if (buf.length < 33) { realmNameCache.set(batch[i]!, 'Unknown DAO'); continue; }
        const realmPubkey = toBase58(buf.slice(1, 33));
        govToRealm.set(batch[i]!, realmPubkey);
        if (!realmNameCache.has(realmPubkey)) realmPubkeys.push(realmPubkey);
      } catch {
        realmNameCache.set(batch[i]!, 'Unknown DAO');
      }
    }

    // Step 2: Fetch realm accounts to extract names
    const uniqueRealms = [...new Set(realmPubkeys)].slice(0, 100);
    if (uniqueRealms.length > 0) {
      const realmResult = await rpcCall('getMultipleAccounts', [
        uniqueRealms,
        { encoding: 'base64' },
      ]) as { value: Array<{ data: [string, string] } | null> };

      if (realmResult?.value) {
        for (let i = 0; i < uniqueRealms.length; i++) {
          const acct = realmResult.value[i];
          const pk = uniqueRealms[i]!;
          if (!acct?.data?.[0]) {
            realmNameCache.set(pk, pk.slice(0, 8) + '…');
            continue;
          }
          try {
            const buf = Uint8Array.from(atob(acct.data[0]), c => c.charCodeAt(0));
            // RealmV2: type(u8) + community_mint(32) then immediately name(String: u32 + utf8)
            // Offset 33: name length
            let name: string | null = null;
            if (buf.length > 37) {
              const nameLen = readU32(buf, 33);
              if (nameLen > 0 && nameLen < 200 && 37 + nameLen <= buf.length) {
                name = new TextDecoder().decode(buf.slice(37, 37 + nameLen));
              }
            }
            if (!name || name.replace(/\0/g, '').trim().length === 0) {
              name = scanForName(buf);
            }
            realmNameCache.set(pk, name?.trim() || pk.slice(0, 8) + '…');
          } catch {
            realmNameCache.set(pk, pk.slice(0, 8) + '…');
          }
        }
      }
    }

    // Step 3: Propagate realm names to governance pubkeys
    for (const [govPk, realmPk] of govToRealm) {
      realmNameCache.set(govPk, realmNameCache.get(realmPk) || realmPk.slice(0, 8) + '…');
    }
  } catch (e) {
    console.warn('[Governance] Batch realm resolution failed:', e);
    // Set fallback names so we don't retry
    for (const k of batch) {
      if (!realmNameCache.has(k)) realmNameCache.set(k, 'Unknown DAO');
    }
  }
}

// ── Main Export ────────────────────────────────────────────

export async function fetchGovernanceData(): Promise<GovernanceData> {
  const now = Date.now();
  if (cachedData && now - lastFetch < CACHE_TTL) return cachedData;

  console.log('[Governance] Fetching proposals…');

  // Fetch only Voting (active) + Executing (recently passed) proposals.
  // Succeeded=1,872 / Defeated=2,305 / Completed=13,464 are too many to
  // fetch from the RPC without a dedicated indexer. Voting~554, Executing~117.
  const [votingProposals, executingProposals] = await Promise.all([
    fetchProposalsByState(2),  // Voting
    fetchProposalsByState(4),  // Executing (approved & running)
  ]);

  console.log(`[Governance] Voting: ${votingProposals.length}, Executing: ${executingProposals.length}`);

  const allParsed = [...votingProposals, ...executingProposals];

  // Resolve realm names via batched getMultipleAccounts (2 calls instead of 40+)
  const uniqueGovPubkeys = [...new Set(allParsed.map(p => p.governancePubkey))];
  await resolveRealmNames(uniqueGovPubkeys);

  // Filter stale voting proposals (voting started > 90 days ago = probably abandoned)
  const NINETY_DAYS_S = 90 * 86400;
  const nowS = now / 1000;

  const proposals: GovernanceProposal[] = allParsed
    .filter(p => {
      // Keep if recently created (draft < 90 days) or recently voted on
      if (p.state === 2 && p.votingAt > 0 && (nowS - p.votingAt) > NINETY_DAYS_S) return false;
      if (p.state === 2 && p.votingAt === 0 && p.draftAt > 0 && (nowS - p.draftAt) > NINETY_DAYS_S) return false;
      return true;
    })
    .map(p => {
      const daoName = realmNameCache.get(p.governancePubkey) || 'Unknown DAO';
      const status = mapState(p.state);

      let endDate = 0;
      if (p.votingAt > 0 && p.maxVotingTime > 0) {
        endDate = (p.votingAt + p.maxVotingTime) * 1000;
      } else if (status === 'voting') {
        endDate = now + 86400000 * 3;
      } else {
        endDate = p.draftAt > 0 ? p.draftAt * 1000 : now - 86400000;
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
    .sort((a, b) => {
      // Sort by total votes desc (most active first), then by endDate asc
      const votesDiff = b.totalVoters - a.totalVoters;
      if (votesDiff !== 0) return votesDiff;
      return a.endDate - b.endDate;
    });

  const recentPassed = proposals
    .filter(p => p.status === 'passed')
    .sort((a, b) => b.endDate - a.endDate)
    .slice(0, 10);

  const uniqueDaos = new Set(proposals.map(p => p.dao));

  const result: GovernanceData = {
    activeProposals: activeProposals.slice(0, 30),
    recentPassed,
    totalDaos: uniqueDaos.size,
  };

  console.log(`[Governance] Active: ${result.activeProposals.length}, Passed: ${result.recentPassed.length}, DAOs: ${result.totalDaos}`);

  if (proposals.length > 0) {
    cachedData = result;
    lastFetch = now;
  }

  return result;
}
