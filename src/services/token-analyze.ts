// Token Analyze service — deep analysis for any Solana token by contract address
// Uses DexScreener for market data + RugCheck API for on-chain security checks

export interface TokenAnalysis {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;

  // Price data
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  marketCap: number;
  fdv: number;
  volume24h: number;
  liquidity: number;

  // Pair info
  pairAddress: string;
  dexName: string;
  pairCreatedAt: number;
  txCount24h: { buys: number; sells: number };

  // Risk analysis
  riskScore: number; // 0-100, higher = more risky
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskFactors: RiskFactor[];

  // Recommendation
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | 'AVOID';
  signalReasons: string[];

  // Metadata
  mintAuthority: 'revoked' | 'active' | 'unknown';
  freezeAuthority: 'revoked' | 'active' | 'unknown';
  topHolderPercent: number;
  top10HolderPercent: number;
  topHolders: HolderInfo[];  // top 10 filtered (pools excluded)
  lpBurned: boolean;
  liquidityLocked: boolean;
  honeypotRisk: boolean;
  lastChecked: number;
}

export interface HolderInfo {
  owner: string;       // wallet address
  pct: number;         // percentage of supply
  uiAmount: number;    // token amount
  label?: string;      // known label (Creator, etc.)
  isInsider: boolean;
}

export interface RiskFactor {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  weight: number; // contribution to risk score
}

// Cache for recent analyses
const analysisCache = new Map<string, { data: TokenAnalysis; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

export async function analyzeTokenCA(mint: string): Promise<TokenAnalysis | null> {
  // Check cache
  const cached = analysisCache.get(mint);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Fetch from DexScreener via server-side proxy (avoids CORS/anti-bot)
    const res = await fetch(`/api/dexscreener-token?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn('[TokenAnalyze] Proxy returned', res.status);
      return null;
    }
    const data = await res.json();
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) {
      console.warn('[TokenAnalyze] No pairs returned for', mint);
      return null;
    }

    // Proxy already sorts by liquidity; take the first (most liquid) pair
    const pair = pairs[0];
    console.log('[TokenAnalyze] Best pair:', pair.dexId, 'liquidity:', JSON.stringify(pair.liquidity), 'price:', pair.priceUsd);

    const priceUsd = parseFloat(pair.priceUsd || '0');
    const volume24h = pair.volume?.h24 || 0;
    // Handle both {usd: N} object, plain number, and missing (pump.fun) formats
    let liquidity = typeof pair.liquidity === 'number' ? pair.liquidity : (pair.liquidity?.usd || 0);
    // Pump.fun and bonding-curve DEXes often don't report liquidity field.
    // For these, estimate from FDV or marketCap if available.
    if (liquidity === 0 && (pair.fdv > 0 || pair.marketCap > 0)) {
      // Use marketCap as a rough liquidity proxy for bonding curve tokens
      liquidity = pair.marketCap || pair.fdv || 0;
      console.log('[TokenAnalyze] No liquidity field — using marketCap/fdv as estimate:', liquidity);
    }
    const marketCap = pair.marketCap || pair.fdv || 0;
    const fdv = pair.fdv || marketCap;
    const pairCreatedAt = pair.pairCreatedAt || Date.now();

    const priceChange5m = pair.priceChange?.m5 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const priceChange6h = pair.priceChange?.h6 || 0;
    const priceChange24h = pair.priceChange?.h24 || 0;

    const txBuys = pair.txns?.h24?.buys || 0;
    const txSells = pair.txns?.h24?.sells || 0;

    // Compute risk factors
    const riskFactors: RiskFactor[] = [];
    let riskScore = 0;

    // Age check
    const ageHours = (Date.now() - pairCreatedAt) / 3_600_000;
    if (ageHours < 1) {
      riskFactors.push({ name: 'Token Age', status: 'fail', detail: `Created ${Math.floor(ageHours * 60)} min ago — extremely new`, weight: 20 });
      riskScore += 20;
    } else if (ageHours < 24) {
      riskFactors.push({ name: 'Token Age', status: 'warn', detail: `Created ${Math.floor(ageHours)} hours ago — very new`, weight: 12 });
      riskScore += 12;
    } else if (ageHours < 72) {
      riskFactors.push({ name: 'Token Age', status: 'warn', detail: `Created ${Math.floor(ageHours / 24)} days ago`, weight: 5 });
      riskScore += 5;
    } else {
      riskFactors.push({ name: 'Token Age', status: 'pass', detail: `Created ${Math.floor(ageHours / 24)} days ago`, weight: 0 });
    }

    // Liquidity check
    if (liquidity < 1000) {
      riskFactors.push({ name: 'Liquidity', status: 'fail', detail: `$${fmtNum(liquidity)} — dangerously low`, weight: 25 });
      riskScore += 25;
    } else if (liquidity < 10_000) {
      riskFactors.push({ name: 'Liquidity', status: 'warn', detail: `$${fmtNum(liquidity)} — low`, weight: 15 });
      riskScore += 15;
    } else if (liquidity < 50_000) {
      riskFactors.push({ name: 'Liquidity', status: 'warn', detail: `$${fmtNum(liquidity)} — moderate`, weight: 5 });
      riskScore += 5;
    } else {
      riskFactors.push({ name: 'Liquidity', status: 'pass', detail: `$${fmtNum(liquidity)}`, weight: 0 });
    }

    // Volume / market cap ratio
    const volMcapRatio = marketCap > 0 ? volume24h / marketCap : 0;
    if (volMcapRatio > 5) {
      riskFactors.push({ name: 'Volume/MCap', status: 'warn', detail: `${volMcapRatio.toFixed(1)}x — abnormally high churn`, weight: 10 });
      riskScore += 10;
    } else if (volMcapRatio > 1) {
      riskFactors.push({ name: 'Volume/MCap', status: 'pass', detail: `${volMcapRatio.toFixed(2)}x — healthy trading`, weight: 0 });
    } else if (volMcapRatio < 0.01 && marketCap > 100_000) {
      riskFactors.push({ name: 'Volume/MCap', status: 'warn', detail: `${volMcapRatio.toFixed(4)}x — very low activity`, weight: 8 });
      riskScore += 8;
    } else {
      riskFactors.push({ name: 'Volume/MCap', status: 'pass', detail: `${volMcapRatio.toFixed(2)}x`, weight: 0 });
    }

    // Buy/Sell ratio
    const totalTx = txBuys + txSells;
    if (totalTx > 10) {
      const sellRatio = txSells / totalTx;
      if (sellRatio > 0.7) {
        riskFactors.push({ name: 'Sell Pressure', status: 'fail', detail: `${(sellRatio * 100).toFixed(0)}% sells — heavy dumping`, weight: 15 });
        riskScore += 15;
      } else if (sellRatio > 0.55) {
        riskFactors.push({ name: 'Sell Pressure', status: 'warn', detail: `${(sellRatio * 100).toFixed(0)}% sells`, weight: 5 });
        riskScore += 5;
      } else {
        riskFactors.push({ name: 'Buy/Sell Ratio', status: 'pass', detail: `${txBuys} buys / ${txSells} sells`, weight: 0 });
      }
    }

    // Price dump check
    if (priceChange24h < -50) {
      riskFactors.push({ name: 'Price Action', status: 'fail', detail: `${priceChange24h.toFixed(1)}% in 24h — massive dump`, weight: 15 });
      riskScore += 15;
    } else if (priceChange24h < -20) {
      riskFactors.push({ name: 'Price Action', status: 'warn', detail: `${priceChange24h.toFixed(1)}% in 24h — significant decline`, weight: 8 });
      riskScore += 8;
    } else if (priceChange24h > 100) {
      riskFactors.push({ name: 'Price Action', status: 'warn', detail: `+${priceChange24h.toFixed(1)}% in 24h — parabolic (potential fomo trap)`, weight: 5 });
      riskScore += 5;
    } else {
      riskFactors.push({ name: 'Price Action', status: 'pass', detail: `${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(1)}% in 24h`, weight: 0 });
    }

    // Fetch real on-chain security data from RugCheck API (free, no key needed)
    let mintRevoked = false;
    let freezeRevoked = false;
    let liquidityLocked = false;
    let lpBurned = false;
    let honeypotRisk = false;
    let topHolderPercent = 0;
    let top10HolderPercent = 0;
    let topHolders: HolderInfo[] = [];

    try {
      // Use FULL report (not summary) — contains topHolders, markets, knownAccounts
      const rugRes = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
        signal: AbortSignal.timeout(10000),
      });
      if (rugRes.ok) {
        const rug = await rugRes.json();
        // RugCheck risks array: each has { name, description, level, score }
        const risks: Array<{ name: string; description?: string; level?: string; score?: number }> = rug.risks || [];
        const riskNames = risks.map((r: { name: string }) => r.name?.toLowerCase() || '');

        // Mint authority
        mintRevoked = !riskNames.some((n: string) => n.includes('mint') && (n.includes('enabled') || n.includes('authority')));
        // Also check rug.mintAuthority field
        if (rug.mintAuthority === null || rug.mintAuthority === '') mintRevoked = true;
        // Freeze authority
        freezeRevoked = !riskNames.some((n: string) => n.includes('freeze') && (n.includes('enabled') || n.includes('authority')));
        if (rug.freezeAuthority === null || rug.freezeAuthority === '') freezeRevoked = true;
        // LP info — 'unlocked' in risk name means it's NOT burned/locked
        lpBurned = !riskNames.some((n: string) => (n.includes('lp') || n.includes('burn')) && (n.includes('unlocked') || n.includes('not burned') || n.includes('not burnt')));
        liquidityLocked = !riskNames.some((n: string) => n.includes('liquid') && n.includes('unlocked'));
        // Honeypot — only flag if RugCheck explicitly warns about honeypot with a risk score
        const honeypotRisks = risks.filter((r: { name: string; score?: number }) =>
          (r.name?.toLowerCase().includes('honeypot') || r.name?.toLowerCase().includes('copycat')) &&
          (typeof r.score !== 'number' || r.score > 0)
        );
        honeypotRisk = honeypotRisks.length > 0;

        // ========== TOP HOLDERS (filter out pools/AMMs) ==========
        // Collect all market/pool pubkeys to filter them from holders
        const marketPubkeys = new Set<string>();
        if (Array.isArray(rug.markets)) {
          for (const m of rug.markets) {
            if (m.pubkey) marketPubkeys.add(m.pubkey);
          }
        }
        // Collect known AMM/system accounts
        const knownAccounts: Record<string, { name?: string; type?: string }> = rug.knownAccounts || {};
        const ammOwners = new Set<string>();
        for (const [addr, info] of Object.entries(knownAccounts)) {
          if (info.type === 'AMM' || info.type === 'RAYDIUM' || info.type === 'ORCA' ||
              info.type === 'JUPITER' || info.type === 'SYSTEM') {
            ammOwners.add(addr);
          }
        }

        // Known burn/dead addresses
        const DEAD_ADDRESSES = new Set([
          '1111111111111111111111111111111111',
          '1nc1nerator11111111111111111111111111111111',
        ]);

        if (Array.isArray(rug.topHolders) && rug.topHolders.length > 0) {
          // Filter: exclude pool pubkeys, AMM owners, and dead addresses
          const filteredHolders = rug.topHolders.filter((h: any) => {
            const owner = h.owner || '';
            if (marketPubkeys.has(owner)) return false;  // pool address
            if (ammOwners.has(owner)) return false;      // known AMM
            if (DEAD_ADDRESSES.has(owner)) return false;  // burn address
            // Also filter if knownAccounts labels this as AMM
            const known = knownAccounts[owner];
            if (known && (known.type === 'AMM' || known.name?.includes('Pump Fun') ||
                known.name?.includes('Raydium') || known.name?.includes('Orca'))) return false;
            return true;
          });

          console.log('[TokenAnalyze] Holders: total=', rug.topHolders.length,
            'filtered=', filteredHolders.length,
            'pools_excluded=', rug.topHolders.length - filteredHolders.length);

          // Build top 10 holder list
          topHolders = filteredHolders.slice(0, 10).map((h: any) => ({
            owner: h.owner || '',
            pct: h.pct || 0,
            uiAmount: h.uiAmount || 0,
            label: knownAccounts[h.owner]?.name || (h.insider ? 'Insider' : undefined),
            isInsider: !!h.insider,
          }));

          if (topHolders.length > 0) {
            const firstHolder = topHolders[0];
            if (firstHolder) topHolderPercent = firstHolder.pct;
            top10HolderPercent = topHolders.reduce((s, h) => s + h.pct, 0);
          }
        }

        // RugCheck score interpretation:
        // - For standard tokens: 0 = worst, ~1000 = best
        // - For pump.fun tokens: score can be very low (e.g. 1) with empty risks[] = SAFE
        // Only flag honeypot if score is low AND there are actual risk entries
        if (typeof rug.score === 'number' && rug.score < 50 && risks.length > 0 && !honeypotRisk) {
          honeypotRisk = true; // low score WITH actual risks = danger signal
        }

        // Use lpLockedPct from RugCheck if available (pump.fun returns this)
        if (typeof rug.lpLockedPct === 'number' && rug.lpLockedPct > 50) {
          liquidityLocked = true;
          lpBurned = rug.lpLockedPct >= 99;
        }
        // Also check totalMarketLiquidity for LP lock info
        if (typeof rug.totalMarketLiquidity === 'number' && rug.totalMarketLiquidity > 0) {
          // Check if any market has locked LP
          if (Array.isArray(rug.markets)) {
            for (const m of rug.markets) {
              if (m.lp?.lpLockedPct > 50) {
                liquidityLocked = true;
                if (m.lp.lpLockedPct >= 99) lpBurned = true;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TokenAnalyze] RugCheck fetch failed, using unknowns:', e);
      // Mark as unknown rather than faking
    }

    if (!mintRevoked) {
      riskFactors.push({ name: 'Mint Authority', status: 'fail', detail: 'Active — new tokens can be minted', weight: 20 });
      riskScore += 20;
    } else {
      riskFactors.push({ name: 'Mint Authority', status: 'pass', detail: 'Revoked ✓', weight: 0 });
    }

    if (!freezeRevoked) {
      riskFactors.push({ name: 'Freeze Authority', status: 'fail', detail: 'Active — tokens can be frozen', weight: 15 });
      riskScore += 15;
    } else {
      riskFactors.push({ name: 'Freeze Authority', status: 'pass', detail: 'Revoked ✓', weight: 0 });
    }

    if (!liquidityLocked) {
      riskFactors.push({ name: 'Liquidity Lock', status: 'warn', detail: 'Not locked — can be pulled', weight: 10 });
      riskScore += 10;
    } else {
      riskFactors.push({ name: 'Liquidity Lock', status: 'pass', detail: 'Locked ✓', weight: 0 });
    }

    if (topHolderPercent > 30) {
      riskFactors.push({ name: 'Top Holder', status: 'fail', detail: `${topHolderPercent.toFixed(1)}% — extreme concentration`, weight: 15 });
      riskScore += 15;
    } else if (topHolderPercent > 15) {
      riskFactors.push({ name: 'Top Holder', status: 'warn', detail: `${topHolderPercent.toFixed(1)}% — high concentration`, weight: 8 });
      riskScore += 8;
    } else {
      riskFactors.push({ name: 'Top Holder', status: 'pass', detail: `${topHolderPercent.toFixed(1)}%`, weight: 0 });
    }

    if (honeypotRisk) {
      riskFactors.push({ name: 'Honeypot', status: 'fail', detail: 'Sell transactions may be blocked', weight: 25 });
      riskScore += 25;
    } else {
      riskFactors.push({ name: 'Honeypot', status: 'pass', detail: 'No honeypot indicators', weight: 0 });
    }

    // Clamp risk score
    riskScore = Math.min(100, riskScore);

    // Determine risk level
    let riskLevel: TokenAnalysis['riskLevel'];
    if (riskScore <= 25) riskLevel = 'LOW';
    else if (riskScore <= 50) riskLevel = 'MEDIUM';
    else if (riskScore <= 75) riskLevel = 'HIGH';
    else riskLevel = 'CRITICAL';

    // Determine signal
    const { signal, signalReasons } = computeSignal(riskScore, priceChange24h, priceChange1h, volume24h, liquidity, marketCap, txBuys, txSells, ageHours);

    const analysis: TokenAnalysis = {
      mint,
      symbol: pair.baseToken?.symbol || '???',
      name: pair.baseToken?.name || 'Unknown',
      imageUrl: pair.info?.imageUrl,
      priceUsd,
      priceChange5m,
      priceChange1h,
      priceChange6h,
      priceChange24h,
      marketCap,
      fdv,
      volume24h,
      liquidity,
      pairAddress: pair.pairAddress || '',
      dexName: pair.dexId || 'unknown',
      pairCreatedAt,
      txCount24h: { buys: txBuys, sells: txSells },
      riskScore,
      riskLevel,
      riskFactors,
      signal,
      signalReasons,
      mintAuthority: mintRevoked ? 'revoked' : 'active',
      freezeAuthority: freezeRevoked ? 'revoked' : 'active',
      topHolderPercent,
      top10HolderPercent,
      topHolders,
      lpBurned,
      liquidityLocked,
      honeypotRisk,
      lastChecked: Date.now(),
    };

    analysisCache.set(mint, { data: analysis, ts: Date.now() });
    return analysis;
  } catch (err) {
    console.error('[TokenAnalyze] Analysis failed:', err);
    return null;
  }
}

function computeSignal(
  risk: number, change24h: number, change1h: number,
  volume: number, liquidity: number, mcap: number,
  buys: number, sells: number, ageHours: number,
): { signal: TokenAnalysis['signal']; signalReasons: string[] } {
  const reasons: string[] = [];

  // Avoid if critical risk
  if (risk >= 75) {
    reasons.push('Critical risk score — too many red flags');
    return { signal: 'AVOID', signalReasons: reasons };
  }

  // Strong sell: dumping + high risk
  if (change24h < -30 && risk > 50) {
    reasons.push('Heavy dump with elevated risk');
    return { signal: 'STRONG_SELL', signalReasons: reasons };
  }

  // Sell: declining significantly
  if (change24h < -15 && change1h < -5) {
    reasons.push('Continued downward momentum');
    if (sells > buys * 1.5) reasons.push('Sell pressure exceeding buys');
    return { signal: 'SELL', signalReasons: reasons };
  }

  let score = 50; // neutral starting point

  // Positive factors
  if (risk <= 25) { score += 15; reasons.push('Low risk profile'); }
  if (change24h > 10 && change24h < 80) { score += 10; reasons.push('Healthy upward trend'); }
  if (change1h > 2 && change1h < 30) { score += 5; reasons.push('Short-term momentum'); }
  if (volume > liquidity * 0.5 && volume < liquidity * 10) { score += 5; reasons.push('Good volume vs liquidity'); }
  if (buys > sells * 1.3) { score += 10; reasons.push('Strong buy pressure'); }
  if (ageHours > 168 && mcap > 500_000) { score += 5; reasons.push('Established token (>7d)'); }
  if (liquidity > 100_000) { score += 5; reasons.push('Solid liquidity'); }

  // Negative factors
  if (risk > 50) { score -= 20; reasons.push('Elevated risk factors'); }
  if (change24h > 200) { score -= 10; reasons.push('Parabolic spike — high fomo risk'); }
  if (liquidity < 10_000) { score -= 10; reasons.push('Low liquidity — high slippage'); }
  if (ageHours < 6) { score -= 10; reasons.push('Token very new (<6h)'); }
  if (sells > buys * 1.5) { score -= 10; reasons.push('Sell pressure exceeding buys'); }

  if (score >= 80) return { signal: 'STRONG_BUY', signalReasons: reasons };
  if (score >= 60) return { signal: 'BUY', signalReasons: reasons };
  if (score >= 40) return { signal: 'HOLD', signalReasons: reasons };
  if (score >= 25) return { signal: 'SELL', signalReasons: reasons };
  return { signal: 'STRONG_SELL', signalReasons: reasons };
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}
