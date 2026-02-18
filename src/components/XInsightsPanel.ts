import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type {
  XInsightsData,
  TopicMetrics,
  XSearchResult,
  XTweet,
  SocialPost,
  SocialTopicSummary,
} from '@/services/x-insights';

export class XInsightsPanel extends Panel {
  private data: XInsightsData | null = null;
  private searchResults: XSearchResult | null = null;
  private searchQuery = '';
  private isSearching = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      id: 'x-insights',
      title: '𝕏 Insights',
      className: 'x-insights-panel',
      infoTooltip:
        'Real-time X/Twitter intelligence for Solana. ' +
        'Social metrics via LunarCrush, on-demand keyword search via Bright Data scraper.',
    });

    this.content.innerHTML = this.renderEmpty();
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  update(data: XInsightsData): void {
    this.data = data;
    this.render();
  }

  setSearchResults(results: XSearchResult): void {
    this.searchResults = results;
    this.isSearching = false;

    // If pending, schedule a poll
    if (results.status === 'pending') {
      this.schedulePoll();
    }

    this.render();
  }

  setSearching(query: string): void {
    this.searchQuery = query;
    this.isSearching = true;
    this.searchResults = null;
    this.render();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = null;
    this.isSearching = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.render();
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  private render(): void {
    const searchBarHtml = this.renderSearchBar();
    const metricsHtml = this.data?.solana?.summary
      ? this.renderMetrics(this.data.solana.summary)
      : '';
    const topicsHtml = this.data?.topics && this.data.topics.length > 0
      ? this.renderTopicRadar(this.data.topics)
      : '';
    const postsHtml = this.searchResults
      ? this.renderSearchResults()
      : this.data?.solana?.posts && this.data.solana.posts.length > 0
        ? this.renderTrendingPosts(this.data.solana.posts)
        : '';

    this.content.innerHTML = `
      <div class="xi-container">
        ${searchBarHtml}
        ${metricsHtml}
        ${topicsHtml}
        ${postsHtml}
      </div>
    `;

    this.bindSearchEvents();
  }

  private renderEmpty(): string {
    return `
      <div class="xi-container">
        ${this.renderSearchBar()}
        <div class="xi-empty">Loading social intelligence…</div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Search Bar                                                         */
  /* ------------------------------------------------------------------ */

  private renderSearchBar(): string {
    const val = escapeHtml(this.searchQuery);
    return `
      <div class="xi-search-bar">
        <div class="xi-search-input-wrap">
          <span class="xi-search-icon">🔍</span>
          <input
            type="text"
            class="xi-search-input"
            placeholder="Search X — token, keyword, CA…"
            value="${val}"
            spellcheck="false"
            autocomplete="off"
          />
          ${this.searchQuery ? '<button class="xi-search-clear" title="Clear">✕</button>' : ''}
        </div>
        ${this.isSearching ? '<div class="xi-search-status">Searching X via Bright Data…</div>' : ''}
      </div>
    `;
  }

  private bindSearchEvents(): void {
    const input = this.content.querySelector('.xi-search-input') as HTMLInputElement;
    const clearBtn = this.content.querySelector('.xi-search-clear');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = input.value.trim();
          if (q.length >= 2) {
            this.element.dispatchEvent(
              new CustomEvent('x-search', { detail: { query: q }, bubbles: true })
            );
          }
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.element.dispatchEvent(
          new CustomEvent('x-search-clear', { bubbles: true })
        );
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Social Metrics Grid                                                */
  /* ------------------------------------------------------------------ */

  private renderMetrics(s: SocialTopicSummary): string {
    const volChange = s.socialVolumePrev24h > 0
      ? ((s.socialVolume24h - s.socialVolumePrev24h) / s.socialVolumePrev24h * 100)
      : 0;
    const volStr = volChange >= 0 ? `+${volChange.toFixed(0)}%` : `${volChange.toFixed(0)}%`;
    const volClass = volChange > 10 ? 'positive' : volChange < -10 ? 'negative' : 'neutral';

    const sentLabel = s.sentiment >= 4 ? 'Bullish' : s.sentiment >= 3 ? 'Neutral' : 'Bearish';
    const sentClass = s.sentiment >= 4 ? 'positive' : s.sentiment >= 3 ? 'neutral' : 'negative';
    const sentBar = Math.min(100, (s.sentiment / 5) * 100);

    const domStr = s.socialDominance > 0 ? `${s.socialDominance.toFixed(1)}%` : '—';

    return `
      <div class="xi-section">
        <div class="xi-section-title">SOLANA SOCIAL PULSE</div>
        <div class="xi-metrics-grid">
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(s.postsCount24h)}</span>
            <span class="xi-metric-lbl">Posts 24h</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val ${volClass}">${volStr}</span>
            <span class="xi-metric-lbl">Volume Δ</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(s.interactions24h)}</span>
            <span class="xi-metric-lbl">Interactions</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(s.contributors24h)}</span>
            <span class="xi-metric-lbl">Contributors</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val ${sentClass}">${sentLabel}</span>
            <div class="xi-sent-bar"><div class="xi-sent-fill ${sentClass}" style="width:${sentBar}%"></div></div>
            <span class="xi-metric-lbl">Sentiment</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${domStr}</span>
            <span class="xi-metric-lbl">Dominance</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Topic Radar                                                        */
  /* ------------------------------------------------------------------ */

  private renderTopicRadar(topics: TopicMetrics[]): string {
    const sorted = [...topics].sort((a, b) => b.interactions24h - a.interactions24h);
    const maxInteractions = sorted[0]?.interactions24h || 1;

    const rows = sorted.map(t => {
      const barW = Math.max(4, (t.interactions24h / maxInteractions) * 100);
      const sent = t.sentiment >= 4 ? 'positive' : t.sentiment >= 3 ? 'neutral' : 'negative';
      const volStr = t.volumeChange >= 0 ? `+${t.volumeChange.toFixed(0)}%` : `${t.volumeChange.toFixed(0)}%`;
      const volClass = t.volumeChange > 15 ? 'positive' : t.volumeChange < -15 ? 'negative' : 'neutral';
      const isSolana = t.topic === 'solana';

      return `
        <div class="xi-topic-row ${isSolana ? 'xi-topic-highlight' : ''}">
          <div class="xi-topic-name">${escapeHtml(t.label)}</div>
          <div class="xi-topic-bar-wrap">
            <div class="xi-topic-bar ${sent}" style="width:${barW}%"></div>
          </div>
          <div class="xi-topic-stats">
            <span class="xi-topic-posts">${this.fmtNum(t.posts24h)}</span>
            <span class="xi-topic-vol ${volClass}">${volStr}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="xi-section">
        <div class="xi-section-title">TOPIC RADAR</div>
        <div class="xi-topic-list">${rows}</div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Trending Posts (LunarCrush)                                        */
  /* ------------------------------------------------------------------ */

  private renderTrendingPosts(posts: SocialPost[]): string {
    const top = posts.slice(0, 8);
    const html = top.map(p => this.renderLCPost(p)).join('');

    return `
      <div class="xi-section">
        <div class="xi-section-title">TRENDING ON 𝕏</div>
        <div class="xi-posts-list">${html}</div>
      </div>
    `;
  }

  private renderLCPost(p: SocialPost): string {
    const timeAgo = this.timeAgo(p.postCreated);
    const sent = p.sentimentDetail >= 4 ? 'positive' : p.sentimentDetail <= 2 ? 'negative' : 'neutral';
    const followersStr = this.fmtNum(p.creatorFollowers);
    const link = p.postUrl
      ? `<a href="${escapeHtml(p.postUrl)}" target="_blank" rel="noopener" class="xi-post-link" title="View on X">↗</a>`
      : '';

    return `
      <div class="xi-post">
        <div class="xi-post-header">
          <span class="xi-post-author">${escapeHtml(p.creatorDisplayName || p.creator)}</span>
          <span class="xi-post-handle">@${escapeHtml(p.creator)}</span>
          <span class="xi-post-followers">${followersStr}</span>
          <span class="xi-post-time">${timeAgo}</span>
          ${link}
        </div>
        <div class="xi-post-text">${escapeHtml(p.text)}</div>
        <div class="xi-post-footer">
          <span class="xi-post-interactions">💬 ${this.fmtNum(p.interactions)}</span>
          <span class="xi-sent-dot ${sent}"></span>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Search Results (Bright Data)                                       */
  /* ------------------------------------------------------------------ */

  private renderSearchResults(): string {
    const r = this.searchResults!;

    if (r.status === 'pending') {
      return `
        <div class="xi-section">
          <div class="xi-section-title">SEARCH: "${escapeHtml(this.searchQuery)}"</div>
          <div class="xi-search-pending">
            <div class="xi-spinner"></div>
            <span>Scraping X for results — this may take a moment…</span>
          </div>
        </div>
      `;
    }

    if (r.status === 'error') {
      return `
        <div class="xi-section">
          <div class="xi-section-title">SEARCH: "${escapeHtml(this.searchQuery)}"</div>
          <div class="xi-search-error">Search failed: ${escapeHtml(r.error || 'Unknown')}</div>
        </div>
      `;
    }

    if (r.tweets.length === 0) {
      return `
        <div class="xi-section">
          <div class="xi-section-title">SEARCH: "${escapeHtml(this.searchQuery)}"</div>
          <div class="xi-empty">No tweets found for "${escapeHtml(this.searchQuery)}"</div>
        </div>
      `;
    }

    const tweetsHtml = r.tweets.slice(0, 15).map(t => this.renderSearchTweet(t)).join('');

    return `
      <div class="xi-section">
        <div class="xi-section-title">SEARCH: "${escapeHtml(this.searchQuery)}" <span class="xi-result-count">${r.tweets.length} results</span></div>
        <div class="xi-posts-list">${tweetsHtml}</div>
      </div>
    `;
  }

  private renderSearchTweet(t: XTweet): string {
    const dateStr = t.date ? this.formatDate(t.date) : '';
    const followersStr = this.fmtNum(t.followers);
    const link = t.url
      ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="xi-post-link" title="View on X">↗</a>`
      : '';

    return `
      <div class="xi-post xi-post-search">
        <div class="xi-post-header">
          <span class="xi-post-author">${escapeHtml(t.author)}</span>
          <span class="xi-post-handle">@${escapeHtml(t.handle)}</span>
          <span class="xi-post-followers">${followersStr}</span>
          <span class="xi-post-time">${dateStr}</span>
          ${link}
        </div>
        <div class="xi-post-text">${escapeHtml(t.text)}</div>
        <div class="xi-post-footer">
          <span class="xi-post-stat">❤ ${this.fmtNum(t.likes)}</span>
          <span class="xi-post-stat">🔁 ${this.fmtNum(t.retweets)}</span>
          <span class="xi-post-stat">💬 ${this.fmtNum(t.replies)}</span>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Poll for pending search                                            */
  /* ------------------------------------------------------------------ */

  private schedulePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.element.dispatchEvent(
        new CustomEvent('x-search-poll', {
          detail: { query: this.searchQuery },
          bubbles: true,
        })
      );
    }, 4000);
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
    return String(n);
  }

  private timeAgo(unixTs: number): string {
    if (!unixTs) return '';
    const diff = Math.floor(Date.now() / 1000 - unixTs);
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  private formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      const diff = Date.now() - d.getTime();
      if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
      if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
      if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }
}
