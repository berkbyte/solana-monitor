// NFT Tracker Panel — Solana NFT ecosystem overview
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface NFTCollection {
  name: string;
  slug: string;
  image?: string;
  floorPrice: number; // SOL
  volume24h: number;  // SOL
  volumeChange24h: number;
  listed: number;
  supply: number;
  holders: number;
  marketplace: 'tensor' | 'magiceden' | 'both';
}

interface NFTSummary {
  totalVolume24h: number;
  topCollections: NFTCollection[];
  mintActivity: number; // mints in last 24h
  cNftMints: number; // compressed NFT mints
}

export class NFTTrackerPanel extends Panel {
  private data: NFTSummary | null = null;

  constructor() {
    super({
      id: 'nft-tracker',
      title: 'NFT Tracker',
      showCount: true,
      className: 'nft-tracker-panel',
      infoTooltip: 'Solana NFT ecosystem. Top collections by 24h volume from Tensor & Magic Eden. Includes compressed NFT (cNFT) mint activity.',
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

    this.content.innerHTML = `
      <div class="nft-overview">
        <div class="nft-summary-bar">
          <div class="nft-stat">
            <span class="nft-stat-label">24h Volume</span>
            <span class="nft-stat-value">${this.formatSol(d.totalVolume24h)} SOL</span>
          </div>
          <div class="nft-stat">
            <span class="nft-stat-label">Mints</span>
            <span class="nft-stat-value">${d.mintActivity.toLocaleString()}</span>
          </div>
          <div class="nft-stat">
            <span class="nft-stat-label">cNFT Mints</span>
            <span class="nft-stat-value">${d.cNftMints.toLocaleString()}</span>
          </div>
        </div>

        <div class="nft-collection-list">
          ${d.topCollections.map((c, i) => `
            <div class="nft-collection-row" data-slug="${escapeHtml(c.slug)}">
              <span class="nft-rank">#${i + 1}</span>
              <div class="nft-collection-info">
                <span class="nft-collection-name">${escapeHtml(c.name)}</span>
                <span class="nft-marketplace">${c.marketplace === 'tensor' ? '◈ Tensor' : c.marketplace === 'magiceden' ? '◆ ME' : '◈◆'}</span>
              </div>
              <div class="nft-collection-metrics">
                <div class="nft-metric">
                  <span class="metric-label">Floor</span>
                  <span class="metric-value">${c.floorPrice.toFixed(2)} SOL</span>
                </div>
                <div class="nft-metric">
                  <span class="metric-label">24h Vol</span>
                  <span class="metric-value">${this.formatSol(c.volume24h)} SOL</span>
                </div>
                <div class="nft-metric">
                  <span class="metric-label">Change</span>
                  <span class="metric-value ${c.volumeChange24h >= 0 ? 'positive' : 'negative'}">
                    ${c.volumeChange24h >= 0 ? '+' : ''}${c.volumeChange24h.toFixed(0)}%
                  </span>
                </div>
                <div class="nft-metric">
                  <span class="metric-label">Listed</span>
                  <span class="metric-value">${c.listed}/${c.supply}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.content.querySelectorAll('.nft-collection-row').forEach(row => {
      row.addEventListener('click', () => {
        const slug = (row as HTMLElement).dataset.slug;
        if (slug) {
          window.open(`https://www.tensor.trade/trade/${slug}`, '_blank', 'noopener');
        }
      });
    });
  }

  private formatSol(sol: number): string {
    if (sol >= 1e6) return `${(sol / 1e6).toFixed(1)}M`;
    if (sol >= 1e3) return `${(sol / 1e3).toFixed(0)}K`;
    return sol.toFixed(1);
  }
}
