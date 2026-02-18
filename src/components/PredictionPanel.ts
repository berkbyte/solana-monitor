import { Panel } from './Panel';
import type { PredictionMarket } from '@/types';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

export class PredictionPanel extends Panel {
  private static readonly CRYPTO_KEYWORDS = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
    'defi', 'token', 'coin', 'nft', 'blockchain', 'web3', 'binance',
    'sec', 'etf', 'stablecoin', 'usdc', 'usdt', 'tether', 'cbdc',
    'digital asset', 'virtual currency', 'coinbase', 'ripple', 'xrp',
    'doge', 'memecoin', 'airdrop', 'staking', 'mining', 'halving',
    'altcoin', 'market cap', 'fed', 'interest rate', 'inflation',
    'treasury', 'gdp', 'recession', 'stock', 'nasdaq', 'sp500',
    's&p', 'dollar', 'gold', 'oil', 'commodity', 'tariff', 'trade',
  ];

  constructor() {
    super({
      id: 'polymarket',
      title: 'Prediction Markets',
      infoTooltip: `<strong>Prediction Markets</strong>
        Real-money forecasting markets:
        <ul>
          <li>Prices reflect crowd probability estimates</li>
          <li>Higher volume = more reliable signal</li>
          <li>Crypto & financial markets focus</li>
        </ul>
        Source: Polymarket (polymarket.com)`,
    });
  }

  private formatVolume(volume?: number): string {
    if (!volume) return '';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  }

  public renderPredictions(data: PredictionMarket[]): void {
    if (data.length === 0) {
      this.showError('Failed to load predictions');
      return;
    }

    // Filter for crypto/finance-related predictions
    const filtered = data.filter(p => {
      const titleLower = p.title.toLowerCase();
      return PredictionPanel.CRYPTO_KEYWORDS.some(kw => titleLower.includes(kw));
    });

    // If too few crypto predictions, show all but sort crypto first
    const displayData = filtered.length >= 3 ? filtered : [
      ...filtered,
      ...data.filter(p => !filtered.includes(p)),
    ].slice(0, 20);

    const html = displayData
      .map((p) => {
        const yesPercent = Math.round(p.yesPrice);
        const noPercent = 100 - yesPercent;
        const volumeStr = this.formatVolume(p.volume);

        const safeUrl = sanitizeUrl(p.url || '');
        const titleHtml = safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="prediction-question prediction-link">${escapeHtml(p.title)}</a>`
          : `<div class="prediction-question">${escapeHtml(p.title)}</div>`;

        return `
      <div class="prediction-item">
        ${titleHtml}
        ${volumeStr ? `<div class="prediction-volume">Vol: ${volumeStr}</div>` : ''}
        <div class="prediction-bar">
          <div class="prediction-yes" style="width: ${yesPercent}%">
            <span class="prediction-label">Yes ${yesPercent}%</span>
          </div>
          <div class="prediction-no" style="width: ${noPercent}%">
            <span class="prediction-label">No ${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
      })
      .join('');

    this.setContent(html);
  }
}
