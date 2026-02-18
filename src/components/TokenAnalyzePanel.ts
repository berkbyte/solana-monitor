// Token Analyze Panel — paste a CA, get deep token analysis with risk + signal
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';
import type { TokenAnalysis, RiskFactor } from '../services/token-analyze';
import type { CATweetResult } from '../services/twitter-ca-search';

export class TokenAnalyzePanel extends Panel {
  private analysis: TokenAnalysis | null = null;
  private isLoading = false;
  private history: TokenAnalysis[] = [];
  private tweetResult: CATweetResult | null = null;

  constructor() {
    super({
      id: 'token-analyze',
      title: 'Token Analyze',
      showCount: false,
      className: 'token-analyze-panel',
      infoTooltip: 'Paste a Solana token contract address to get deep analysis: price, risk factors, holder distribution, authority checks, and buy/sell signal.',
    });

    this.addSearchBar();
    this.renderEmpty();
  }

  private addSearchBar(): void {
    const search = document.createElement('div');
    search.className = 'token-analyze-search';
    search.innerHTML = `
      <input type="text" class="token-analyze-input" placeholder="Paste token CA (contract address)..." spellcheck="false" />
      <button class="token-analyze-btn">Analyze</button>
    `;
    const input = search.querySelector('.token-analyze-input') as HTMLInputElement;
    const btn = search.querySelector('.token-analyze-btn') as HTMLButtonElement;

    btn.addEventListener('click', () => {
      const mint = input.value.trim();
      if (mint && !this.isLoading) {
        this.element.dispatchEvent(new CustomEvent('token-analyze', {
          detail: { mint },
          bubbles: true,
        }));
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    });

    // Paste event — auto-analyze
    input.addEventListener('paste', () => {
      setTimeout(() => {
        const mint = input.value.trim();
        if (mint && mint.length >= 32) {
          this.element.dispatchEvent(new CustomEvent('token-analyze', {
            detail: { mint },
            bubbles: true,
          }));
        }
      }, 50);
    });

    this.header.after(search);
  }

  public setLoading(): void {
    this.isLoading = true;
    this.content.innerHTML = `
      <div class="panel-loading">
        <div class="panel-loading-radar">
          <div class="panel-radar-sweep"></div>
          <div class="panel-radar-dot"></div>
        </div>
        <div class="panel-loading-text">Analyzing token...</div>
      </div>
    `;
  }

  public setAnalysis(analysis: TokenAnalysis): void {
    this.isLoading = false;
    this.analysis = analysis;
    // Add to history (dedup by mint)
    this.history = [analysis, ...this.history.filter(h => h.mint !== analysis.mint)].slice(0, 10);
    this.render();
  }

  public setTweets(result: CATweetResult): void {
    this.tweetResult = result;
    // Re-render tweet section without full re-render
    const container = this.content.querySelector('.ta-tweets-section');
    if (container) {
      container.outerHTML = this.renderTweets();
      this.wireTweetLinks();
    } else if (this.analysis) {
      // Insert tweet section before history
      const historyEl = this.content.querySelector('.ta-history');
      const cardEl = this.content.querySelector('.ta-card');
      if (cardEl) {
        const tweetDiv = document.createElement('div');
        tweetDiv.innerHTML = this.renderTweets();
        if (historyEl) {
          historyEl.before(tweetDiv.firstElementChild!);
        } else {
          cardEl.after(tweetDiv.firstElementChild!);
        }
        this.wireTweetLinks();
      }
    }

    // SocialData API is synchronous — no polling needed
    // (tweets are returned immediately with 'ready' status)
  }

  public setError(msg: string): void {
    this.isLoading = false;
    this.content.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
  }

  private renderEmpty(): void {
    this.content.innerHTML = `
      <div class="token-analyze-empty">
        <div class="token-analyze-empty-icon">🔍</div>
        <div class="token-analyze-empty-text">Paste a Solana token contract address above to analyze</div>
        <div class="token-analyze-empty-sub">Risk factors, price data, holder distribution, buy/sell signal</div>
      </div>
    `;
  }

  private render(): void {
    if (!this.analysis) {
      this.renderEmpty();
      return;
    }

    const a = this.analysis;
    const signalClass = this.getSignalClass(a.signal);
    const riskClass = this.getRiskClass(a.riskLevel);
    const riskColor = this.getRiskColor(a.riskScore);
    const signalColor = this.getSignalColor(a.signal);
    const ageStr = this.formatAge(a.pairCreatedAt);

    this.content.innerHTML = `
      <div class="ta-card">
        <!-- Header: token info + signal -->
        <div class="ta-header">
          <div class="ta-token-info">
            ${a.imageUrl ? `<img class="ta-token-img" src="${escapeHtml(a.imageUrl)}" alt="" onerror="this.style.display='none'" />` : ''}
            <div class="ta-token-name">
              <span class="ta-symbol">${escapeHtml(a.symbol)}</span>
              <span class="ta-name">${escapeHtml(a.name)}</span>
            </div>
          </div>
          <div class="ta-signal ${signalClass}" style="background: ${signalColor}">
            ${a.signal.replace('_', ' ')}
          </div>
        </div>

        <!-- Price row -->
        <div class="ta-price-row">
          <span class="ta-price">$${this.fmtPrice(a.priceUsd)}</span>
          <div class="ta-changes">
            <span class="ta-change ${a.priceChange5m >= 0 ? 'positive' : 'negative'}">5m: ${a.priceChange5m >= 0 ? '+' : ''}${a.priceChange5m.toFixed(1)}%</span>
            <span class="ta-change ${a.priceChange1h >= 0 ? 'positive' : 'negative'}">1h: ${a.priceChange1h >= 0 ? '+' : ''}${a.priceChange1h.toFixed(1)}%</span>
            <span class="ta-change ${a.priceChange6h >= 0 ? 'positive' : 'negative'}">6h: ${a.priceChange6h >= 0 ? '+' : ''}${a.priceChange6h.toFixed(1)}%</span>
            <span class="ta-change ${a.priceChange24h >= 0 ? 'positive' : 'negative'}">24h: ${a.priceChange24h >= 0 ? '+' : ''}${a.priceChange24h.toFixed(1)}%</span>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="ta-stats">
          <div class="ta-stat"><span class="ta-stat-label">MCap</span><span class="ta-stat-value">$${this.fmtNum(a.marketCap)}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">Liquidity</span><span class="ta-stat-value">$${this.fmtNum(a.liquidity)}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">Vol 24h</span><span class="ta-stat-value">$${this.fmtNum(a.volume24h)}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">Age</span><span class="ta-stat-value">${ageStr}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">Buys 24h</span><span class="ta-stat-value positive">${a.txCount24h.buys.toLocaleString()}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">Sells 24h</span><span class="ta-stat-value negative">${a.txCount24h.sells.toLocaleString()}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">DEX</span><span class="ta-stat-value">${escapeHtml(a.dexName)}</span></div>
          <div class="ta-stat"><span class="ta-stat-label">FDV</span><span class="ta-stat-value">$${this.fmtNum(a.fdv)}</span></div>
        </div>

        <!-- Risk score -->
        <div class="ta-risk-section">
          <div class="ta-risk-header">
            <span class="ta-risk-title">Risk Score</span>
            <div class="ta-risk-badge ${riskClass}" style="background: ${riskColor}">
              <span class="ta-risk-score">${a.riskScore}</span>
              <span class="ta-risk-label">${a.riskLevel}</span>
            </div>
          </div>
          <div class="ta-risk-bar-bg">
            <div class="ta-risk-bar-fill" style="width: ${a.riskScore}%; background: ${riskColor}"></div>
          </div>
        </div>

        <!-- Authorities -->
        <div class="ta-authorities">
          <span class="ta-auth ${a.mintAuthority === 'revoked' ? 'auth-safe' : 'auth-danger'}">
            Mint: ${a.mintAuthority}
          </span>
          <span class="ta-auth ${a.freezeAuthority === 'revoked' ? 'auth-safe' : 'auth-danger'}">
            Freeze: ${a.freezeAuthority}
          </span>
          <span class="ta-auth ${a.liquidityLocked ? 'auth-safe' : 'auth-danger'}">
            LP: ${a.liquidityLocked ? 'Locked' : 'Unlocked'}
          </span>
          <span class="ta-auth ${a.lpBurned ? 'auth-safe' : 'auth-warn'}">
            LP Burned: ${a.lpBurned ? 'Yes' : 'No'}
          </span>
        </div>

        <!-- Top holders -->
        <div class="ta-holders">
          <div class="ta-holder-bar">
            <div class="ta-holder-top1" style="width: ${Math.min(100, a.topHolderPercent)}%"></div>
            <div class="ta-holder-top10" style="width: ${Math.min(100, Math.max(0, a.top10HolderPercent - a.topHolderPercent))}%"></div>
          </div>
          <span class="ta-holder-label">Top holder: ${a.topHolderPercent.toFixed(1)}% | Top 10: ${a.top10HolderPercent.toFixed(1)}%</span>
        </div>

        <!-- Risk factors -->
        <div class="ta-factors">
          <span class="ta-factors-title">Risk Factors</span>
          ${a.riskFactors.map(f => this.renderFactor(f)).join('')}
        </div>

        <!-- Signal reasons -->
        <div class="ta-signal-section">
          <span class="ta-signal-title">Signal: <b style="color: ${signalColor}">${a.signal.replace('_', ' ')}</b></span>
          <ul class="ta-signal-reasons">
            ${a.signalReasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>

        ${a.honeypotRisk ? '<div class="ta-honeypot-warn">⚠️ HONEYPOT INDICATORS DETECTED — DO NOT BUY</div>' : ''}

        <!-- Links -->
        <div class="ta-links">
          <a href="https://dexscreener.com/solana/${escapeHtml(a.mint)}" target="_blank" rel="noopener">DexScreener</a>
          <a href="https://rugcheck.xyz/tokens/${escapeHtml(a.mint)}" target="_blank" rel="noopener">RugCheck</a>
          <a href="https://birdeye.so/token/${escapeHtml(a.mint)}?chain=solana" target="_blank" rel="noopener">Birdeye</a>
          <a href="https://solscan.io/token/${escapeHtml(a.mint)}" target="_blank" rel="noopener">Solscan</a>
        </div>
      </div>

      ${this.renderTweets()}

      ${this.history.length > 1 ? this.renderHistory() : ''}
    `;

    // Click handlers for history items
    this.content.querySelectorAll('.ta-history-item').forEach(el => {
      el.addEventListener('click', () => {
        const mint = (el as HTMLElement).dataset.mint;
        if (mint) {
          const input = this.element.querySelector('.token-analyze-input') as HTMLInputElement;
          if (input) input.value = mint;
          this.element.dispatchEvent(new CustomEvent('token-analyze', {
            detail: { mint },
            bubbles: true,
          }));
        }
      });
    });

    // External links
    this.content.querySelectorAll('.ta-links a').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });

    // Tweet links
    this.wireTweetLinks();
  }

  /* ====================== Twitter/X CA Mentions ====================== */

  private renderTweets(): string {
    if (!this.tweetResult) {
      return `
        <div class="ta-tweets-section">
          <div class="ta-tweets-title">𝕏 CA MENTIONS</div>
          <div class="ta-tweets-loading">
            <span class="ta-tweets-spinner"></span>
            Searching X for this CA...
          </div>
        </div>
      `;
    }

    if (this.tweetResult.status === 'pending') {
      return `
        <div class="ta-tweets-section">
          <div class="ta-tweets-title">𝕏 CA MENTIONS</div>
          <div class="ta-tweets-loading">
            <span class="ta-tweets-spinner"></span>
            Scanning X/Twitter for mentions...
          </div>
        </div>
      `;
    }

    if (this.tweetResult.status === 'error') {
      return `
        <div class="ta-tweets-section">
          <div class="ta-tweets-title">𝕏 CA MENTIONS</div>
          <div class="ta-tweets-empty">Could not fetch tweets</div>
        </div>
      `;
    }

    const tweets = this.tweetResult.tweets;
    if (tweets.length === 0) {
      return `
        <div class="ta-tweets-section">
          <div class="ta-tweets-title">𝕏 CA MENTIONS</div>
          <div class="ta-tweets-empty">No tweets found mentioning this CA</div>
        </div>
      `;
    }

    // Compute aggregate sentiment from tweet content
    const totalEngagement = tweets.reduce((s, t) => s + t.likes + t.retweets + t.replies, 0);

    const tweetsHtml = tweets.slice(0, 10).map(t => {
      const followersStr = t.followers >= 1000
        ? `${(t.followers / 1000).toFixed(t.followers >= 100_000 ? 0 : 1)}K`
        : String(t.followers);
      const link = t.url
        ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="ta-tweet-link">↗</a>`
        : '';
      const dateStr = t.date ? this.tweetTimeAgo(t.date) : '';

      return `
        <div class="ta-tweet">
          <div class="ta-tweet-header">
            <span class="ta-tweet-author">@${escapeHtml(t.handle || t.author)}</span>
            <span class="ta-tweet-followers">${followersStr}</span>
            <span class="ta-tweet-time">${dateStr}</span>
            ${link}
          </div>
          <div class="ta-tweet-text">${escapeHtml(t.text)}</div>
          <div class="ta-tweet-meta">
            <span class="ta-tweet-stat">❤️ ${this.fmtNum(t.likes)}</span>
            <span class="ta-tweet-stat">🔁 ${this.fmtNum(t.retweets)}</span>
            <span class="ta-tweet-stat">💬 ${this.fmtNum(t.replies)}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="ta-tweets-section">
        <div class="ta-tweets-title">
          𝕏 CA MENTIONS
          <span class="ta-tweets-count">${tweets.length} tweets · ${this.fmtNum(totalEngagement)} engagements</span>
        </div>
        <div class="ta-tweets-list">${tweetsHtml}</div>
      </div>
    `;
  }

  private wireTweetLinks(): void {
    this.content.querySelectorAll('.ta-tweet-link').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  private tweetTimeAgo(dateStr: string): string {
    const ts = new Date(dateStr).getTime();
    if (isNaN(ts)) return dateStr;
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  private renderFactor(f: RiskFactor): string {
    const icon = f.status === 'pass' ? '✓' : f.status === 'warn' ? '⚠' : '✗';
    const cls = f.status === 'pass' ? 'factor-pass' : f.status === 'warn' ? 'factor-warn' : 'factor-fail';
    return `
      <div class="ta-factor ${cls}">
        <span class="ta-factor-icon">${icon}</span>
        <span class="ta-factor-name">${escapeHtml(f.name)}</span>
        <span class="ta-factor-detail">${escapeHtml(f.detail)}</span>
      </div>
    `;
  }

  private renderHistory(): string {
    return `
      <div class="ta-history">
        <span class="ta-history-title">Recent Analyses</span>
        ${this.history.slice(1).map(h => `
          <div class="ta-history-item" data-mint="${escapeHtml(h.mint)}">
            <span class="ta-history-symbol">${escapeHtml(h.symbol)}</span>
            <span class="ta-history-price">$${this.fmtPrice(h.priceUsd)}</span>
            <span class="ta-history-change ${h.priceChange24h >= 0 ? 'positive' : 'negative'}">${h.priceChange24h >= 0 ? '+' : ''}${h.priceChange24h.toFixed(1)}%</span>
            <span class="ta-history-risk" style="color: ${this.getRiskColor(h.riskScore)}">${h.riskLevel}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  private fmtPrice(n: number): string {
    if (n === 0) return '0';
    if (n < 0.0001) return n.toExponential(2);
    if (n < 0.01) return n.toFixed(6);
    if (n < 1) return n.toFixed(4);
    if (n < 100) return n.toFixed(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  private fmtNum(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  private formatAge(pairCreatedAt: number): string {
    const hours = (Date.now() - pairCreatedAt) / 3_600_000;
    if (hours < 1) return `${Math.floor(hours * 60)}m`;
    if (hours < 24) return `${Math.floor(hours)}h`;
    if (hours < 720) return `${Math.floor(hours / 24)}d`;
    return `${Math.floor(hours / 720)}mo`;
  }

  private getSignalClass(signal: TokenAnalysis['signal']): string {
    switch (signal) {
      case 'STRONG_BUY': return 'signal-strong-buy';
      case 'BUY': return 'signal-buy';
      case 'HOLD': return 'signal-hold';
      case 'SELL': return 'signal-sell';
      case 'STRONG_SELL': return 'signal-strong-sell';
      case 'AVOID': return 'signal-avoid';
      default: return '';
    }
  }

  private getSignalColor(signal: TokenAnalysis['signal']): string {
    switch (signal) {
      case 'STRONG_BUY': return '#14F195';
      case 'BUY': return '#44cc88';
      case 'HOLD': return '#FFD700';
      case 'SELL': return '#FF8844';
      case 'STRONG_SELL': return '#FF4444';
      case 'AVOID': return '#CC0000';
      default: return '#888';
    }
  }

  private getRiskClass(level: TokenAnalysis['riskLevel']): string {
    switch (level) {
      case 'LOW': return 'risk-low';
      case 'MEDIUM': return 'risk-medium';
      case 'HIGH': return 'risk-high';
      case 'CRITICAL': return 'risk-critical';
      default: return '';
    }
  }

  private getRiskColor(score: number): string {
    if (score <= 25) return '#14F195';
    if (score <= 50) return '#FFD700';
    if (score <= 75) return '#FF8844';
    return '#FF4444';
  }
}
