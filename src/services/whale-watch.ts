// Whale Watch service — track large wallet movements on Solana
// Uses server-side proxy (/api/whale-transactions) to avoid CORS issues

// Rough SOL price cache (updated from CoinGecko)
let cachedSolPrice = 175;
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

// Known whale wallets and labels (CEX + DEX + DeFi + whales + market makers)
export const KNOWN_WALLETS: Record<string, string> = {
  // ── CEX Hot/Deposit Wallets (high tx volume) ──
  '5tzFkiKscjHK3gXGjaGRb8Ntz9GTCLbF14eMFxcU6KGo': 'Binance Hot',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance',
  '3gRtLxFMvBGwiBwfcMFPqFvJRMFWGJnZGFp5rtNputWj': 'Binance Deposit',
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': 'FTX Estate',
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Coinbase',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase Prime',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Kraken',
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiWB7t': 'Bybit',
  'HN7cABqLq46Es1jh92dQQisATkm2fEq8sVT8YpdWKpcN': 'OKX',
  'AC5RDfQFmDS1deWZos921JfqscXdByf24fEhg6GFUyei': 'OKX Hot',
  // ── DEX & Aggregator Protocols ──
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp': 'Jupiter DCA',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'CAMMCzo5YL8w4VFF8KVHr7UfmqhJeHhHczTb6h4eRgD': 'Raydium CLMM',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  // ── DeFi Protocols ──
  'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1': 'Marinade Finance',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'Jito SOL',
  'KAMi4bsMRCJGLAMF4uH6JqxWhAZHhm5KyWBkHjD1XHP': 'Kamino Finance',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'MarginFi',
  'DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW': 'Drift Protocol',
  // ── Market Makers & Trading Firms ──
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1': 'Wintermute',
  'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq': 'Jump Trading',
  'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK': 'Alameda',
  // ── Staking ──
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'Marinade mSOL',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 'BlazeStake bSOL',
  '7ge2xKsZXmqPxa3YmXxXmzCp9Hc2ezrTxh93PEqJDEn': 'Jito Stake Pool',
  // ── Known Large Wallets / Whales ──
  'CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR': 'Tether Treasury',
  'FGyh1FfooV7AtVrjuAPJxcFSPhBEsGYDvSVRQnPKhraE': 'Circle USDC',
};

const WHALE_THRESHOLDS = {
  low: 25_000,         // $25K
  medium: 100_000,     // $100K
  high: 500_000,       // $500K
  critical: 2_000_000, // $2M
};

let whaleHistory: WhaleTransaction[] = [];
const MAX_HISTORY = 500;
let lastFetch = 0;
const CACHE_TTL = 15_000; // 15 sec

export function classifyWhaleTransaction(amountUsd: number): WhaleTransaction['severity'] {
  if (amountUsd >= WHALE_THRESHOLDS.critical) return 'critical';
  if (amountUsd >= WHALE_THRESHOLDS.high) return 'high';
  if (amountUsd >= WHALE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getWalletLabel(address: string): string {
  if (!address) return '—';
  return KNOWN_WALLETS[address] || `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// ── Map Helius tx type to our type ──────────────────────────────
function mapTxType(heliusType: string): WhaleTransaction['type'] {
  switch (heliusType) {
    case 'SWAP': return 'swap';
    case 'NFT_SALE': case 'NFT_LISTING': case 'NFT_BID': return 'nft_trade';
    case 'STAKE': case 'UNSTAKE': return 'stake';
    case 'TRANSFER': return 'transfer';
    default: return heliusType?.includes('DEX') ? 'dex_trade' : 'transfer';
  }
}

// Well-known SPL token symbols (common high-value tokens)
const TOKEN_SYMBOLS: Record<string, { sym: string; approxPrice: number }> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { sym: 'USDC', approxPrice: 1 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { sym: 'USDT', approxPrice: 1 },
  'So11111111111111111111111111111111111111112': { sym: 'wSOL', approxPrice: 0 }, // filled at runtime
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { sym: 'JUP', approxPrice: 0.8 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { sym: 'BONK', approxPrice: 0.000025 },
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': { sym: 'JTO', approxPrice: 2.5 },
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { sym: 'PYTH', approxPrice: 0.35 },
  'RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a': { sym: 'RLBK', approxPrice: 1.5 },
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof': { sym: 'RNDR', approxPrice: 5.5 },
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': { sym: 'WEN', approxPrice: 0.00008 },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { sym: 'W', approxPrice: 0.3 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { sym: 'mSOL', approxPrice: 0 }, // filled at runtime
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': { sym: 'bSOL', approxPrice: 0 }, // filled at runtime
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { sym: 'jitoSOL', approxPrice: 0 }, // filled at runtime
};

// ── Parse Helius Enhanced TX response ──────────────────────────────
function parseHeliusTxs(txs: any[], wallet: string, label: string, solPrice: number): WhaleTransaction[] {
  const results: WhaleTransaction[] = [];

  // Update SOL-pegged token prices
  TOKEN_SYMBOLS['So11111111111111111111111111111111111111112']!.approxPrice = solPrice;
  TOKEN_SYMBOLS['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So']!.approxPrice = solPrice * 1.05;
  TOKEN_SYMBOLS['bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1']!.approxPrice = solPrice * 1.02;
  TOKEN_SYMBOLS['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn']!.approxPrice = solPrice * 1.07;

  for (const tx of txs) {
    if (!tx.signature) continue;

    const timestamp = (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000;
    const txType = mapTxType(tx.type || 'UNKNOWN');

    // ── Aggregate ALL native SOL transfers per transaction ──
    const nativeTransfers = tx.nativeTransfers || [];
    let totalSolIn = 0;
    let totalSolOut = 0;
    let mainCounterparty = '';

    for (const nt of nativeTransfers) {
      const lamports = Math.abs(nt.amount || 0);
      const sol = lamports / 1e9;

      if (nt.toUserAccount === wallet) {
        totalSolIn += sol;
        if (!mainCounterparty && nt.fromUserAccount && nt.fromUserAccount !== wallet) {
          mainCounterparty = nt.fromUserAccount;
        }
      } else if (nt.fromUserAccount === wallet) {
        totalSolOut += sol;
        if (!mainCounterparty && nt.toUserAccount && nt.toUserAccount !== wallet) {
          mainCounterparty = nt.toUserAccount;
        }
      }
    }

    // Use the larger direction as the aggregate amount
    const grossSol = Math.max(totalSolIn, totalSolOut);
    const solUsd = grossSol * solPrice;

    if (grossSol > 0.01 && solUsd >= WHALE_THRESHOLDS.low) {
      results.push({
        signature: tx.signature,
        type: txType,
        wallet,
        walletLabel: label,
        direction: totalSolIn >= totalSolOut ? 'in' : 'out',
        amount: grossSol,
        amountUsd: solUsd,
        tokenSymbol: 'SOL',
        tokenMint: 'So11111111111111111111111111111111111111112',
        counterparty: mainCounterparty,
        counterpartyLabel: getWalletLabel(mainCounterparty),
        timestamp,
        severity: classifyWhaleTransaction(solUsd),
      });
    }

    // ── Aggregate token transfers per mint ──
    const tokenTransfers = tx.tokenTransfers || [];
    const tokenAgg = new Map<string, { totalIn: number; totalOut: number; counterparty: string }>();

    for (const tt of tokenTransfers) {
      const mint = tt.mint || 'unknown';
      const amount = tt.tokenAmount || 0;
      if (amount <= 0) continue;

      const entry = tokenAgg.get(mint) || { totalIn: 0, totalOut: 0, counterparty: '' };

      if (tt.toUserAccount === wallet) {
        entry.totalIn += amount;
        if (!entry.counterparty && tt.fromUserAccount) entry.counterparty = tt.fromUserAccount;
      } else if (tt.fromUserAccount === wallet) {
        entry.totalOut += amount;
        if (!entry.counterparty && tt.toUserAccount) entry.counterparty = tt.toUserAccount;
      } else {
        // Part of a multi-hop: attribute to wallet
        entry.totalIn += amount;
      }

      tokenAgg.set(mint, entry);
    }

    for (const [mint, agg] of tokenAgg) {
      const absAmount = Math.max(agg.totalIn, agg.totalOut);
      if (absAmount <= 0) continue;

      const known = TOKEN_SYMBOLS[mint];
      let usdAmount: number;
      let tokenSym: string;

      if (known) {
        usdAmount = absAmount * known.approxPrice;
        tokenSym = known.sym;
      } else {
        // Unknown SPL token — skip if no way to price (avoids showing dust/unknown tokens)
        // But for SWAP transactions, show with zero USD to still display activity
        if (txType === 'swap' || txType === 'dex_trade') {
          usdAmount = 0; // Can't price but show anyway for swaps
          tokenSym = 'SPL';
        } else {
          continue;
        }
      }

      // For known tokens, filter by threshold; for unknown swap tokens always show
      if (known && usdAmount < WHALE_THRESHOLDS.low) continue;
      if (!known && absAmount < 1) continue; // skip micro-amounts for unknown

      results.push({
        signature: tx.signature,
        type: txType,
        wallet,
        walletLabel: label,
        direction: agg.totalIn >= agg.totalOut ? 'in' : 'out',
        amount: absAmount,
        amountUsd: usdAmount,
        tokenSymbol: tokenSym,
        tokenMint: mint,
        counterparty: agg.counterparty,
        counterpartyLabel: getWalletLabel(agg.counterparty),
        timestamp,
        severity: usdAmount > 0 ? classifyWhaleTransaction(usdAmount) : 'low',
      });
    }
  }

  return results;
}

// ── Parse raw RPC TX response ──────────────────────────────
function parseRpcTxs(data: any, wallet: string, label: string, solPrice: number): WhaleTransaction[] {
  const results: WhaleTransaction[] = [];
  const transactions = data.transactions || [];
  const signatures = data.signatures || [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    if (!tx?.meta || tx.meta.err) continue;

    const sig = tx.signature || signatures[i]?.signature || '';
    const blockTime = tx.blockTime || signatures[i]?.blockTime;
    const accountKeys = tx.transaction?.message?.accountKeys ?? [];
    const getKey = (k: { pubkey: string } | string): string =>
      typeof k === 'string' ? k : k.pubkey;

    // Find wallet index
    const walletIdx = accountKeys.findIndex((k: any) => getKey(k) === wallet);
    if (walletIdx === -1) continue;

    const preBalances = tx.meta.preBalances || [];
    const postBalances = tx.meta.postBalances || [];

    // Native SOL movement
    if (walletIdx < preBalances.length && walletIdx < postBalances.length) {
      const preLamports = preBalances[walletIdx]!;
      const postLamports = postBalances[walletIdx]!;
      const diffLamports = postLamports - preLamports;
      const solAmount = Math.abs(diffLamports) / 1e9;
      const usdAmount = solAmount * solPrice;

      if (usdAmount >= WHALE_THRESHOLDS.low) {
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
          signature: sig,
          type: 'transfer',
          wallet,
          walletLabel: label,
          direction: diffLamports > 0 ? 'in' : 'out',
          amount: solAmount,
          amountUsd: usdAmount,
          tokenSymbol: 'SOL',
          tokenMint: 'So11111111111111111111111111111111111111112',
          counterparty: counterpartyAddr,
          counterpartyLabel: getWalletLabel(counterpartyAddr),
          timestamp: (blockTime || Math.floor(Date.now() / 1000)) * 1000,
          severity: classifyWhaleTransaction(usdAmount),
        });
      }
    }

    // SPL Token movements
    const preTokens = tx.meta.preTokenBalances || [];
    const postTokens = tx.meta.postTokenBalances || [];
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
      const isStable = mint.startsWith('EPjFWdd5') || mint.startsWith('Es9vMF');
      const isWrappedSol = mint === 'So11111111111111111111111111111111111111112';
      let usdAmount: number;
      if (isStable) {
        usdAmount = absAmount;
      } else if (isWrappedSol) {
        usdAmount = absAmount * solPrice;
      } else {
        continue;
      }
      if (usdAmount < WHALE_THRESHOLDS.low) continue;

      const tokenSym = isStable
        ? (mint.startsWith('EPjFWdd5') ? 'USDC' : 'USDT')
        : isWrappedSol ? 'wSOL' : 'SPL';

      results.push({
        signature: sig,
        type: 'transfer',
        wallet,
        walletLabel: label,
        direction: diff > 0 ? 'in' : 'out',
        amount: absAmount,
        amountUsd: usdAmount,
        tokenSymbol: tokenSym,
        tokenMint: mint,
        counterparty: '',
        counterpartyLabel: '—',
        timestamp: (blockTime || Math.floor(Date.now() / 1000)) * 1000,
        severity: classifyWhaleTransaction(usdAmount),
      });
    }
  }

  return results;
}

// ── Fetch through server proxy ──────────────────────────────
// We rotate through wallets across calls
let walletRotationIndex = 0;

async function fetchViaProxy(): Promise<WhaleTransaction[]> {
  const walletEntries = Object.entries(KNOWN_WALLETS);
  const solPrice = await fetchSolPrice();
  const results: WhaleTransaction[] = [];

  // Check 12 wallets per refresh (rotating)
  const walletsToCheck: [string, string][] = [];
  for (let i = 0; i < 12; i++) {
    walletsToCheck.push(walletEntries[walletRotationIndex % walletEntries.length] as [string, string]);
    walletRotationIndex++;
  }

  const fetches = walletsToCheck.map(async ([address, label]) => {
    try {
      const res = await fetch(`/api/whale-transactions?wallet=${address}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        console.warn(`[whale-watch] Proxy returned ${res.status} for ${label}`);
        return [];
      }
      const data = await res.json();

      if (data.source === 'helius') {
        return parseHeliusTxs(data.transactions || [], address, label, solPrice);
      } else if (data.source === 'rpc') {
        return parseRpcTxs(data, address, label, solPrice);
      }
      return [];
    } catch (e: any) {
      console.warn(`[whale-watch] Failed for ${label}: ${e.message}`);
      return [];
    }
  });

  const allResults = await Promise.all(fetches);
  for (const batch of allResults) {
    results.push(...batch);
  }

  console.log(`[whale-watch] Fetched ${results.length} whale txs from ${walletsToCheck.map(w => w[1]).join(', ')}`);
  return results;
}

export async function fetchWhaleTransactions(): Promise<WhaleTransaction[]> {
  const now = Date.now();
  if (whaleHistory.length > 0 && now - lastFetch < CACHE_TTL) return whaleHistory;

  try {
    const newTxs = await fetchViaProxy();

    // Merge, deduplicate, sort by time
    const sigs = new Set(whaleHistory.map(t => t.signature));
    for (const tx of newTxs) {
      if (!sigs.has(tx.signature)) {
        whaleHistory.push(tx);
        sigs.add(tx.signature);
      }
    }

    // Sort newest first
    whaleHistory.sort((a, b) => b.timestamp - a.timestamp);

    if (whaleHistory.length > MAX_HISTORY) {
      whaleHistory = whaleHistory.slice(0, MAX_HISTORY);
    }

    lastFetch = now;
  } catch (e) {
    console.error('[whale-watch] Fetch error:', e);
  }

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
