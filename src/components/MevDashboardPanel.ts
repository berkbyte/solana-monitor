// MEV Dashboard Panel — Jito tip floor, recent bundles, stake info
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface TipFloor {
  p25: number; p50: number; p75: number; p95: number; p99: number; ema50: number;
}

interface RecentBundle {
  bundleId: string;
  tipLamports: number;
  txCount: number;
  timestamp: number;
}

interface MevStats {
  tipFloor: TipFloor | null;
  recentBundles: RecentBundle[];
  jitoStakePercent: number;
  jitoValidatorCount: number;
  totalNetworkValidators: number;
}

export class MevDashboardPanel extends Panel {
  private stats: MevStats | null = null;

  constructor() {
    super({
      id: 'mev-dashboard',
      title: 'MEV & Jito',
      className: 'mev-dashboard-panel',
      infoTooltip: 'Jito MEV ecosystem — tip floor percentiles, recent bundle activity, and Jito validator stake share. Live data from Jito Block Engine API.',
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
    const tf = s.tipFloor;

    // Compute recent bundles stats
    const avgTipLamports = s.recentBundles.length > 0
      ? s.recentBundles.reduce((sum, b) => sum + b.tipLamports, 0) / s.recentBundles.length
      : 0;

    this.content.innerHTML = `
      <div class="mev-overview">
        <div class="mev-stat-grid">
          <div class="mev-stat">
            <span class="mev-stat-label">Tip Floor (p50)</span>
            <span class="mev-stat-value sol">${tf ? this.formatSol(tf.p50) : '—'}</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Tip Floor (p75)</span>
            <span class="mev-stat-value">${tf ? this.formatSol(tf.p75) : '—'}</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Jito Stake</span>
            <span class="mev-stat-value">${s.jitoStakePercent > 0 ? s.jitoStakePercent.toFixed(1) + '%' : '—'}</span>
          </div>
          <div class="mev-stat">
            <span class="mev-stat-label">Jito Validators</span>
            <span class="mev-stat-value">${s.jitoValidatorCount > 0 ? s.jitoValidatorCount.toLocaleString() + ' / ' + s.totalNetworkValidators.toLocaleString() : '—'}</span>
          </div>
        </div>

        ${tf ? `
        <div class="mev-tip-distribution">
          <span class="mev-section-title">Tip Floor Percentiles</span>
          <div class="mev-percentile-grid">
            <div class="mev-pctl"><span class="pctl-label">p25</span><span class="pctl-value">${this.formatSol(tf.p25)}</span></div>
            <div class="mev-pctl"><span class="pctl-label">p50</span><span class="pctl-value">${this.formatSol(tf.p50)}</span></div>
            <div class="mev-pctl"><span class="pctl-label">p75</span><span class="pctl-value">${this.formatSol(tf.p75)}</span></div>
            <div class="mev-pctl"><span class="pctl-label">p95</span><span class="pctl-value">${this.formatSol(tf.p95)}</span></div>
            <div class="mev-pctl"><span class="pctl-label">p99</span><span class="pctl-value">${this.formatSol(tf.p99)}</span></div>
            <div class="mev-pctl"><span class="pctl-label">EMA</span><span class="pctl-value">${this.formatSol(tf.ema50)}</span></div>
          </div>
        </div>
        ` : ''}

        <div class="mev-bundles-section">
          <span class="mev-section-title">Recent Bundles${s.recentBundles.length > 0 ? ` <span class="mev-bundle-avg">avg tip: ${this.formatLamports(avgTipLamports)}</span>` : ''}</span>
          <div class="mev-bundle-list">
            ${s.recentBundles.length > 0 ? s.recentBundles.slice(0, 10).map(b => `
              <div class="mev-bundle-row" data-id="${escapeHtml(b.bundleId)}">
                <span class="mev-bundle-id">${escapeHtml(b.bundleId.slice(0, 8))}…</span>
                <span class="mev-bundle-tip">${this.formatLamports(b.tipLamports)}</span>
                <span class="mev-bundle-txs">${b.txCount} tx${b.txCount !== 1 ? 's' : ''}</span>
                <span class="mev-bundle-time">${this.timeAgo(b.timestamp)}</span>
              </div>
            `).join('') : '<div class="mev-no-data">No recent bundles</div>'}
          </div>
        </div>
      </div>
    `;
  }

  /** Format SOL value (tip floor values are already in SOL) */
  private formatSol(sol: number): string {
    if (sol >= 1) return sol.toFixed(2) + ' SOL';
    if (sol >= 0.001) return sol.toFixed(4) + ' SOL';
    if (sol >= 0.000001) return (sol * 1e6).toFixed(1) + ' μSOL';
    return sol.toExponential(1) + ' SOL';
  }

  /** Format lamports as SOL */
  private formatLamports(lamports: number): string {
    const sol = lamports / 1e9;
    return this.formatSol(sol);
  }

  private timeAgo(ts: number): string {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 0) return 'now';
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  }
}
