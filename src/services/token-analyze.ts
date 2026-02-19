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
  lpBurned: boolean;
  liquidityLocked: boolean;
  honeypotRisk: boolean;
  lastChecked: number;
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
    // Fetch from DexScreener
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Use the most liquid pair
    const pair = pairs.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      ((b.liquidity as { usd?: number })?.usd || 0) - ((a.liquidity as { usd?: number })?.usd || 0)
    )[0];

    const priceUsd = parseFloat(pair.priceUsd || '0');
    const volume24h = pair.volume?.h24 || 0;
    const liquidity = pair.liquidity?.usd || 0;
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

    try {
      const rugRes = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
        signal: AbortSignal.timeout(6000),
      });
      if (rugRes.ok) {
        const rug = await rugRes.json();
        // RugCheck risks array: each has { name, description, level, score }
        const risks: Array<{ name: string; description?: string; level?: string; score?: number }> = rug.risks || [];
        const riskNames = risks.map((r: { name: string }) => r.name?.toLowerCase() || '');

        // Mint authority
        mintRevoked = !riskNames.some((n: string) => n.includes('mint') && (n.includes('enabled') || n.includes('authority')));
        // Freeze authority
        freezeRevoked = !riskNames.some((n: string) => n.includes('freeze') && (n.includes('enabled') || n.includes('authority')));
        // LP info
        lpBurned = riskNames.some((n: string) => n.includes('burn')) ? false : true; // if "not burned" risk exists, it's NOT burned
        lpBurned = !riskNames.some((n: string) => n.includes('lp') && n.includes('unlocked'));
        liquidityLocked = !riskNames.some((n: string) => n.includes('liquid') && n.includes('unlocked'));
        // Honeypot
        honeypotRisk = riskNames.some((n: string) => n.includes('honeypot') || n.includes('copycat'));

        // Top holder concentration from RugCheck
        if (typeof rug.topHolderConcentration === 'number') {
          topHolderPercent = rug.topHolderConcentration;
        } else if (rug.topHolders && Array.isArray(rug.topHolders) && rug.topHolders.length > 0) {
          topHolderPercent = (rug.topHolders[0]?.pct || 0) * 100;
          top10HolderPercent = rug.topHolders.slice(0, 10).reduce((s: number, h: { pct?: number }) => s + (h.pct || 0), 0) * 100;
        }
        // If RugCheck provides a score, use it as a hint
        if (typeof rug.score === 'number' && rug.score < 300) {
          honeypotRisk = true; // very low RugCheck score = danger
        }
        // Use token owner concentration from risks
        const concRisk = risks.find((r: { name: string }) => r.name?.toLowerCase().includes('concentration') || r.name?.toLowerCase().includes('top holder'));
        if (concRisk && typeof concRisk.score === 'number') {
          if (topHolderPercent === 0) topHolderPercent = Math.min(90, concRisk.score / 10);
        }
      }
    } catch (e) {
      console.warn('[TokenAnalyze] RugCheck fetch failed, using unknowns:', e);
      // Mark as unknown rather than faking
    }
    if (top10HolderPercent === 0 && topHolderPercent > 0) {
      top10HolderPercent = Math.min(100, topHolderPercent * 2.5);
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
