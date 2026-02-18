import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type {
  XInsightsData,
  XInsightsMetrics,
  XSearchResult,
  XTweet,
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
        'Trending tweets and keyword search powered by Bright Data.',
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

    // If user is searching, show search results
    if (this.searchResults) {
      this.content.innerHTML = `
        <div class="xi-container">
          ${searchBarHtml}
          ${this.renderSearchResults()}
        </div>
      `;
      this.bindSearchEvents();
      return;
    }

    // Auto-feed: pending state
    if (this.data?.status === 'pending') {
      this.content.innerHTML = `
        <div class="xi-container">
          ${searchBarHtml}
          <div class="xi-search-pending">
            <div class="xi-spinner"></div>
            <span>Scraping X for Solana tweets…</span>
          </div>
        </div>
      `;
      this.bindSearchEvents();
      return;
    }

    // Auto-feed: metrics + trending tweets
    const metricsHtml = this.data?.metrics
      ? this.renderMetrics(this.data.metrics)
      : '';
    const postsHtml = this.data?.trending && this.data.trending.length > 0
      ? this.renderTrendingPosts(this.data.trending)
      : '';

    this.content.innerHTML = `
      <div class="xi-container">
        ${searchBarHtml}
        ${metricsHtml}
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
  /*  Engagement Metrics Grid (computed from Bright Data tweets)         */
  /* ------------------------------------------------------------------ */

  private renderMetrics(m: XInsightsMetrics): string {
    return `
      <div class="xi-section">
        <div class="xi-section-title">SOLANA ON 𝕏</div>
        <div class="xi-metrics-grid">
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.tweetCount)}</span>
            <span class="xi-metric-lbl">Tweets</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.totalEngagement)}</span>
            <span class="xi-metric-lbl">Engagement</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.totalLikes)}</span>
            <span class="xi-metric-lbl">Likes</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.totalRetweets)}</span>
            <span class="xi-metric-lbl">Retweets</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.totalReplies)}</span>
            <span class="xi-metric-lbl">Replies</span>
          </div>
          <div class="xi-metric">
            <span class="xi-metric-val">${this.fmtNum(m.topReach)}</span>
            <span class="xi-metric-lbl">Top Reach</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /*  Trending Posts (Bright Data auto-feed)                             */
  /* ------------------------------------------------------------------ */

  private renderTrendingPosts(tweets: XTweet[]): string {
    const top = tweets.slice(0, 15);
    const html = top.map(t => this.renderTweet(t)).join('');

    return `
      <div class="xi-section">
        <div class="xi-section-title">TRENDING ON 𝕏</div>
        <div class="xi-posts-list">${html}</div>
      </div>
    `;
  }

  private renderTweet(t: XTweet): string {
    const dateStr = t.date ? this.formatDate(t.date) : '';
    const followersStr = this.fmtNum(t.followers);
    const link = t.url
      ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="xi-post-link" title="View on X">↗</a>`
      : '';

    return `
      <div class="xi-post">
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
