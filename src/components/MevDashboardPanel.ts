// MEV Dashboard Panel — Jito MEV, tips, bundle stats
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface MevStats {
  totalTipsLamports: number;
  totalTipsSol: number;
  totalBundles24h: number;
  avgTipPerBundle: number;
  topSearcher: string;
  topSearcherBundles: number;
  jitoStakePercent: number;
  recentBundles: MevBundle[];
  tipDistribution: { low: number; medium: number; high: number };
}

interface MevBundle {
  bundleId: string;
  tipLamports: number;
  txCount: number;
  slot: number;
  timestamp: number;
  landedTxCount: number;
  type: 'arb' | 'liquidation' | 'sandwich' | 'backrun' | 'unknown';
}

export class MevDashboardPanel extends Panel {
  private stats: MevStats | null = null;

  constructor() {
    super({
      id: 'mev-dashboard',
      title: 'MEV & Jito',
      className: 'mev-dashboard-panel',
      infoTooltip: 'Jito MEV ecosystem metrics. Tracks bundle tips, searcher activity, and MEV type distribution. Data from Jito Block Engine.',
    });

    this.render();
  }

  public update(stats: MevStats): void {
    this.stats = stats;
    this.render();
  }

  private render(): void {
    if (!this.stats) {
      this.content.innerHTML = '<div class="panel-loading">Loading MEV data...</div>';
      return;
    }

    const s = this.stats;

    this.content.innerHTML = `
      <div class="mev-overview">
        <div class="mev-stat-grid">
          <div class="mev-stat">
            <span class="mev-stat-label">24h Tips</span>
            <span class="mev-stat-value sol">${s.totalTipsSol.toFixed(1)} SOL</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Bundles</span>
            <span class="mev-stat-value">${this.formatNumber(s.totalBundles24h)}</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Avg Tip</span>
            <span class="mev-stat-value">${(s.avgTipPerBundle / 1e9).toFixed(4)} SOL</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Jito Stake</span>
            <span class="mev-stat-value">${s.jitoStakePercent.toFixed(1)}%</span>
          </div>
        </div>

        <div class="mev-tip-distribution">
          <span class="mev-section-title">Tip Distribution</span>
          <div class="mev-tip-bar">
            <div class="tip-segment tip-low" style="width: ${s.tipDistribution.low}%" title="Low (<0.001 SOL)"></div>
            <div class="tip-segment tip-med" style="width: ${s.tipDistribution.medium}%" title="Medium (0.001-0.01 SOL)"></div>
            <div class="tip-segment tip-high" style="width: ${s.tipDistribution.high}%" title="High (>0.01 SOL)"></div>
          </div>
          <div class="mev-tip-legend">
            <span class="tip-legend-item"><span class="dot tip-low-dot"></span>Low ${s.tipDistribution.low}%</span>
            <span class="tip-legend-item"><span class="dot tip-med-dot"></span>Med ${s.tipDistribution.medium}%</span>
            <span class="tip-legend-item"><span class="dot tip-high-dot"></span>High ${s.tipDistribution.high}%</span>
          </div>
        </div>

        <div class="mev-bundles-section">
          <span class="mev-section-title">Recent Bundles</span>
          <div class="mev-bundle-list">
            ${s.recentBundles.slice(0, 10).map(b => `
              <div class="mev-bundle-row" data-id="${escapeHtml(b.bundleId)}">
                <span class="mev-bundle-type type-${escapeHtml(b.type)}">${this.getTypeLabel(b.type)}</span>
                <span class="mev-bundle-tip">${(b.tipLamports / 1e9).toFixed(4)} SOL</span>
                <span class="mev-bundle-txs">${b.landedTxCount}/${b.txCount} txs</span>
                <span class="mev-bundle-time">${this.timeAgo(b.timestamp)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private getTypeLabel(type: string): string {
    switch (type) {
      case 'arb': return '⇄ Arb';
      case 'liquidation': return '💀 Liq';
      case 'sandwich': return '🥪 Sand';
      case 'backrun': return '🏃 Back';
      default: return '• Unknown';
    }
  }

  private formatNumber(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toLocaleString();
  }

  private timeAgo(ts: number): string {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  }
}
