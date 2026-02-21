// Network Status Panel — TPS, slot, epoch, validators, priority fees
// Core Solana health dashboard — fee data from Helius getPriorityFeeEstimate

import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface HeliusFees {
  min: number;
  low: number;
  medium: number;
  high: number;
  veryHigh: number;
  unsafeMax: number;
}

interface NetworkData {
  tps: number;
  slot: number;
  epoch: number;
  epochProgress: number;
  validatorCount: number;
  delinquentCount: number;
  totalStakeSOL: number;
  feeLevels: HeliusFees;
  health: 'healthy' | 'degraded' | 'down';
  timestamp: number;
}

export class NetworkStatusPanel extends Panel {
  private data: NetworkData | null = null;

  constructor() {
    super({
      id: 'network-status',
      title: 'Network Status',
      className: 'network-status-panel',
      infoTooltip: 'Real-time Solana network health: TPS, epoch progress, validator count, and priority fee levels from Helius RPC.',
    });
    this.render();
  }

  public update(data: NetworkData): void {
    this.data = data;
    this.render();
  }

  private fmtFee(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = `<div class="panel-loading">Connecting to Solana...</div>`;
      return;
    }

    const d = this.data;
    const healthColor = d.health === 'healthy' ? '#14F195' : d.health === 'degraded' ? '#FFD700' : '#FF4444';
    const healthIcon = d.health === 'healthy' ? '●' : d.health === 'degraded' ? '◐' : '○';
    const tpsColor = d.tps > 2000 ? '#14F195' : d.tps > 1000 ? '#FFD700' : '#FF4444';
    const fl = d.feeLevels;

    this.content.innerHTML = `
      <div class="net-status-grid">
        <div class="net-stat primary">
          <div class="net-stat-value" style="color: ${tpsColor}">${d.tps.toLocaleString()}</div>
          <div class="net-stat-label">TPS</div>
        </div>
        <div class="net-stat">
          <div class="net-stat-value">${d.slot.toLocaleString()}</div>
          <div class="net-stat-label">Slot</div>
        </div>
        <div class="net-stat">
          <div class="net-stat-value">${d.epoch}</div>
          <div class="net-stat-label">Epoch</div>
        </div>
        <div class="net-stat">
          <div class="net-stat-value" style="color: ${healthColor}">${healthIcon} ${escapeHtml(d.health.toUpperCase())}</div>
          <div class="net-stat-label">Health</div>
        </div>
      </div>

      <div class="net-epoch-bar">
        <div class="net-epoch-progress" style="width: ${d.epochProgress}%"></div>
        <span class="net-epoch-label">Epoch ${d.epoch} — ${d.epochProgress}%</span>
      </div>

      <div class="net-details">
        <div class="net-detail-row">
          <span class="net-detail-key">Validators</span>
          <span class="net-detail-val">${d.validatorCount.toLocaleString()}</span>
        </div>
        <div class="net-detail-row">
          <span class="net-detail-key">Delinquent</span>
          <span class="net-detail-val" style="color: ${d.delinquentCount > 50 ? '#FF4444' : '#888'}">${d.delinquentCount}</span>
        </div>
        <div class="net-detail-row">
          <span class="net-detail-key">Total Stake</span>
          <span class="net-detail-val">${(d.totalStakeSOL / 1e6).toFixed(1)}M SOL</span>
        </div>
      </div>

      <div class="net-fee-levels">
        <span class="net-fee-title">Priority Fees <small>μ◎/CU</small></span>
        <div class="net-fee-level">
          <span class="fee-badge fee-low">Low</span>
          <span>${this.fmtFee(fl.low)}</span>
        </div>
        <div class="net-fee-level">
          <span class="fee-badge fee-med">Medium</span>
          <span>${this.fmtFee(fl.medium)}</span>
        </div>
        <div class="net-fee-level">
          <span class="fee-badge fee-high">High</span>
          <span>${this.fmtFee(fl.high)}</span>
        </div>
        <div class="net-fee-level">
          <span class="fee-badge fee-turbo">Very High</span>
          <span>${this.fmtFee(fl.veryHigh)}</span>
        </div>
      </div>
    `;
  }
}
