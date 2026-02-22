import { Panel } from './Panel';
import { mlWorker } from '@/services/ml-worker';
import { generateSummary } from '@/services/summarization';
import { parallelAnalysis, type AnalyzedHeadline } from '@/services/parallel-analysis';
import { isMobileDevice } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import type { ClusteredEvent } from '@/types';

export class InsightsPanel extends Panel {
  private isHidden = false;
  private cachedBrief: string | null = null;
  private lastMissedStories: AnalyzedHeadline[] = [];
  private static readonly BRIEF_CACHE_KEY = 'summary:world-brief';

  // State for on-demand summarization
  private currentClusters: ClusteredEvent[] = [];
  private currentSentiments: Array<{ label: string; score: number }> | null = null;
  private isSummarizing = false;

  constructor() {
    super({
      id: 'insights',
      title: 'AI INSIGHTS',
      showCount: false,
      infoTooltip: `
        <strong>AI-Powered Crypto Analysis</strong><br>
        • <strong>Market Brief</strong>: AI summary (Groq/OpenRouter)<br>
        • <strong>Sentiment</strong>: Crypto news tone analysis<br>
        • <strong>Velocity</strong>: Fast-moving stories<br>
        • <strong>Focal Points</strong>: Key events affecting Solana & crypto markets<br>
        <em>Desktop only • Powered by Llama 3.3</em>
      `,
    });

    if (isMobileDevice()) {
      this.hide();
      this.isHidden = true;
    }
  }

  private async loadBriefFromCache(): Promise<boolean> {
    if (this.cachedBrief) return false;
    const entry = await getPersistentCache<{ summary: string }>(InsightsPanel.BRIEF_CACHE_KEY);
    if (!entry?.data?.summary) return false;
    this.cachedBrief = entry.data.summary;
    return true;
  }
  // High-priority crypto/market-moving keywords (huge boost)
  private static readonly MILITARY_KEYWORDS = [
    'hack', 'exploit', 'hacked', 'drained', 'stolen', 'rugpull', 'rug pull',
    'bridge hack', 'flash loan', 'vulnerability', 'zero-day', 'compromised',
    'breach', 'attack', 'malicious', 'phishing', 'scam', 'ponzi',
  ];

  // Market crash/panic keywords (huge boost - financial impact)
  private static readonly VIOLENCE_KEYWORDS = [
    'crash', 'plunge', 'dump', 'liquidated', 'liquidation', 'cascade',
    'bank run', 'depeg', 'insolvency', 'bankrupt', 'bankruptcy', 'contagion',
    'collapse', 'meltdown', 'wipeout', 'loss', 'losses', 'seized',
  ];

  // Regulatory/compliance keywords (high boost)
  private static readonly UNREST_KEYWORDS = [
    'sec', 'cftc', 'regulation', 'lawsuit', 'charged', 'indicted', 'enforcement',
    'ban', 'crackdown', 'investigation', 'compliance', 'sanction', 'sanctions',
    'fine', 'penalty', 'subpoena', 'settlement', 'fraud',
  ];

  // Key crypto entities and ecosystems (major boost)
  private static readonly FLASHPOINT_KEYWORDS = [
    'solana', 'sol', 'bitcoin', 'btc', 'ethereum', 'eth', 'defi',
    'binance', 'coinbase', 'tether', 'usdc', 'usdt', 'circle',
    'jupiter', 'jito', 'marinade', 'raydium', 'phantom',
    'blackrock', 'fidelity', 'etf', 'grayscale', 'stablecoin',
  ];

  // Market-moving events (moderate boost)
  private static readonly CRISIS_KEYWORDS = [
    'breaking', 'urgent', 'exclusive', 'alert', 'surge', 'rally',
    'bullish', 'bearish', 'all-time high', 'ath', 'halving',
    'airdrop', 'listing', 'delisting', 'partnership', 'upgrade',
    'mainnet', 'fork', 'migration', 'launch', 'tokenomics',
  ];

  // Non-crypto noise that should REDUCE score
  private static readonly DEMOTE_KEYWORDS = [
    'sports', 'celebrity', 'entertainment', 'movie', 'music',
    'weather', 'recipe', 'fashion', 'horoscope',
  ];

  private getImportanceScore(cluster: ClusteredEvent): number {
    let score = 0;
    const titleLower = cluster.primaryTitle.toLowerCase();

    // Source confirmation (base signal)
    score += cluster.sourceCount * 10;

    // Violence/casualty keywords: highest priority (+100 base, +25 per match)
    // "Pools of blood" type stories should always surface
    const violenceMatches = InsightsPanel.VIOLENCE_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (violenceMatches.length > 0) {
      score += 100 + (violenceMatches.length * 25);
    }

    // Military keywords: highest priority (+80 base, +20 per match)
    const militaryMatches = InsightsPanel.MILITARY_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (militaryMatches.length > 0) {
      score += 80 + (militaryMatches.length * 20);
    }

    // Civil unrest: high priority (+70 base, +18 per match)
    const unrestMatches = InsightsPanel.UNREST_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (unrestMatches.length > 0) {
      score += 70 + (unrestMatches.length * 18);
    }

    // Flashpoint keywords: high priority (+60 base, +15 per match)
    const flashpointMatches = InsightsPanel.FLASHPOINT_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (flashpointMatches.length > 0) {
      score += 60 + (flashpointMatches.length * 15);
    }

    // COMBO BONUS: Hack/crash + key entity = critical story
    // e.g., "Solana hack" + "drained" = huge boost
    if ((violenceMatches.length > 0 || unrestMatches.length > 0) && flashpointMatches.length > 0) {
      score *= 1.5; // 50% bonus for entity + crisis combo
    }

    // Crisis keywords: moderate priority (+30 base, +10 per match)
    const crisisMatches = InsightsPanel.CRISIS_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (crisisMatches.length > 0) {
      score += 30 + (crisisMatches.length * 10);
    }

    // Demote business/tech news that happens to contain military words
    const demoteMatches = InsightsPanel.DEMOTE_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (demoteMatches.length > 0) {
      score *= 0.3; // Heavy penalty for business context
    }

    // Velocity multiplier
    const velMultiplier: Record<string, number> = {
      'viral': 3,
      'spike': 2.5,
      'elevated': 1.5,
      'normal': 1
    };
    score *= velMultiplier[cluster.velocity?.level ?? 'normal'] ?? 1;

    // Alert bonus
    if (cluster.isAlert) score += 50;

    // Recency bonus (decay over 12 hours)
    const ageMs = Date.now() - cluster.firstSeen.getTime();
    const ageHours = ageMs / 3600000;
    const recencyMultiplier = Math.max(0.5, 1 - (ageHours / 12));
    score *= recencyMultiplier;

    return score;
  }

  private selectTopStories(clusters: ClusteredEvent[], maxCount: number): ClusteredEvent[] {
    // Score ALL clusters first - high-scoring stories override source requirements
    const allScored = clusters
      .map(c => ({ cluster: c, score: this.getImportanceScore(c) }));

    // Filter: require at least 2 sources OR alert OR elevated velocity OR moderate score
    // Score > 50 means crypto-relevant keywords matched - Solana stories often single-source
    const candidates = allScored.filter(({ cluster: c, score }) =>
      c.sourceCount >= 2 ||
      c.isAlert ||
      (c.velocity && c.velocity.level !== 'normal') ||
      score > 50  // Lower threshold so single-source Solana stories surface
    );

    // Sort by score
    const scored = candidates.sort((a, b) => b.score - a.score);

    // Select with source diversity (max 3 from same primary source)
    const selected: ClusteredEvent[] = [];
    const sourceCount = new Map<string, number>();
    const MAX_PER_SOURCE = 3;

    for (const { cluster } of scored) {
      const source = cluster.primarySource;
      const count = sourceCount.get(source) || 0;

      if (count < MAX_PER_SOURCE) {
        selected.push(cluster);
        sourceCount.set(source, count + 1);
      }

      if (selected.length >= maxCount) break;
    }

    return selected;
  }

  private setProgress(step: number, total: number, message: string): void {
    const percent = Math.round((step / total) * 100);
    this.setContent(`
      <div class="insights-progress">
        <div class="insights-progress-bar">
          <div class="insights-progress-fill" style="width: ${percent}%"></div>
        </div>
        <div class="insights-progress-info">
          <span class="insights-progress-step">Step ${step}/${total}</span>
          <span class="insights-progress-message">${message}</span>
        </div>
      </div>
    `);
  }

  public async updateInsights(clusters: ClusteredEvent[]): Promise<void> {
    if (this.isHidden) return;

    if (clusters.length === 0) {
      this.setDataBadge('unavailable');
      this.setContent('<div class="insights-empty">Waiting for news data...</div>');
      return;
    }

    const totalSteps = 3;

    try {
      // Step 1: Filter and rank stories by composite importance score
      this.setProgress(1, totalSteps, 'Ranking important stories...');

      const importantClusters = this.selectTopStories(clusters, 8);

      // Run parallel multi-perspective analysis in background
      const parallelPromise = parallelAnalysis.analyzeHeadlines(clusters).then(report => {
        this.lastMissedStories = report.missedByKeywords;
        const suggestions = parallelAnalysis.getSuggestedImprovements();
        if (suggestions.length > 0) {
          console.log('%c💡 Improvement Suggestions:', 'color: #f59e0b; font-weight: bold');
          suggestions.forEach(s => console.log(`  • ${s}`));
        }
      }).catch(err => {
        console.warn('[ParallelAnalysis] Error:', err);
      });

      if (importantClusters.length === 0) {
        this.setContent('<div class="insights-empty">No breaking or multi-source stories yet</div>');
        return;
      }

      const titles = importantClusters.map(c => c.primaryTitle);

      // Step 2: Analyze sentiment (browser-based, fast)
      this.setProgress(2, totalSteps, 'Analyzing sentiment...');
      let sentiments: Array<{ label: string; score: number }> | null = null;

      if (mlWorker.isAvailable) {
        sentiments = await mlWorker.classifySentiment(titles).catch(() => null);
      }

      // Step 3: Load cached brief if available (no auto-generation)
      await this.loadBriefFromCache();
      const worldBrief = this.cachedBrief;

      this.setDataBadge(worldBrief ? 'cached' : 'unavailable');

      // Step 4: Wait for parallel analysis to complete
      this.setProgress(3, totalSteps, 'Multi-perspective analysis...');
      await parallelPromise;

      // Store state for on-demand summarization
      this.currentClusters = importantClusters;
      this.currentSentiments = sentiments;

      this.renderInsights(importantClusters, sentiments, worldBrief);
    } catch (error) {
      console.error('[InsightsPanel] Error:', error);
      this.setContent('<div class="insights-error">Analysis failed - retrying...</div>');
    }
  }

  private renderInsights(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null,
    worldBrief: string | null
  ): void {
    const briefHtml = worldBrief ? this.renderWorldBrief(worldBrief) : this.renderSummarizeButton();
    const sentimentOverview = this.renderSentimentOverview(sentiments);
    const breakingHtml = this.renderBreakingStories(clusters, sentiments);
    const statsHtml = this.renderStats(clusters);
    const missedHtml = this.renderMissedStories();

    this.setContent(`
      ${briefHtml}
      ${sentimentOverview}
      ${statsHtml}
      <div class="insights-section">
        <div class="insights-section-title">BREAKING & CONFIRMED</div>
        ${breakingHtml}
      </div>
      ${missedHtml}
    `);

    // Bind summarize button if brief not yet generated
    if (!worldBrief) {
      this.bindSummarizeButton();
    }
  }

  private renderWorldBrief(brief: string): string {
    return `
      <div class="insights-brief">
        <div class="insights-section-title">📊 MARKET BRIEF</div>
        <div class="insights-brief-text">${escapeHtml(brief)}</div>
      </div>
    `;
  }

  private renderSummarizeButton(): string {
    return `
      <div class="insights-brief">
        <button class="insights-summarize-btn" id="insights-summarize-btn">
          📊 Summarize
        </button>
      </div>
    `;
  }

  private bindSummarizeButton(): void {
    const btn = this.content?.querySelector('#insights-summarize-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.addEventListener('click', () => void this.onSummarizeClick());
  }

  private async onSummarizeClick(): Promise<void> {
    if (this.isSummarizing) return;
    this.isSummarizing = true;

    const btn = this.content?.querySelector('#insights-summarize-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Generating...';
    }

    try {
      const titles = this.currentClusters.map(c => c.primaryTitle);
      if (titles.length === 0) return;

      const result = await generateSummary(titles, (_step, _total, msg) => {
        if (btn) btn.textContent = `⏳ ${msg}`;
      }, '');

      if (result) {
        this.cachedBrief = result.summary;
        void setPersistentCache(InsightsPanel.BRIEF_CACHE_KEY, { summary: result.summary });
        this.setDataBadge(result.cached ? 'cached' : 'live');
        console.log(`[InsightsPanel] Brief generated${result.cached ? ' (cached)' : ''}`);

        // Re-render with the brief
        this.renderInsights(this.currentClusters, this.currentSentiments, result.summary);
      } else {
        if (btn) btn.textContent = '❌ Failed — tap to retry';
        if (btn) btn.disabled = false;
      }
    } catch (err) {
      console.error('[InsightsPanel] Summarize error:', err);
      if (btn) {
        btn.textContent = '❌ Failed — tap to retry';
        btn.disabled = false;
      }
    } finally {
      this.isSummarizing = false;
    }
  }

  private renderBreakingStories(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null
  ): string {
    return clusters.map((cluster, i) => {
      const sentiment = sentiments?.[i];
      const sentimentClass = sentiment?.label === 'negative' ? 'negative' :
        sentiment?.label === 'positive' ? 'positive' : 'neutral';

      const badges: string[] = [];

      if (cluster.sourceCount >= 3) {
        badges.push(`<span class="insight-badge confirmed">✓ ${cluster.sourceCount} sources</span>`);
      } else if (cluster.sourceCount >= 2) {
        badges.push(`<span class="insight-badge multi">${cluster.sourceCount} sources</span>`);
      }

      if (cluster.velocity && cluster.velocity.level !== 'normal') {
        const velIcon = cluster.velocity.trend === 'rising' ? '↑' : '';
        badges.push(`<span class="insight-badge velocity ${cluster.velocity.level}">${velIcon}+${cluster.velocity.sourcesPerHour}/hr</span>`);
      }

      if (cluster.isAlert) {
        badges.push('<span class="insight-badge alert">⚠ ALERT</span>');
      }

      return `
        <div class="insight-story">
          <div class="insight-story-header">
            <span class="insight-sentiment-dot ${sentimentClass}"></span>
            <span class="insight-story-title">${escapeHtml(cluster.primaryTitle.slice(0, 100))}${cluster.primaryTitle.length > 100 ? '...' : ''}</span>
          </div>
          ${badges.length > 0 ? `<div class="insight-badges">${badges.join('')}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  private renderSentimentOverview(sentiments: Array<{ label: string; score: number }> | null): string {
    if (!sentiments || sentiments.length === 0) {
      return '';
    }

    const negative = sentiments.filter(s => s.label === 'negative').length;
    const positive = sentiments.filter(s => s.label === 'positive').length;
    const neutral = sentiments.length - negative - positive;

    const total = sentiments.length;
    const negPct = Math.round((negative / total) * 100);
    const neuPct = Math.round((neutral / total) * 100);
    const posPct = 100 - negPct - neuPct;

    let toneLabel = 'Mixed';
    let toneClass = 'neutral';
    if (negative > positive + neutral) {
      toneLabel = 'Negative';
      toneClass = 'negative';
    } else if (positive > negative + neutral) {
      toneLabel = 'Positive';
      toneClass = 'positive';
    }

    return `
      <div class="insights-sentiment-bar">
        <div class="sentiment-bar-track">
          <div class="sentiment-bar-negative" style="width: ${negPct}%"></div>
          <div class="sentiment-bar-neutral" style="width: ${neuPct}%"></div>
          <div class="sentiment-bar-positive" style="width: ${posPct}%"></div>
        </div>
        <div class="sentiment-bar-labels">
          <span class="sentiment-label negative">${negative}</span>
          <span class="sentiment-label neutral">${neutral}</span>
          <span class="sentiment-label positive">${positive}</span>
        </div>
        <div class="sentiment-tone ${toneClass}">Overall: ${toneLabel}</div>
      </div>
    `;
  }

  private renderStats(clusters: ClusteredEvent[]): string {
    const multiSource = clusters.filter(c => c.sourceCount >= 2).length;
    const fastMoving = clusters.filter(c => c.velocity && c.velocity.level !== 'normal').length;
    const alerts = clusters.filter(c => c.isAlert).length;

    return `
      <div class="insights-stats">
        <div class="insight-stat">
          <span class="insight-stat-value">${multiSource}</span>
          <span class="insight-stat-label">Multi-source</span>
        </div>
        <div class="insight-stat">
          <span class="insight-stat-value">${fastMoving}</span>
          <span class="insight-stat-label">Fast-moving</span>
        </div>
        ${alerts > 0 ? `
        <div class="insight-stat alert">
          <span class="insight-stat-value">${alerts}</span>
          <span class="insight-stat-label">Alerts</span>
        </div>
        ` : ''}
      </div>
    `;
  }

  private renderMissedStories(): string {
    if (this.lastMissedStories.length === 0) {
      return '';
    }

    const storiesHtml = this.lastMissedStories.slice(0, 3).map(story => {
      const topPerspective = story.perspectives
        .filter(p => p.name !== 'keywords')
        .sort((a, b) => b.score - a.score)[0];

      const perspectiveName = topPerspective?.name ?? 'ml';
      const perspectiveScore = topPerspective?.score ?? 0;

      return `
        <div class="insight-story missed">
          <div class="insight-story-header">
            <span class="insight-sentiment-dot ml-flagged"></span>
            <span class="insight-story-title">${escapeHtml(story.title.slice(0, 80))}${story.title.length > 80 ? '...' : ''}</span>
          </div>
          <div class="insight-badges">
            <span class="insight-badge ml-detected">🔬 ${perspectiveName}: ${(perspectiveScore * 100).toFixed(0)}%</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="insights-section insights-missed">
        <div class="insights-section-title">🎯 ML DETECTED</div>
        ${storiesHtml}
      </div>
    `;
  }
}
