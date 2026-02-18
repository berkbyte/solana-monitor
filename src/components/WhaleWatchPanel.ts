// Whale Watch Panel — large transaction feed with wallet labels
// Shows real-time whale movements on Solana

import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface WhaleEntry {
  signature: string;
  type: 'transfer' | 'swap' | 'stake' | 'nft_trade' | 'dex_trade' | 'defi' | 'unknown';
  wallet: string;
  walletLabel: string;
  direction: 'in' | 'out';
  amount: number;
  amountUsd: number;
  tokenSymbol: string;
  counterpartyLabel: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class WhaleWatchPanel extends Panel {
  private entries: WhaleEntry[] = [];
  private filter: 'all' | 'critical' | 'swap' | 'transfer' = 'all';

  constructor() {
    super({
      id: 'whale-watch',
      title: 'Whale Watch',
      showCount: true,
      className: 'whale-watch-panel',
      infoTooltip: 'Tracks large Solana transactions from known whale wallets. Severity: Critical ($5M+), High ($1M+), Medium ($500K+), Low ($100K+).',
    });

    this.addFilterControls();
    this.render();
  }

  private addFilterControls(): void {
    const controls = document.createElement('div');
    controls.className = 'whale-filter-controls';
    controls.innerHTML = `
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="critical">🔴 Big</button>
      <button class="filter-btn" data-filter="swap">Swaps</button>
      <button class="filter-btn" data-filter="transfer">Transfers</button>
    `;
    controls.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.filter-btn') as HTMLElement;
      if (!btn) return;
      controls.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.filter = (btn.dataset.filter as typeof this.filter) || 'all';
      this.render();
    });
    this.header.appendChild(controls);
  }

  public update(entries: WhaleEntry[]): void {
    this.entries = entries;
    this.updateCount(entries.length);
    this.render();
  }

  private getFiltered(): WhaleEntry[] {
    if (this.filter === 'all') return this.entries;
    if (this.filter === 'critical') return this.entries.filter(e => e.severity === 'critical' || e.severity === 'high');
    return this.entries.filter(e => e.type === this.filter);
  }

  private render(): void {
    const filtered = this.getFiltered();

    if (filtered.length === 0) {
      this.content.innerHTML = `<div class="panel-loading">${this.entries.length === 0 ? 'Watching for whales...' : 'No matching transactions'}</div>`;
      return;
    }

    this.content.innerHTML = filtered.slice(0, 50).map(entry => {
      const severityColor = this.getSeverityColor(entry.severity);
      const typeIcon = this.getTypeIcon(entry.type);
      const timeAgo = this.timeAgo(entry.timestamp);
      const dirIcon = entry.direction === 'in' ? '←' : '→';

      return `
        <div class="whale-row severity-${escapeHtml(entry.severity)}" data-sig="${escapeHtml(entry.signature)}">
          <div class="whale-icon" style="color: ${severityColor}">${typeIcon}</div>
          <div class="whale-info">
            <div class="whale-main">
              <span class="whale-label">${escapeHtml(entry.walletLabel)}</span>
              <span class="whale-dir">${dirIcon}</span>
              <span class="whale-counter">${escapeHtml(entry.counterpartyLabel)}</span>
            </div>
            <div class="whale-detail">
              <span class="whale-amount" style="color: ${severityColor}">
                ${this.formatAmount(entry.amountUsd)} ${escapeHtml(entry.tokenSymbol)}
              </span>
              <span class="whale-time">${timeAgo}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Click to open on Solscan
    this.content.querySelectorAll('.whale-row').forEach(row => {
      row.addEventListener('click', () => {
        const sig = (row as HTMLElement).dataset.sig;
        if (sig) {
          window.open(`https://solscan.io/tx/${sig}`, '_blank', 'noopener');
        }
      });
    });
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return '#FF4444';
      case 'high': return '#FF8844';
      case 'medium': return '#FFD700';
      case 'low': return '#14F195';
      default: return '#888';
    }
  }

  private getTypeIcon(type: string): string {
    switch (type) {
      case 'swap': return '⇄';
      case 'transfer': return '↗';
      case 'stake': return '⊕';
      case 'nft_trade': return '◆';
      default: return '•';
    }
  }

  private formatAmount(usd: number): string {
    if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
    if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
    return `$${usd.toFixed(0)}`;
  }

  private timeAgo(ts: number): string {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  }
}
