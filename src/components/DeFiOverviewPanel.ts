// DeFi Overview Panel — TVL tracker, protocol breakdown, liquid staking
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface ProtocolEntry {
  name: string;
  slug: string;
  tvl: number;
  tvlChange24h: number;
  category: string;
  chain: string;
  url?: string;
  logo?: string;
}

interface LiquidStakingEntry {
  name: string;
  symbol: string;
  tvl: number;
  apy: number;
  stakeShare: number; // % of total staked
}

interface DeFiData {
  totalTvl: number;
  tvlChange24h: number;
  protocols: ProtocolEntry[];
  liquidStaking: LiquidStakingEntry[];
}

type ViewMode = 'protocols' | 'liquid-staking';

export class DeFiOverviewPanel extends Panel {
  private data: DeFiData | null = null;
  private viewMode: ViewMode = 'protocols';

  constructor() {
    super({
      id: 'defi-overview',
      title: 'DeFi Overview',
      className: 'defi-overview-panel',
      infoTooltip: 'Solana DeFi ecosystem overview. Data from DeFi Llama. Liquid staking includes mSOL, jitoSOL, bSOL, INF.',
    });

    this.addViewToggle();
    this.render();
  }

  private addViewToggle(): void {
    const controls = document.createElement('div');
    controls.className = 'defi-view-controls';
    controls.innerHTML = `
      <button class="filter-btn active" data-view="protocols">Protocols</button>
      <button class="filter-btn" data-view="liquid-staking">LST</button>
    `;
    controls.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.filter-btn') as HTMLElement;
      if (!btn) return;
      controls.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.viewMode = (btn.dataset.view as ViewMode) || 'protocols';
      this.render();
    });
    this.header.appendChild(controls);
  }

  public update(data: DeFiData): void {
    this.data = data;
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = '<div class="panel-loading">Loading DeFi data...</div>';
      return;
    }

    const header = `
      <div class="defi-header">
        <div class="defi-tvl-main">
          <span class="defi-tvl-label">Solana TVL</span>
          <span class="defi-tvl-value">${this.formatUsd(this.data.totalTvl)}</span>
          <span class="defi-tvl-change ${this.data.tvlChange24h >= 0 ? 'positive' : 'negative'}">
            ${this.data.tvlChange24h >= 0 ? '+' : ''}${this.data.tvlChange24h.toFixed(1)}%
          </span>
        </div>
      </div>
    `;

    if (this.viewMode === 'protocols') {
      this.content.innerHTML = header + this.renderProtocols();
    } else {
      this.content.innerHTML = header + this.renderLiquidStaking();
    }
  }

  private renderProtocols(): string {
    if (!this.data?.protocols.length) return '<div class="panel-empty">No protocol data</div>';

    return `
      <div class="defi-protocol-list">
        ${this.data.protocols.slice(0, 20).map((p, i) => `
          <div class="defi-protocol-row" data-url="${escapeHtml(p.url || '')}">
            <span class="defi-rank">#${i + 1}</span>
            <div class="defi-protocol-info">
              <span class="defi-protocol-name">${escapeHtml(p.name)}</span>
              <span class="defi-protocol-cat">${escapeHtml(p.category)}</span>
            </div>
            <div class="defi-protocol-tvl">
              <span class="defi-protocol-tvl-value">${this.formatUsd(p.tvl)}</span>
              <span class="defi-protocol-tvl-change ${p.tvlChange24h >= 0 ? 'positive' : 'negative'}">
                ${p.tvlChange24h >= 0 ? '+' : ''}${p.tvlChange24h.toFixed(1)}%
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderLiquidStaking(): string {
    if (!this.data?.liquidStaking.length) return '<div class="panel-empty">No liquid staking data</div>';

    return `
      <div class="defi-lst-list">
        ${this.data.liquidStaking.map(lst => {
          return `
            <div class="defi-lst-row">
              <div class="defi-lst-info">
                <span class="defi-lst-symbol">${escapeHtml(lst.symbol)}</span>
                <span class="defi-lst-name">${escapeHtml(lst.name)}</span>
              </div>
              <div class="defi-lst-metrics">
                <div class="defi-lst-metric">
                  <span class="metric-label">TVL</span>
                  <span class="metric-value">${this.formatUsd(lst.tvl)}</span>
                </div>
                <div class="defi-lst-metric">
                  <span class="metric-label">APY</span>
                  <span class="metric-value apy">${lst.apy > 0 ? lst.apy.toFixed(2) + '%' : '\u2014'}</span>
                </div>
                <div class="defi-lst-metric">
                  <span class="metric-label">Share</span>
                  <span class="metric-value">${lst.stakeShare.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private formatUsd(value: number): string {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
}
