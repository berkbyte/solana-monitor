// Token Analyze Panel — paste a CA, get deep token analysis with risk + signal
// Now with tabs: Token Analyze + X Sentiment
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';
import type { TokenAnalysis, RiskFactor } from '../services/token-analyze';
import type { SentimentReport, TweetSentiment } from '../services/x-sentiment';

type TabId = 'analyze' | 'sentiment';

export class TokenAnalyzePanel extends Panel {
  private analysis: TokenAnalysis | null = null;
  private sentimentReport: SentimentReport | null = null;
  private isLoading = false;
  private isSentimentLoading = false;
  private activeTab: TabId = 'analyze';
  private history: TokenAnalysis[] = [];
  private tabBar!: HTMLElement;
  private hideBots = true; // hide bot tweets by default


  constructor() {
    super({
      id: 'token-analyze',
      title: 'Token Analyze',
      showCount: false,
      className: 'token-analyze-panel',
      infoTooltip: 'Paste a Solana token contract address to get deep analysis: price, risk factors, holder distribution, authority checks, and buy/sell signal.',
    });

    this.addSearchBar();
    this.addTabBar();
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

  private addTabBar(): void {
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'ta-tab-bar';
    this.tabBar.innerHTML = `
      <button class="ta-tab active" data-tab="analyze">🔬 Token Analyze</button>
      <button class="ta-tab" data-tab="sentiment">𝕏 Sentiment</button>
    `;
    this.tabBar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.ta-tab') as HTMLElement;
      if (!btn) return;
      const tab = btn.dataset.tab as TabId;
      if (tab && tab !== this.activeTab) {
        this.activeTab = tab;
        this.tabBar.querySelectorAll('.ta-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderActiveTab();
      }
    });
    // Insert tab bar after search
    const search = this.element.querySelector('.token-analyze-search');
    if (search) {
      search.after(this.tabBar);
    } else {
      this.header.after(this.tabBar);
    }
  }

  private renderActiveTab(): void {
    if (this.activeTab === 'analyze') {
      if (this.isLoading) {
        this.showLoadingUI('Analyzing token...');
      } else if (this.analysis) {
        this.renderAnalysis();
      } else {
        this.renderEmpty();
      }
    } else {
      if (this.isSentimentLoading) {
        this.showLoadingUI('Scanning X for mentions...');
      } else if (this.sentimentReport) {
        this.renderSentiment();
      } else {
        this.renderSentimentEmpty();
      }
    }
  }

  private showLoadingUI(text: string): void {
    this.content.innerHTML = `
      <div class="panel-loading">
        <div class="panel-loading-radar">
          <div class="panel-radar-sweep"></div>
          <div class="panel-radar-dot"></div>
        </div>
        <div class="panel-loading-text">${escapeHtml(text)}</div>
      </div>
    `;
  }

  /** Set the input field value (used when triggering analyze from external panels) */
  public setInputValue(mint: string): void {
    const input = this.element.querySelector('.token-analyze-input') as HTMLInputElement;
    if (input) input.value = mint;
  }

  public setLoading(): void {
    this.isLoading = true;
    this.isSentimentLoading = true;
    this.activeTab = 'analyze';
    this.tabBar.querySelectorAll('.ta-tab').forEach(b => b.classList.remove('active'));
    this.tabBar.querySelector('[data-tab="analyze"]')?.classList.add('active');
    this.showLoadingUI('Analyzing token...');
  }

  public setAnalysis(analysis: TokenAnalysis): void {
    this.isLoading = false;
    this.analysis = analysis;
    // Add to history (dedup by mint)
    this.history = [analysis, ...this.history.filter(h => h.mint !== analysis.mint)].slice(0, 10);
    if (this.activeTab === 'analyze') {
      this.renderAnalysis();
    }
  }

  public setSentimentLoading(): void {
    this.isSentimentLoading = true;
    if (this.activeTab === 'sentiment') {
      this.showLoadingUI('Scanning X for mentions...');
    }
  }

  public setSentimentReport(report: SentimentReport): void {
    this.isSentimentLoading = false;
    this.sentimentReport = report;
    if (this.activeTab === 'sentiment') {
      this.renderSentiment();
    }
    // Update tab badge
    this.updateSentimentBadge(report);
  }

  public setSentimentError(msg: string): void {
    this.isSentimentLoading = false;
    this.sentimentReport = null;
    if (this.activeTab === 'sentiment') {
      this.content.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
    }
  }

  private updateSentimentBadge(report: SentimentReport): void {
    const sentimentTab = this.tabBar.querySelector('[data-tab="sentiment"]');
    if (!sentimentTab) return;
    // Remove existing badge
    sentimentTab.querySelector('.ta-tab-badge')?.remove();
    if (report.status === 'ready' && report.totalTweets > 0) {
      const color = report.overallLabel === 'bullish' ? '#14F195' :
                    report.overallLabel === 'bearish' ? '#FF4444' : '#FFD700';
      const badge = document.createElement('span');
      badge.className = 'ta-tab-badge';
      badge.style.background = color;
      badge.textContent = String(report.totalTweets);
      sentimentTab.appendChild(badge);
    }
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

  private renderSentimentEmpty(): void {
    this.content.innerHTML = `
      <div class="token-analyze-empty">
        <div class="token-analyze-empty-icon">𝕏</div>
        <div class="token-analyze-empty-text">Paste a CA above to see X/Twitter sentiment</div>
        <div class="token-analyze-empty-sub">Tweet mentions, sentiment analysis, engagement metrics</div>
      </div>
    `;
  }

  private renderAnalysis(): void {
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
          <div class="ta-holders-title">Top Holders <span class="ta-holders-note">(pools excluded)</span></div>
          <div class="ta-holder-bar">
            <div class="ta-holder-top1" style="width: ${Math.min(100, a.topHolderPercent)}%"></div>
            <div class="ta-holder-top10" style="width: ${Math.min(100, Math.max(0, a.top10HolderPercent - a.topHolderPercent))}%"></div>
          </div>
          <span class="ta-holder-summary">Top holder: ${a.topHolderPercent.toFixed(1)}% | Top 10: ${a.top10HolderPercent.toFixed(1)}%</span>
          ${a.topHolders && a.topHolders.length > 0 ? `
            <div class="ta-holder-list">
              ${a.topHolders.map((h, i) => {
                const pctColor = h.pct > 20 ? '#FF4444' : h.pct > 10 ? '#FF8844' : h.pct > 5 ? '#FFD700' : '#14F195';
                const shortAddr = h.owner ? h.owner.slice(0, 4) + '...' + h.owner.slice(-4) : '???';
                const label = h.label ? `<span class="ta-holder-label">${escapeHtml(h.label)}</span>` : '';
                const insiderBadge = h.isInsider ? '<span class="ta-holder-insider">INSIDER</span>' : '';
                const warnIcon = h.pct > 15 ? ' ⚠️' : '';
                return `
                  <div class="ta-holder-row ${h.pct > 15 ? 'ta-holder-danger' : h.pct > 5 ? 'ta-holder-warn' : ''}">
                    <span class="ta-holder-rank">#${i + 1}</span>
                    <a class="ta-holder-addr" href="https://solscan.io/account/${escapeHtml(h.owner)}" target="_blank" rel="noopener">${shortAddr}</a>
                    ${label}${insiderBadge}
                    <span class="ta-holder-pct" style="color: ${pctColor}">${h.pct.toFixed(2)}%${warnIcon}</span>
                    <div class="ta-holder-pct-bar"><div class="ta-holder-pct-fill" style="width: ${Math.min(100, h.pct)}%; background: ${pctColor}"></div></div>
                  </div>`;
              }).join('')}
            </div>
          ` : '<div class="ta-holder-empty">No holder data available</div>'}
          ${a.top10HolderPercent > 50 ? '<div class="ta-holder-warning">⚠️ Top 10 holders control over 50% — high concentration risk</div>' : ''}
          ${a.topHolderPercent > 20 ? '<div class="ta-holder-warning">⚠️ Single holder has over 20% — potential dump risk</div>' : ''}
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

  }

  /* ============================================================
     X SENTIMENT TAB RENDERING
     ============================================================ */

  private renderSentiment(): void {
    const r = this.sentimentReport;
    if (!r || r.status === 'no-data') {
      this.content.innerHTML = `
        <div class="token-analyze-empty">
          <div class="token-analyze-empty-icon">𝕏</div>
          <div class="token-analyze-empty-text">No tweets found for this token</div>
          <div class="token-analyze-empty-sub">This CA has no recent mentions on X/Twitter</div>
        </div>
      `;
      return;
    }
    if (r.status === 'error') {
      this.content.innerHTML = `<div class="error-message">${escapeHtml(r.error || 'Sentiment analysis failed')}</div>`;
      return;
    }

    const scoreColor = r.overallLabel === 'bullish' ? '#14F195' :
                        r.overallLabel === 'bearish' ? '#FF4444' : '#FFD700';
    const scoreEmoji = r.overallLabel === 'bullish' ? '🟢' :
                        r.overallLabel === 'bearish' ? '🔴' : '🟡';
    const weightedColor = r.weightedScore > 15 ? '#14F195' :
                          r.weightedScore < -15 ? '#FF4444' : '#FFD700';

    // Filter tweets based on hideBots toggle
    const visibleTweets = this.hideBots
      ? r.tweets.filter(t => t.botScore < 0.6 && !t.isDuplicate)
      : r.tweets;

    this.content.innerHTML = `
      <div class="xs-card">
        <!-- Overall sentiment header -->
        <div class="xs-header">
          <div class="xs-score-main">
            <span class="xs-score-emoji">${scoreEmoji}</span>
            <span class="xs-score-value" style="color: ${scoreColor}">${r.overallScore > 0 ? '+' : ''}${r.overallScore}</span>
            <span class="xs-score-label" style="color: ${scoreColor}">${r.overallLabel.toUpperCase()}</span>
          </div>
          <div class="xs-score-sub">
            <span>Weighted: <b style="color: ${weightedColor}">${r.weightedScore > 0 ? '+' : ''}${r.weightedScore}</b></span>
          </div>
        </div>

        <!-- Sentiment bar -->
        <div class="xs-bar-section">
          <div class="xs-bar">
            <div class="xs-bar-bullish" style="width: ${r.humanTweets ? (r.bullishCount / r.humanTweets * 100) : 0}%"></div>
            <div class="xs-bar-neutral" style="width: ${r.humanTweets ? (r.neutralCount / r.humanTweets * 100) : 0}%"></div>
            <div class="xs-bar-bearish" style="width: ${r.humanTweets ? (r.bearishCount / r.humanTweets * 100) : 0}%"></div>
          </div>
          <div class="xs-bar-labels">
            <span class="xs-bar-label bullish">🟢 ${r.bullishCount} Bullish</span>
            <span class="xs-bar-label neutral">🟡 ${r.neutralCount} Neutral</span>
            <span class="xs-bar-label bearish">🔴 ${r.bearishCount} Bearish</span>
          </div>
        </div>

        <!-- Stats -->
        <div class="xs-stats">
          <div class="xs-stat"><span class="xs-stat-label">Human</span><span class="xs-stat-value">${r.humanTweets}<span class="xs-stat-dim">/${r.totalTweets}</span></span></div>
          <div class="xs-stat"><span class="xs-stat-label">Avg Followers</span><span class="xs-stat-value">${this.fmtNum(r.avgFollowers)}</span></div>
          <div class="xs-stat"><span class="xs-stat-label">Engagement</span><span class="xs-stat-value">${this.fmtNum(r.totalEngagement)}</span></div>
          ${r.botFiltered > 0 ? `<div class="xs-stat xs-stat-bot"><span class="xs-stat-label">🤖 Bots</span><span class="xs-stat-value">${r.botFiltered}</span></div>` : ''}
          ${r.duplicatesRemoved > 0 ? `<div class="xs-stat xs-stat-dupe"><span class="xs-stat-label">♻️ Dupes</span><span class="xs-stat-value">${r.duplicatesRemoved}</span></div>` : ''}
        </div>

        <!-- Bot filter toggle -->
        <div class="xs-filter-bar">
          <label class="xs-toggle">
            <input type="checkbox" class="xs-toggle-input" id="xsHideBots" ${this.hideBots ? 'checked' : ''} />
            <span class="xs-toggle-slider"></span>
            <span class="xs-toggle-label">Hide bots & duplicates</span>
          </label>
          ${r.botFiltered > 0 || r.duplicatesRemoved > 0
            ? `<span class="xs-filter-info">${r.botFiltered + r.duplicatesRemoved} filtered</span>`
            : ''}
        </div>

        <!-- Tweet list -->
        <div class="xs-tweets-title">Recent Mentions <span class="xs-tweets-count">${visibleTweets.length} shown</span></div>
        <div class="xs-tweets">
          ${visibleTweets.map(t => this.renderSentimentTweet(t)).join('')}
        </div>
      </div>
    `;

    // Hide bots toggle handler
    const toggle = this.content.querySelector('#xsHideBots') as HTMLInputElement;
    if (toggle) {
      toggle.addEventListener('change', () => {
        this.hideBots = toggle.checked;
        this.renderSentiment();
      });
    }

    // External link handlers
    this.content.querySelectorAll('.xs-tweet-link').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  private renderSentimentTweet(ts: TweetSentiment): string {
    const t = ts.tweet;
    const sentColor = ts.sentiment === 'bullish' ? '#14F195' :
                      ts.sentiment === 'bearish' ? '#FF4444' : '#FFD700';
    const sentIcon = ts.sentiment === 'bullish' ? '🟢' :
                     ts.sentiment === 'bearish' ? '🔴' : '🟡';
    const timeAgo = this.tweetTimeAgo(t.date);
    const shortText = t.text.length > 200 ? t.text.slice(0, 200) + '...' : t.text;
    const botPct = Math.round(ts.botScore * 100);
    const isBot = ts.botScore >= 0.6;
    const isSuspect = ts.botScore >= 0.4 && ts.botScore < 0.6;

    // Bot/dupe CSS classes
    const tweetClasses = [
      'xs-tweet',
      isBot ? 'xs-tweet-bot' : '',
      isSuspect ? 'xs-tweet-suspect' : '',
      ts.isDuplicate ? 'xs-tweet-dupe' : '',
    ].filter(Boolean).join(' ');

    // Badges
    const botBadge = isBot
      ? `<span class="xs-bot-badge xs-bot-high" title="Bot probability: ${botPct}%">🤖 ${botPct}%</span>`
      : isSuspect
        ? `<span class="xs-bot-badge xs-bot-mid" title="Bot probability: ${botPct}%">🤖 ${botPct}%</span>`
        : '';
    const dupeBadge = ts.isDuplicate ? '<span class="xs-dupe-badge">♻️ Dupe</span>' : '';
    const verifiedBadge = t.verified ? '<span class="xs-verified-badge" title="Verified">✓</span>' : '';

    return `
      <div class="${tweetClasses}">
        <div class="xs-tweet-header">
          ${t.avatar ? `<img class="xs-tweet-avatar" src="${escapeHtml(t.avatar)}" alt="" onerror="this.style.display='none'" />` : ''}
          <div class="xs-tweet-author">
            <span class="xs-tweet-name">${escapeHtml(t.author)}${verifiedBadge}</span>
            <span class="xs-tweet-handle">@${escapeHtml(t.handle)}</span>
          </div>
          ${botBadge}${dupeBadge}
          <span class="xs-tweet-sentiment" style="color: ${sentColor}">${sentIcon}</span>
          <span class="xs-tweet-time">${timeAgo}</span>
        </div>
        <div class="xs-tweet-text">${escapeHtml(shortText)}</div>
        <div class="xs-tweet-metrics">
          <span class="xs-tweet-metric">❤️ ${this.fmtMetric(t.likes)}</span>
          <span class="xs-tweet-metric">🔁 ${this.fmtMetric(t.retweets)}</span>
          <span class="xs-tweet-metric">💬 ${this.fmtMetric(t.replies)}</span>
          <span class="xs-tweet-metric">👁 ${this.fmtMetric(t.views)}</span>
          ${t.followers > 1000 ? `<span class="xs-tweet-metric followers">👥 ${this.fmtMetric(t.followers)}</span>` : ''}
        </div>
        ${ts.matchedKeywords.length > 0 ? `
          <div class="xs-tweet-keywords">
            ${ts.matchedKeywords.slice(0, 5).map(kw => {
              const cls = kw.startsWith('+') ? 'kw-bull' : 'kw-bear';
              return `<span class="xs-kw ${cls}">${escapeHtml(kw)}</span>`;
            }).join('')}
          </div>
        ` : ''}
        <a class="xs-tweet-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">View on X ↗</a>
      </div>
    `;
  }

  private tweetTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  private fmtMetric(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
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
