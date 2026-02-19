// Token Radar Panel — trending tokens, new listings, volume spikes, rug scores
// The heart of Solana Terminal's token discovery

import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface TokenItem {
  address: string;
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  rugScore: number;
  rugVerdict: 'SAFE' | 'CAUTION' | 'HIGH_RISK' | 'CRITICAL';
  ageHours: number;
  dex: string;
}

export class TokenRadarPanel extends Panel {
  private tokens: TokenItem[] = [];
  private sortBy: 'volume' | 'change' | 'rug' | 'age' = 'volume';

  constructor() {
    super({
      id: 'token-radar',
      title: 'Token Radar',
      showCount: true,
      className: 'token-radar-panel',
      infoTooltip: 'Trending Solana tokens from DexScreener. Rug Score (0-100) is a heuristic based on liquidity, age, and volume patterns. Not financial advice.',
    });

    this.addSortControls();
    this.render();
  }

  private addSortControls(): void {
    const controls = document.createElement('div');
    controls.className = 'tr-sort-bar';
    controls.innerHTML = `
      <button class="tr-sort active" data-sort="volume"><span class="tr-sort-ico">📊</span>Vol</button>
      <button class="tr-sort" data-sort="change"><span class="tr-sort-ico">📈</span>Δ%</button>
      <button class="tr-sort" data-sort="rug"><span class="tr-sort-ico">🛡</span>Risk</button>
      <button class="tr-sort" data-sort="age"><span class="tr-sort-ico">✨</span>New</button>
    `;
    controls.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.tr-sort') as HTMLElement;
      if (!btn) return;
      controls.querySelectorAll('.tr-sort').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.sortBy = (btn.dataset.sort as typeof this.sortBy) || 'volume';
      this.render();
    });
    this.header.appendChild(controls);
  }

  public update(tokens: TokenItem[]): void {
    this.tokens = tokens;
    this.updateCount(tokens.length);
    this.render();
  }

  private getSortedTokens(): TokenItem[] {
    const sorted = [...this.tokens];
    switch (this.sortBy) {
      case 'volume': return sorted.sort((a, b) => b.volume24h - a.volume24h);
      case 'change': return sorted.sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h));
      case 'rug': return sorted.sort((a, b) => b.rugScore - a.rugScore);
      case 'age': return sorted.sort((a, b) => a.ageHours - b.ageHours);
      default: return sorted;
    }
  }

  private render(): void {
    if (this.tokens.length === 0) {
      this.content.innerHTML = `<div class="panel-loading">Scanning tokens...</div>`;
      return;
    }

    const sorted = this.getSortedTokens();

    this.content.innerHTML = sorted.map((token, i) => {
      const isUp = token.priceChange24h >= 0;
      const changeSign = isUp ? '+' : '';
      const changeClass = isUp ? 'up' : 'down';
      const rugClass = this.getRugClass(token.rugVerdict);
      const rugLabel = this.getRugLabel(token.rugVerdict);
      const ageLabel = token.ageHours < 1 ? `${Math.round(token.ageHours * 60)}m` :
                       token.ageHours < 24 ? `${Math.round(token.ageHours)}h` :
                       `${Math.round(token.ageHours / 24)}d`;

      return `
        <div class="tr-card" data-address="${escapeHtml(token.address)}" style="animation-delay:${i * 25}ms">
          <div class="tr-accent ${rugClass}"></div>
          <div class="tr-body">
            <div class="tr-row-top">
              <div class="tr-identity">
                <span class="tr-symbol">${escapeHtml(token.symbol)}</span>
                <span class="tr-age">${ageLabel}</span>
              </div>
              <div class="tr-pricing">
                <span class="tr-price">$${this.formatPrice(token.price)}</span>
                <span class="tr-change ${changeClass}">${changeSign}${token.priceChange24h.toFixed(1)}%</span>
              </div>
            </div>
            <div class="tr-row-bot">
              <span class="tr-name">${escapeHtml(token.name.slice(0, 22))}</span>
              <div class="tr-stats">
                <span class="tr-vol" title="24h Volume">$${this.formatNum(token.volume24h)}</span>
                <span class="tr-dot">·</span>
                <span class="tr-liq" title="Liquidity">$${this.formatNum(token.liquidity)}</span>
                <span class="tr-rug-badge ${rugClass}">${rugLabel} ${token.rugScore}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Click handler for token details
    this.content.querySelectorAll('.tr-card').forEach(row => {
      row.addEventListener('click', () => {
        const addr = (row as HTMLElement).dataset.address;
        if (addr) {
          window.open(`https://solscan.io/token/${addr}`, '_blank', 'noopener');
        }
      });
    });
  }

  private getRugClass(verdict: string): string {
    switch (verdict) {
      case 'SAFE': return 'rug-safe';
      case 'CAUTION': return 'rug-caution';
      case 'HIGH_RISK': return 'rug-risky';
      case 'CRITICAL': return 'rug-danger';
      default: return '';
    }
  }

  private getRugLabel(verdict: string): string {
    switch (verdict) {
      case 'SAFE': return '✓';
      case 'CAUTION': return '!';
      case 'HIGH_RISK': return '⚠';
      case 'CRITICAL': return '✕';
      default: return '?';
    }
  }

  private formatPrice(p: number): string {
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    if (p >= 0.0001) return p.toFixed(6);
    return p.toExponential(2);
  }

  private formatNum(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  }
}
