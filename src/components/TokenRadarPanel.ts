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
    controls.className = 'token-sort-controls';
    controls.innerHTML = `
      <button class="sort-btn active" data-sort="volume">Volume</button>
      <button class="sort-btn" data-sort="change">Change</button>
      <button class="sort-btn" data-sort="rug">Rug ⚠️</button>
      <button class="sort-btn" data-sort="age">New</button>
    `;
    controls.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.sort-btn') as HTMLElement;
      if (!btn) return;
      controls.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
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

    this.content.innerHTML = sorted.map(token => {
      const changeColor = token.priceChange24h >= 0 ? '#14F195' : '#FF4444';
      const changeSign = token.priceChange24h >= 0 ? '+' : '';
      const rugColor = this.getRugColor(token.rugVerdict);
      const ageLabel = token.ageHours < 1 ? `${Math.round(token.ageHours * 60)}m` :
                       token.ageHours < 24 ? `${Math.round(token.ageHours)}h` :
                       `${Math.round(token.ageHours / 24)}d`;

      return `
        <div class="token-row" data-address="${escapeHtml(token.address)}">
          <div class="token-main">
            <span class="token-symbol">${escapeHtml(token.symbol)}</span>
            <span class="token-name">${escapeHtml(token.name.slice(0, 20))}</span>
          </div>
          <div class="token-price">
            <span class="token-price-val">$${this.formatPrice(token.price)}</span>
            <span class="token-change" style="color: ${changeColor}">${changeSign}${token.priceChange24h.toFixed(1)}%</span>
          </div>
          <div class="token-meta">
            <span class="token-vol">Vol: $${this.formatNum(token.volume24h)}</span>
            <span class="token-liq">Liq: $${this.formatNum(token.liquidity)}</span>
            <span class="token-age">${ageLabel}</span>
          </div>
          <div class="token-rug" style="color: ${rugColor}">
            <span class="rug-score">${token.rugScore}</span>
            <span class="rug-verdict">${escapeHtml(token.rugVerdict)}</span>
          </div>
        </div>
      `;
    }).join('');

    // Click handler for token details
    this.content.querySelectorAll('.token-row').forEach(row => {
      row.addEventListener('click', () => {
        const addr = (row as HTMLElement).dataset.address;
        if (addr) {
          window.open(`https://solscan.io/token/${addr}`, '_blank', 'noopener');
        }
      });
    });
  }

  private getRugColor(verdict: string): string {
    switch (verdict) {
      case 'SAFE': return '#14F195';
      case 'CAUTION': return '#FFD700';
      case 'HIGH_RISK': return '#FF8844';
      case 'CRITICAL': return '#FF4444';
      default: return '#888';
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
