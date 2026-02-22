// NFT Tracker Panel — Solana NFT ecosystem overview
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';
import type { NFTCollection, NFTSummary } from '../services/nft-tracker';

export class NFTTrackerPanel extends Panel {
  private data: NFTSummary | null = null;

  constructor() {
    super({
      id: 'nft-tracker',
      title: 'NFT Tracker',
      showCount: true,
      className: 'nft-tracker-panel',
      infoTooltip: 'Top Solana NFT collections by all-time volume. Floor price, listed count, and avg 24h sale price from Magic Eden.',
    });

    this.render();
  }

  public update(data: NFTSummary): void {
    this.data = data;
    this.updateCount(data.topCollections.length);
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = '<div class="panel-loading">Loading NFT data...</div>';
      return;
    }

    const d = this.data;

    if (d.topCollections.length === 0) {
      this.content.innerHTML = '<div class="nft-no-data">Failed to load NFT data</div>';
      return;
    }

    this.content.innerHTML = `
      <div class="nft-overview">
        <div class="nft-summary-bar">
          <div class="nft-stat">
            <span class="nft-stat-label">Collections</span>
            <span class="nft-stat-value">${d.topCollections.length}</span>
          </div>
          <div class="nft-stat">
            <span class="nft-stat-label">Listed Floor Value</span>
            <span class="nft-stat-value">${this.formatSol(d.totalFloorValue)} SOL</span>
          </div>
        </div>

        <div class="nft-collection-list">
          ${d.topCollections.map((c, i) => this.renderRow(c, i)).join('')}
        </div>
      </div>
    `;

    this.content.querySelectorAll('.nft-collection-row').forEach(row => {
      row.addEventListener('click', () => {
        const slug = (row as HTMLElement).dataset.slug;
        const mp = (row as HTMLElement).dataset.marketplace;
        if (!slug) return;
        // Open correct marketplace based on collection
        const url = mp === 'magiceden'
          ? `https://magiceden.io/marketplace/${slug}`
          : `https://www.tensor.trade/trade/${slug}`;
        window.open(url, '_blank', 'noopener');
      });
    });
  }

  private renderRow(c: NFTCollection, i: number): string {
    const mpLabel = c.marketplace === 'tensor' ? '◈ Tensor'
      : c.marketplace === 'magiceden' ? '◆ ME' : '◈◆';

    return `
      <div class="nft-collection-row" data-slug="${escapeHtml(c.slug)}" data-marketplace="${c.marketplace}">
        <span class="nft-rank">#${i + 1}</span>
        <div class="nft-collection-info">
          <span class="nft-collection-name">${escapeHtml(c.name)}</span>
          <span class="nft-marketplace">${mpLabel}</span>
        </div>
        <div class="nft-collection-metrics">
          <div class="nft-metric">
            <span class="nft-metric-label">Floor</span>
            <span class="nft-metric-value">${this.formatSol(c.floorPrice)} SOL</span>
          </div>
          <div class="nft-metric">
            <span class="nft-metric-label">Avg 24h</span>
            <span class="nft-metric-value">${c.avgPrice24h > 0 ? this.formatSol(c.avgPrice24h) + ' SOL' : '—'}</span>
          </div>
          <div class="nft-metric">
            <span class="nft-metric-label">Listed</span>
            <span class="nft-metric-value">${c.listed.toLocaleString()}</span>
          </div>
          <div class="nft-metric">
            <span class="nft-metric-label">Vol (All)</span>
            <span class="nft-metric-value">${this.formatSol(c.volumeAll)} SOL</span>
          </div>
        </div>
      </div>
    `;
  }

  private formatSol(sol: number): string {
    if (sol >= 1e6) return `${(sol / 1e6).toFixed(2)}M`;
    if (sol >= 1e3) return `${(sol / 1e3).toFixed(1)}K`;
    if (sol >= 1) return sol.toFixed(2);
    if (sol >= 0.01) return sol.toFixed(3);
    return sol.toFixed(4);
  }
}
