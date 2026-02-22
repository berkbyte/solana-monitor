// Liquid Staking Panel — Deep LST analytics
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface LSTProvider {
  name: string;
  symbol: string;
  mint: string;
  tvlSol: number;
  tvlUsd: number;
  apy: number;
  priceSol: number;     // exchange rate: 1 LST = X SOL (value-accruing, naturally > 1)
  marketShare: number;
  fdv: number;
  change24h: number;
}

interface LSTSummary {
  totalStakedSol: number;
  totalStakedUsd: number;
  lstShareOfTotal: number; // % of total SOL staked via LSTs
  providers: LSTProvider[];
  avgApy: number;
}

export class LiquidStakingPanel extends Panel {
  private data: LSTSummary | null = null;

  constructor() {
    super({
      id: 'liquid-staking',
      title: 'Liquid Staking',
      className: 'liquid-staking-panel',
      infoTooltip: 'Solana liquid staking token analytics. Tracks mSOL (Marinade), jitoSOL (Jito), bSOL (BlazeStake), INF/hSOL (Sanctum). APY includes base staking yield + MEV tips + protocol emissions.',
    });

    this.render();
  }

  public update(data: LSTSummary): void {
    this.data = data;
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = '<div class="panel-loading">Loading LST data...</div>';
      return;
    }

    const d = this.data;

    this.content.innerHTML = `
      <div class="lst-overview">
        <div class="lst-summary-row">
          <div class="lst-summary-stat">
            <span class="lst-label">Total LST TVL</span>
            <span class="lst-value">${this.formatSol(d.totalStakedSol)} SOL</span>
            <span class="lst-sub">${this.formatUsd(d.totalStakedUsd)}</span>
          </div>
          <div class="lst-summary-stat">
            <span class="lst-label">LST Share</span>
            <span class="lst-value">${d.lstShareOfTotal.toFixed(1)}%</span>
            <span class="lst-sub">of total stake</span>
          </div>
          <div class="lst-summary-stat">
            <span class="lst-label">Avg APY</span>
            <span class="lst-value apy">${d.avgApy.toFixed(2)}%</span>
          </div>
        </div>

        <div class="lst-providers">
          ${d.providers.map(p => {
            return `
              <div class="lst-provider-card">
                <div class="lst-provider-header">
                  <span class="lst-symbol">${escapeHtml(p.symbol)}</span>
                  <span class="lst-name">${escapeHtml(p.name)}</span>
                  <span class="lst-change ${p.change24h >= 0 ? 'positive' : 'negative'}">
                    ${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(1)}%
                  </span>
                </div>
                <div class="lst-provider-metrics">
                  <div class="lst-metric-row">
                    <span class="lst-metric-label">TVL</span>
                    <span class="lst-metric-value">${this.formatSol(p.tvlSol)} SOL <span class="lst-sub">(${this.formatUsd(p.tvlUsd)})</span></span>
                  </div>
                  <div class="lst-metric-row">
                    <span class="lst-metric-label">APY</span>
                    <span class="lst-metric-value apy">${p.apy > 0 ? p.apy.toFixed(2) + '%' : '—'}</span>
                  </div>
                  <div class="lst-metric-row">
                    <span class="lst-metric-label">Rate</span>
                    <span class="lst-metric-value">1 ${escapeHtml(p.symbol)} = ${p.priceSol.toFixed(4)} SOL</span>
                  </div>
                  ${p.fdv > 0 ? `
                  <div class="lst-metric-row">
                    <span class="lst-metric-label">FDV</span>
                    <span class="lst-metric-value">${this.formatUsd(p.fdv)}</span>
                  </div>` : ''}
                  <div class="lst-metric-row">
                    <span class="lst-metric-label">Share</span>
                    <div class="lst-share-bar">
                      <div class="lst-share-fill" style="width: ${Math.min(p.marketShare, 100)}%"></div>
                    </div>
                    <span class="lst-metric-value">${p.marketShare.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private formatSol(sol: number): string {
    if (sol >= 1e6) return `${(sol / 1e6).toFixed(2)}M`;
    if (sol >= 1e3) return `${(sol / 1e3).toFixed(0)}K`;
    return sol.toFixed(0);
  }

  private formatUsd(value: number): string {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${(value / 1e3).toFixed(0)}K`;
  }
}
