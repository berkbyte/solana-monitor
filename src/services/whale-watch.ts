// Whale Watch service — track large wallet movements on Solana
// Uses public Solana RPC (free, no API key) with Helius as optional upgrade

const HELIUS_RPC = import.meta.env.VITE_HELIUS_RPC_URL || '';

// Public RPCs — free, no key needed
const PUBLIC_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
];

function getRpcUrl(): string {
  if (HELIUS_RPC) return HELIUS_RPC;
  return PUBLIC_RPCS[Math.floor(Math.random() * PUBLIC_RPCS.length)]!;
}

// Rough SOL price cache (updated from CoinGecko)
let cachedSolPrice = 150;
let solPriceLastFetch = 0;

async function fetchSolPrice(): Promise<number> {
  if (Date.now() - solPriceLastFetch < 60_000) return cachedSolPrice;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      cachedSolPrice = data?.solana?.usd ?? cachedSolPrice;
      solPriceLastFetch = Date.now();
    }
  } catch { /* keep cached */ }
  return cachedSolPrice;
}

export interface WhaleTransaction {
  signature: string;
  type: 'transfer' | 'swap' | 'stake' | 'nft_trade' | 'dex_trade' | 'defi' | 'unknown';
  wallet: string;
  walletLabel: string;
  direction: 'in' | 'out';
  amount: number;
  amountUsd: number;
  tokenSymbol: string;
  tokenMint: string;
  counterparty: string;
  counterpartyLabel: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface WatchedWallet {
  address: string;
  label: string;
  tags: string[];
  totalBalance: number;
  lastActivity: number;
}

// Known whale wallets and labels (CEX + DEX + DeFi protocols)
export const KNOWN_WALLETS: Record<string, string> = {
  // CEX Hot Wallets
  '5tzFkiKscjHK3gXGjaGRb8Ntz9GTCLbF14eMFxcU6KGo': 'Binance Hot',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance',
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': 'FTX Estate',
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Coinbase',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase Prime',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Kraken',
  // DEX Protocols
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
  'CAMMCzo5YL8w4VFF8KVHr7UfmqhJeHhHczTb6h4eRgD': 'Raydium CLMM',
  // DeFi Protocols
  'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1': 'Marinade Finance',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'Jito SOL',
  'KAMi4bsMRCJGLAMF4uH6JqxWhAZHhm5KyWBkHjD1XHP': 'Kamino Finance',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'MarginFi',
  'DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW': 'Drift Protocol',
  // Market Makers & Trading Firms
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1': 'Wintermute',
  'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq': 'Jump Trading',
  'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK': 'Alameda',
  '3yFwqXBfZY4jBVUafQ1YEXw189y2dN3V5KQq9uzBDy1E': 'MER Treasury',
  // Staking
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'Marinade mSOL',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 'BlazeStake bSOL',
};

const WHALE_THRESHOLDS = {
  low: 10_000,      // $10K — catch more whale activity
  medium: 100_000,
  high: 500_000,
  critical: 2_000_000,
};

let whaleHistory: WhaleTransaction[] = [];
const MAX_HISTORY = 500;
let lastFetch = 0;
const CACHE_TTL = 10_000;
let heliusFailed = false;

export function classifyWhaleTransaction(amountUsd: number): WhaleTransaction['severity'] {
  if (amountUsd >= WHALE_THRESHOLDS.critical) return 'critical';
  if (amountUsd >= WHALE_THRESHOLDS.high) return 'high';
  if (amountUsd >= WHALE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getWalletLabel(address: string): string {
  return KNOWN_WALLETS[address] || `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getHeliusApiKey(): string | null {
  if (!HELIUS_RPC) return null;
  try {
    const url = new URL(HELIUS_RPC);
    return url.searchParams.get('api-key') || null;
  } catch {
    return null;
  }
}

async function fetchFromHelius(apiKey: string): Promise<WhaleTransaction[]> {
  const walletEntries = Object.entries(KNOWN_WALLETS);
  const selected = walletEntries.sort(() => Math.random() - 0.5).slice(0, 3);
  const results: WhaleTransaction[] = [];
  const solPrice = await fetchSolPrice();

  for (const [address, label] of selected) {
    try {
      const res = await fetch(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=5`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) continue;
      const txs = await res.json();

      for (const tx of txs) {
        if (!tx.signature) continue;
        const nativeTransfers = tx.nativeTransfers || [];
        for (const nt of nativeTransfers) {
          const lamports = Math.abs(nt.amount || 0);
          const solAmount = lamports / 1e9;
          const usdAmount = solAmount * solPrice;
          if (usdAmount < WHALE_THRESHOLDS.low) continue;

          results.push({
            signature: tx.signature,
            type: tx.type === 'SWAP' ? 'swap' : tx.type === 'STAKE' ? 'stake' : 'transfer',
            wallet: address,
            walletLabel: label,
            direction: nt.toUserAccount === address ? 'in' : 'out',
            amount: solAmount,
            amountUsd: usdAmount,
            tokenSymbol: 'SOL',
            tokenMint: 'So11111111111111111111111111111111111111112',
            counterparty: nt.toUserAccount === address ? nt.fromUserAccount : nt.toUserAccount,
            counterpartyLabel: getWalletLabel(nt.toUserAccount === address ? nt.fromUserAccount : nt.toUserAccount),
            timestamp: (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000,
            severity: classifyWhaleTransaction(usdAmount),
          });
        }

        const tokenTransfers = tx.tokenTransfers || [];
        for (const tt of tokenTransfers) {
          const amount = tt.tokenAmount || 0;
          // Use real USD value if Helius provides it, otherwise identify stablecoins
          const isStable = tt.mint?.startsWith('EPjFWdd5') || tt.mint?.startsWith('Es9vMF');
          const isWrappedSol = tt.mint === 'So11111111111111111111111111111111111111112';
          let usdAmount: number;
          if (isStable) {
            usdAmount = amount;
          } else if (isWrappedSol) {
            usdAmount = amount * solPrice;
          } else {
            // Skip non-stablecoin SPL tokens without price data — we can't estimate accurately
            continue;
          }
          if (usdAmount < WHALE_THRESHOLDS.low) continue;

          const tokenSym = isStable
            ? (tt.mint?.startsWith('EPjFWdd5') ? 'USDC' : 'USDT')
            : isWrappedSol ? 'wSOL' : 'SPL';

          results.push({
            signature: tx.signature,
            type: 'transfer',
            wallet: address,
            walletLabel: label,
            direction: tt.toUserAccount === address ? 'in' : 'out',
            amount,
            amountUsd: usdAmount,
            tokenSymbol: tokenSym,
            tokenMint: tt.mint || '',
            counterparty: tt.toUserAccount === address ? tt.fromUserAccount : tt.toUserAccount,
            counterpartyLabel: getWalletLabel(tt.toUserAccount === address ? tt.fromUserAccount : tt.toUserAccount),
            timestamp: (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000,
            severity: classifyWhaleTransaction(usdAmount),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return results;
}

// ── Public RPC fallback (free, no API key) ──────────────────────────────
// Uses getSignaturesForAddress + getTransaction to find real whale movements

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const url = getRpcUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// We rotate through wallets across calls so we don't hammer rate limits
let rpcWalletIndex = 0;

async function fetchFromPublicRpc(): Promise<WhaleTransaction[]> {
  const walletEntries = Object.entries(KNOWN_WALLETS);
  const results: WhaleTransaction[] = [];
  const solPrice = await fetchSolPrice();

  // Check 5 wallets per refresh (rotating), keeps us within free rate limits
  const walletsToCheck: [string, string][] = [];
  for (let i = 0; i < 5; i++) {
    walletsToCheck.push(walletEntries[rpcWalletIndex % walletEntries.length] as [string, string]);
    rpcWalletIndex++;
  }

  for (const [address, label] of walletsToCheck) {
    try {
      // Step 1: Get recent signatures
      const sigs = await rpcCall('getSignaturesForAddress', [
        address,
        { limit: 5, commitment: 'confirmed' },
      ]) as Array<{ signature: string; blockTime?: number; err?: unknown }>;

      if (!Array.isArray(sigs) || sigs.length === 0) continue;

      // Step 2: Fetch full transaction details for each
      for (const sigInfo of sigs) {
        if (sigInfo.err) continue; // skip failed TXs

        try {
          const tx = await rpcCall('getTransaction', [
            sigInfo.signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
          ]) as {
            blockTime?: number;
            meta?: {
              preBalances?: number[];
              postBalances?: number[];
              preTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount?: { uiAmount: number } }>;
              postTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount?: { uiAmount: number } }>;
              err?: unknown;
            };
            transaction?: {
              message?: {
                accountKeys?: Array<{ pubkey: string } | string>;
              };
            };
          } | null;

          if (!tx?.meta || tx.meta.err) continue;

          const accountKeys = tx.transaction?.message?.accountKeys ?? [];
          const getKey = (k: { pubkey: string } | string): string =>
            typeof k === 'string' ? k : k.pubkey;

          // Find this wallet's index in the account keys
          const walletIdx = accountKeys.findIndex(k => getKey(k) === address);
          if (walletIdx === -1) continue;

          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];

          // ── Native SOL movement ──
          if (walletIdx < preBalances.length && walletIdx < postBalances.length) {
            const preLamports = preBalances[walletIdx]!;
            const postLamports = postBalances[walletIdx]!;
            const diffLamports = postLamports - preLamports;
            const solAmount = Math.abs(diffLamports) / 1e9;
            const usdAmount = solAmount * solPrice;

            if (usdAmount >= WHALE_THRESHOLDS.low) {
              // Find counterparty — the account with the opposite largest balance change
              let counterpartyAddr = '';
              let maxCounterChange = 0;
              for (let j = 0; j < accountKeys.length; j++) {
                if (j === walletIdx) continue;
                if (j < preBalances.length && j < postBalances.length) {
                  const change = Math.abs((postBalances[j]!) - (preBalances[j]!));
                  if (change > maxCounterChange) {
                    maxCounterChange = change;
                    counterpartyAddr = getKey(accountKeys[j]!);
                  }
                }
              }

              results.push({
                signature: sigInfo.signature,
                type: 'transfer',
                wallet: address,
                walletLabel: label,
                direction: diffLamports > 0 ? 'in' : 'out',
                amount: solAmount,
                amountUsd: usdAmount,
                tokenSymbol: 'SOL',
                tokenMint: 'So11111111111111111111111111111111111111112',
                counterparty: counterpartyAddr,
                counterpartyLabel: getWalletLabel(counterpartyAddr),
                timestamp: (sigInfo.blockTime || Math.floor(Date.now() / 1000)) * 1000,
                severity: classifyWhaleTransaction(usdAmount),
              });
            }
          }

          // ── SPL Token movements ──
          const preTokens = tx.meta.preTokenBalances || [];
          const postTokens = tx.meta.postTokenBalances || [];

          // Group by mint
          const tokenChanges = new Map<string, { pre: number; post: number }>();
          for (const tb of preTokens) {
            if (tb.accountIndex === walletIdx) {
              const key = tb.mint;
              const existing = tokenChanges.get(key) || { pre: 0, post: 0 };
              existing.pre += tb.uiTokenAmount?.uiAmount ?? 0;
              tokenChanges.set(key, existing);
            }
          }
          for (const tb of postTokens) {
            if (tb.accountIndex === walletIdx) {
              const key = tb.mint;
              const existing = tokenChanges.get(key) || { pre: 0, post: 0 };
              existing.post += tb.uiTokenAmount?.uiAmount ?? 0;
              tokenChanges.set(key, existing);
            }
          }

          for (const [mint, { pre, post }] of tokenChanges) {
            const diff = post - pre;
            const absAmount = Math.abs(diff);
            // Only track tokens we can accurately price
            const isStable = mint.startsWith('EPjFWdd5') || mint.startsWith('Es9vMF');
            const isWrappedSol = mint === 'So11111111111111111111111111111111111111112';
            let usdAmount: number;
            if (isStable) {
              usdAmount = absAmount;
            } else if (isWrappedSol) {
              usdAmount = absAmount * solPrice;
            } else {
              // Skip unknown SPL tokens — showing wrong USD values is worse than missing them
              continue;
            }
            if (usdAmount < WHALE_THRESHOLDS.low) continue;

            const tokenSym = isStable
              ? (mint.startsWith('EPjFWdd5') ? 'USDC' : 'USDT')
              : isWrappedSol ? 'wSOL' : 'SPL';

            results.push({
              signature: sigInfo.signature,
              type: 'transfer',
              wallet: address,
              walletLabel: label,
              direction: diff > 0 ? 'in' : 'out',
              amount: absAmount,
              amountUsd: usdAmount,
              tokenSymbol: tokenSym,
              tokenMint: mint,
              counterparty: '',
              counterpartyLabel: '—',
              timestamp: (sigInfo.blockTime || Math.floor(Date.now() / 1000)) * 1000,
              severity: classifyWhaleTransaction(usdAmount),
            });
          }
        } catch {
          continue; // skip individual TX failures
        }
      }
    } catch {
      continue; // skip wallet on error
    }
  }

  return results;
}

export async function fetchWhaleTransactions(): Promise<WhaleTransaction[]> {
  const now = Date.now();
  if (whaleHistory.length > 0 && now - lastFetch < CACHE_TTL) return whaleHistory;

  let newTxs: WhaleTransaction[] = [];

  // Try Helius Enhanced Transactions API first (richer data)
  if (!heliusFailed) {
    const apiKey = getHeliusApiKey();
    if (apiKey) {
      try {
        newTxs = await fetchFromHelius(apiKey);
      } catch {
        heliusFailed = true;
      }
    }
  }

  // Fallback: public Solana RPC (free, no API key required)
  if (newTxs.length === 0) {
    try {
      newTxs = await fetchFromPublicRpc();
    } catch {
      // silent — will just show existing history
    }
  }

  // Merge, deduplicate, trim
  const sigs = new Set(whaleHistory.map(t => t.signature));
  for (const tx of newTxs) {
    if (!sigs.has(tx.signature)) {
      whaleHistory.unshift(tx);
      sigs.add(tx.signature);
    }
  }
  if (whaleHistory.length > MAX_HISTORY) {
    whaleHistory = whaleHistory.slice(0, MAX_HISTORY);
  }

  lastFetch = now;
  return whaleHistory;
}

export function addWhaleTransaction(tx: WhaleTransaction): void {
  whaleHistory.unshift(tx);
  if (whaleHistory.length > MAX_HISTORY) {
    whaleHistory = whaleHistory.slice(0, MAX_HISTORY);
  }
}

export function getWhaleHistory(): WhaleTransaction[] {
  return whaleHistory;
}

export function getNetFlow(hours: number = 24): { cexInflow: number; cexOutflow: number; net: number; dexVolume: number } {
  const cutoff = Date.now() - hours * 3_600_000;
  const recent = whaleHistory.filter(tx => tx.timestamp >= cutoff);
  let cexInflow = 0;
  let cexOutflow = 0;
  let dexVolume = 0;

  for (const tx of recent) {
    const isCex = tx.walletLabel.includes('Binance') ||
      tx.walletLabel.includes('Coinbase') || tx.walletLabel.includes('Kraken');
    const isDex = tx.type === 'dex_trade' || tx.type === 'swap' || tx.type === 'defi';
    if (isCex) {
      if (tx.direction === 'in') cexInflow += tx.amountUsd;
      else cexOutflow += tx.amountUsd;
    }
    if (isDex) {
      dexVolume += tx.amountUsd;
    }
  }
  return { cexInflow, cexOutflow, net: cexOutflow - cexInflow, dexVolume };
}

export { WHALE_THRESHOLDS };
