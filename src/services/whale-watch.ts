// Whale Watch service — track large wallet movements on Solana
// Attempts Helius Enhanced Transactions API, falls back to simulated data

const HELIUS_RPC = import.meta.env.VITE_HELIUS_RPC_URL || '';

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
  low: 100_000,
  medium: 500_000,
  high: 1_000_000,
  critical: 5_000_000,
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
  // Check 3 random wallets per refresh to spread load
  const selected = walletEntries.sort(() => Math.random() - 0.5).slice(0, 3);
  const results: WhaleTransaction[] = [];

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
        // Parse native transfers
        const nativeTransfers = tx.nativeTransfers || [];
        for (const nt of nativeTransfers) {
          const lamports = Math.abs(nt.amount || 0);
          const solAmount = lamports / 1e9;
          const usdAmount = solAmount * 150; // rough SOL price
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

        // Parse token transfers
        const tokenTransfers = tx.tokenTransfers || [];
        for (const tt of tokenTransfers) {
          const amount = tt.tokenAmount || 0;
          // Rough USD estimate based on token
          const usdAmount = amount * (tt.mint?.includes('EPjFWdd5') ? 1 : 0.001);
          if (usdAmount < WHALE_THRESHOLDS.low) continue;

          results.push({
            signature: tx.signature,
            type: 'transfer',
            wallet: address,
            walletLabel: label,
            direction: tt.toUserAccount === address ? 'in' : 'out',
            amount,
            amountUsd: usdAmount,
            tokenSymbol: tt.mint?.includes('EPjFWdd5') ? 'USDC' : 'SPL',
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

function generateSimulatedWhaleActivity(): WhaleTransaction[] {
  const now = Date.now();
  const walletEntries = Object.entries(KNOWN_WALLETS);
  const count = 3 + Math.floor(Math.random() * 5);
  const newTxs: WhaleTransaction[] = [];
  const tokens = ['SOL', 'USDC', 'JUP', 'JTO', 'BONK', 'WIF', 'mSOL', 'PYTH', 'HNT', 'RNDR', 'RAY', 'ORCA'];
  const types: WhaleTransaction['type'][] = ['transfer', 'swap', 'dex_trade', 'dex_trade', 'swap', 'stake', 'defi', 'transfer'];

  for (let i = 0; i < count; i++) {
    const [address, label] = walletEntries[Math.floor(Math.random() * walletEntries.length)]!;
    const type = types[Math.floor(Math.random() * types.length)]!;
    const baseMag = Math.random() < 0.05 ? 8_000_000
      : Math.random() < 0.15 ? 3_000_000
      : Math.random() < 0.35 ? 1_000_000
      : Math.random() < 0.6 ? 500_000 : 150_000;
    const amountUsd = baseMag * (0.5 + Math.random() * 1.5);
    const token = type === 'stake' ? 'SOL' : tokens[Math.floor(Math.random() * tokens.length)]!;
    const counterparties = walletEntries.filter(([a]) => a !== address);
    const [, counterLabel] = counterparties[Math.floor(Math.random() * counterparties.length)]!;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const sig = Array.from({ length: 88 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    newTxs.push({
      signature: sig,
      type,
      wallet: address,
      walletLabel: label,
      direction: Math.random() > 0.5 ? 'in' : 'out',
      amount: token === 'SOL' ? amountUsd / 150 : amountUsd,
      amountUsd,
      tokenSymbol: token,
      tokenMint: '',
      counterparty: '',
      counterpartyLabel: counterLabel,
      timestamp: now - Math.floor(Math.random() * 3_600_000),
      severity: classifyWhaleTransaction(amountUsd),
    });
  }

  return newTxs;
}

export async function fetchWhaleTransactions(): Promise<WhaleTransaction[]> {
  const now = Date.now();
  if (whaleHistory.length > 0 && now - lastFetch < CACHE_TTL) return whaleHistory;

  let newTxs: WhaleTransaction[] = [];

  // Try Helius Enhanced Transactions API
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

  // Fallback: generate simulated whale activity
  if (newTxs.length === 0) {
    newTxs = generateSimulatedWhaleActivity();
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
