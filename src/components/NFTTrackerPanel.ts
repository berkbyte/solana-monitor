// NFT Tracker Panel — displays top Solana NFT collections
// All collection links open on Magic Eden.
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';
import type { NFTCollection, NFTSummary } from '../services/nft-tracker';

const ME_URL = 'https://magiceden.io/marketplace';

export class NFTTrackerPanel extends Panel {
  private data: NFTSummary | null = null;

  constructor() {
    super({
      id: 'nft-tracker',
      title: 'NFT Tracker',
      showCount: true,
      className: 'nft-tracker-panel',
      infoTooltip:
        'Top Solana NFT collections by all-time volume. Data from Magic Eden.',
    });
    this.render();
  }

  public update(data: NFTSummary): void {
    this.data = data;
    this.updateCount(data.topCollections.length);
    this.render();
  }

  /* ──────────── render ──────────── */

  private render(): void {
    if (!this.data) {
      this.content.innerHTML =
        '<div class="panel-loading">Loading NFT data…</div>';
      return;
    }

    const cols = this.data.topCollections;

    if (cols.length === 0) {
      this.content.innerHTML =
        '<div class="nft-no-data">No NFT data available</div>';
      return;
    }

    this.content.innerHTML = `
      <div class="nft-overview">
        <div class="nft-summary-bar">
          <div class="nft-stat">
            <span class="nft-stat-label">Collections</span>
            <span class="nft-stat-value">${cols.length}</span>
          </div>
          <div class="nft-stat">
            <span class="nft-stat-label">Listed Floor Value</span>
            <span class="nft-stat-value">${fmtSol(this.data.totalFloorValue)} SOL</span>
          </div>
        </div>
        <div class="nft-collection-list">
          ${cols.map((c, i) => row(c, i)).join('')}
        </div>
      </div>`;

    // Every row opens the collection on Magic Eden
    this.content.querySelectorAll<HTMLElement>('.nft-collection-row').forEach((el) => {
      el.addEventListener('click', () => {
        const slug = el.dataset.slug;
        if (slug) window.open(`${ME_URL}/${slug}`, '_blank', 'noopener');
      });
    });
  }
}

/* ──────────── helpers (module-private) ──────────── */

function row(c: NFTCollection, i: number): string {
  return `
    <div class="nft-collection-row" data-slug="${escapeHtml(c.slug)}">
      <span class="nft-rank">#${i + 1}</span>
      <div class="nft-collection-info">
        <span class="nft-collection-name">${escapeHtml(c.name)}</span>
        <span class="nft-marketplace">◆ Magic Eden</span>
      </div>
      <div class="nft-collection-metrics">
        <div class="nft-metric">
          <span class="nft-metric-label">Floor</span>
          <span class="nft-metric-value">${fmtSol(c.floorPrice)} SOL</span>
        </div>
        <div class="nft-metric">
          <span class="nft-metric-label">Avg 24 h</span>
          <span class="nft-metric-value">${c.avgPrice24h > 0 ? fmtSol(c.avgPrice24h) + ' SOL' : '—'}</span>
        </div>
        <div class="nft-metric">
          <span class="nft-metric-label">Listed</span>
          <span class="nft-metric-value">${c.listed.toLocaleString()}</span>
        </div>
        <div class="nft-metric">
          <span class="nft-metric-label">Vol (All)</span>
          <span class="nft-metric-value">${fmtSol(c.volumeAll)} SOL</span>
        </div>
      </div>
    </div>`;
}

/** Format a SOL value for display */
function fmtSol(sol: number): string {
  if (sol >= 1_000_000) return `${(sol / 1_000_000).toFixed(2)}M`;
  if (sol >= 1_000)     return `${(sol / 1_000).toFixed(1)}K`;
  if (sol >= 1)         return sol.toFixed(2);
  if (sol >= 0.01)      return sol.toFixed(3);
  return sol.toFixed(4);
}
