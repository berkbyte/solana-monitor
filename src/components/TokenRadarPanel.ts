// Token Radar Panel — Gem hunter with multi-signal scoring
// Highlights potential gem tokens with momentum, volume, buy pressure & safety scores

import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';
import type { TokenData, GemTier } from '../services/token-radar';

type FilterMode = 'all' | 'gem' | 'hot' | 'new';
type SortMode = 'score' | 'momentum' | 'volume' | 'buyers';

export class TokenRadarPanel extends Panel {
  private tokens: TokenData[] = [];
  private filter: FilterMode = 'all';
  private sort: SortMode = 'score';

  constructor() {
    super({
      id: 'token-radar',
      title: 'Token Radar',
      showCount: true,
      className: 'token-radar-panel',
      infoTooltip: 'Gem hunter — multi-signal scoring: Momentum (price action), Volume (health & growth), Buy Pressure (buy/sell ratio), Safety (liquidity & age). Click to open on DexScreener.',
    });

    this.addFilterBar();
    this.render();
  }

  private addFilterBar(): void {
    const bar = document.createElement('div');
    bar.className = 'gr-filter-bar';
    bar.innerHTML = `
      <div class="gr-filters">
        <button class="gr-filter active" data-filter="all">All</button>
        <button class="gr-filter" data-filter="gem">💎 Gems</button>
        <button class="gr-filter" data-filter="hot">🔥 Hot</button>
        <button class="gr-filter" data-filter="new">✨ New</button>
      </div>
      <div class="gr-sorts">
        <button class="gr-sort active" data-sort="score" title="Gem Score">🏆</button>
        <button class="gr-sort" data-sort="momentum" title="Momentum">📈</button>
        <button class="gr-sort" data-sort="volume" title="Volume">📊</button>
        <button class="gr-sort" data-sort="buyers" title="Buy Pressure">🐂</button>
      </div>
    `;

    bar.addEventListener('click', (e) => {
      const filterBtn = (e.target as HTMLElement).closest('.gr-filter') as HTMLElement;
      const sortBtn = (e.target as HTMLElement).closest('.gr-sort') as HTMLElement;

      if (filterBtn) {
        bar.querySelectorAll('.gr-filter').forEach(b => b.classList.remove('active'));
        filterBtn.classList.add('active');
        this.filter = (filterBtn.dataset.filter as FilterMode) || 'all';
        this.render();
      }
      if (sortBtn) {
        bar.querySelectorAll('.gr-sort').forEach(b => b.classList.remove('active'));
        sortBtn.classList.add('active');
        this.sort = (sortBtn.dataset.sort as SortMode) || 'score';
        this.render();
      }
    });

    this.header.appendChild(bar);
  }

  public update(tokens: TokenData[]): void {
    this.tokens = tokens;
    this.updateCount(tokens.length);
    this.render();
  }

  private getFiltered(): TokenData[] {
    let list = [...this.tokens];

    // Filter
    switch (this.filter) {
      case 'gem': list = list.filter(t => t.gemTier === 'gem'); break;
      case 'hot': list = list.filter(t => t.gemTier === 'gem' || t.gemTier === 'hot'); break;
      case 'new': list = list.filter(t => t.ageHours <= 24); break;
    }

    // Sort
    switch (this.sort) {
      case 'score': list.sort((a, b) => b.gemScore - a.gemScore); break;
      case 'momentum': list.sort((a, b) => b.momentumScore - a.momentumScore); break;
      case 'volume': list.sort((a, b) => b.volume.h24 - a.volume.h24); break;
      case 'buyers': list.sort((a, b) => b.buyPressure - a.buyPressure); break;
    }

    return list;
  }

  private render(): void {
    if (this.tokens.length === 0) {
      this.content.innerHTML = `<div class="panel-loading">🔍 Scanning for gems...</div>`;
      return;
    }

    const list = this.getFiltered();

    if (list.length === 0) {
      this.content.innerHTML = `<div class="panel-loading">No tokens match this filter</div>`;
      return;
    }

    this.content.innerHTML = list.map((t, i) => this.renderCard(t, i)).join('');

    // Click → DexScreener
    this.content.querySelectorAll('.gr-card').forEach(card => {
      card.addEventListener('click', () => {
        const addr = (card as HTMLElement).dataset.address;
        const pair = (card as HTMLElement).dataset.pair;
        if (addr) {
          const url = pair
            ? `https://dexscreener.com/solana/${pair}`
            : `https://dexscreener.com/solana/${addr}`;
          window.open(url, '_blank', 'noopener');
        }
      });
    });

    // Click analyze button → dispatch token-analyze event
    this.content.querySelectorAll('.gr-analyze-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent DexScreener open
        const mint = (btn as HTMLElement).dataset.mint;
        if (mint) {
          this.element.dispatchEvent(new CustomEvent('token-analyze', {
            detail: { mint },
            bubbles: true,
          }));
          // Scroll token-analyze panel into view
          const analyzePanel = document.getElementById('token-analyze');
          if (analyzePanel) {
            analyzePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });
  }

  private renderCard(t: TokenData, i: number): string {
    const tierInfo = this.getTierInfo(t.gemTier);
    const isUp = t.priceChange.h24 >= 0;
    const h1Up = t.priceChange.h1 >= 0;
    const age = this.formatAge(t.ageHours);
    const riskClass = `risk-${t.riskLevel}`;

    // Buy ratio for visual
    const totalH1 = t.txns.h1Buys + t.txns.h1Sells;
    const buyRatio = totalH1 > 0 ? Math.round((t.txns.h1Buys / totalH1) * 100) : 50;

    return `
      <div class="gr-card tier-${t.gemTier}" data-address="${escapeHtml(t.address)}" data-pair="${escapeHtml(t.pairAddress)}" style="animation-delay:${i * 30}ms">
        <div class="gr-card-header">
          <div class="gr-left">
            <span class="gr-tier-badge tier-${t.gemTier}">${tierInfo.icon}</span>
            <span class="gr-symbol">${escapeHtml(t.symbol)}</span>
            <span class="gr-age">${age}</span>
            ${t.tags.includes('trending') ? '<span class="gr-tag trending">TREND</span>' : ''}
            ${t.tags.includes('boosted') ? '<span class="gr-tag boosted">BOOST</span>' : ''}
          </div>
          <div class="gr-right">
            <button class="gr-analyze-btn" data-mint="${escapeHtml(t.address)}" title="Analyze this token">🔬 Analyze</button>
            <span class="gr-score-badge tier-${t.gemTier}">${t.gemScore}</span>
          </div>
        </div>

        <div class="gr-card-body">
          <div class="gr-price-row">
            <span class="gr-price">$${this.formatPrice(t.price)}</span>
            <div class="gr-changes">
              <span class="gr-ch ${h1Up ? 'up' : 'down'}" title="1h">${h1Up ? '+' : ''}${t.priceChange.h1.toFixed(1)}%</span>
              <span class="gr-ch ${isUp ? 'up' : 'down'}" title="24h">${isUp ? '+' : ''}${t.priceChange.h24.toFixed(1)}%</span>
            </div>
          </div>

          <div class="gr-metrics">
            <div class="gr-metric">
              <span class="gr-metric-label">MCap</span>
              <span class="gr-metric-val">${this.formatNum(t.marketCap)}</span>
            </div>
            <div class="gr-metric">
              <span class="gr-metric-label">Liq</span>
              <span class="gr-metric-val ${riskClass}">${this.formatNum(t.liquidity)}</span>
            </div>
            <div class="gr-metric">
              <span class="gr-metric-label">Vol 24h</span>
              <span class="gr-metric-val">${this.formatNum(t.volume.h24)}</span>
            </div>
            <div class="gr-metric">
              <span class="gr-metric-label">Buys</span>
              <span class="gr-metric-val ${buyRatio > 55 ? 'up' : buyRatio < 45 ? 'down' : ''}">${buyRatio}%</span>
            </div>
          </div>

          <div class="gr-score-bars">
            <div class="gr-sbar" title="Momentum: ${t.momentumScore}/25">
              <span class="gr-sbar-label">MOM</span>
              <div class="gr-sbar-track"><div class="gr-sbar-fill mom" style="width:${(t.momentumScore / 25) * 100}%"></div></div>
            </div>
            <div class="gr-sbar" title="Volume: ${t.volumeScore}/25">
              <span class="gr-sbar-label">VOL</span>
              <div class="gr-sbar-track"><div class="gr-sbar-fill vol" style="width:${(t.volumeScore / 25) * 100}%"></div></div>
            </div>
            <div class="gr-sbar" title="Buy Pressure: ${t.buyPressure}/25">
              <span class="gr-sbar-label">BUY</span>
              <div class="gr-sbar-track"><div class="gr-sbar-fill buy" style="width:${(t.buyPressure / 25) * 100}%"></div></div>
            </div>
            <div class="gr-sbar" title="Safety: ${t.safetyScore}/25">
              <span class="gr-sbar-label">SAFE</span>
              <div class="gr-sbar-track"><div class="gr-sbar-fill safe" style="width:${(t.safetyScore / 25) * 100}%"></div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getTierInfo(tier: GemTier): { icon: string; label: string } {
    switch (tier) {
      case 'gem': return { icon: '💎', label: 'GEM' };
      case 'hot': return { icon: '🔥', label: 'HOT' };
      case 'potential': return { icon: '⚡', label: 'POTENTIAL' };
      case 'watch': return { icon: '👁', label: 'WATCH' };
    }
  }

  private formatAge(h: number): string {
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    if (h < 24) return `${Math.round(h)}h`;
    return `${Math.round(h / 24)}d`;
  }

  private formatPrice(p: number): string {
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    if (p >= 0.0001) return p.toFixed(6);
    if (p === 0) return '0';
    return p.toExponential(2);
  }

  private formatNum(n: number): string {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    if (n === 0) return '$0';
    return '$' + n.toFixed(0);
  }
}
