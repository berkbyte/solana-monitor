// Priority Fees Panel — real-time Solana priority fee tracker
import { Panel } from './Panel';

interface FeeLevel {
  label: string;
  lamports: number;
  microLamports: number;
  description: string;
}

interface PriorityFeeData {
  levels: FeeLevel[];
  percentiles: { p25: number; p50: number; p75: number; p99: number };
  avgFee: number;
  medianFee: number;
  congestionLevel: 'low' | 'normal' | 'high' | 'extreme';
  recentSlots: number;
  timestamp: number;
}

export class PriorityFeesPanel extends Panel {
  private data: PriorityFeeData | null = null;

  constructor() {
    super({
      id: 'priority-fees',
      title: 'Priority Fees',
      className: 'priority-fees-panel',
      infoTooltip: 'Real-time Solana priority fee levels. Based on recent slot data. Use these to set compute unit prices for faster transaction landing.',
    });

    this.render();
  }

  public update(data: PriorityFeeData): void {
    this.data = data;
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = '<div class="panel-loading">Loading fee data...</div>';
      return;
    }

    const d = this.data;
    const congestionColor = this.getCongestionColor(d.congestionLevel);

    this.content.innerHTML = `
      <div class="fee-overview">
        <div class="fee-congestion" style="border-color: ${congestionColor}">
          <span class="fee-congestion-label">Network Congestion</span>
          <span class="fee-congestion-value" style="color: ${congestionColor}">
            ${d.congestionLevel.toUpperCase()}
          </span>
        </div>

        <div class="fee-levels">
          ${d.levels.map(level => `
            <div class="fee-level-card">
              <div class="fee-level-header">
                <span class="fee-level-label">${level.label}</span>
                <span class="fee-level-desc">${level.description}</span>
              </div>
              <div class="fee-level-value">
                <span class="fee-micro">${level.microLamports.toLocaleString()}</span>
                <span class="fee-unit">μ◎/CU</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="fee-percentiles">
          <span class="fee-section-title">Fee Percentiles (last ${d.recentSlots} slots)</span>
          <div class="fee-percentile-grid">
            <div class="fee-pct">
              <span class="pct-label">P25</span>
              <span class="pct-value">${d.percentiles.p25.toLocaleString()}</span>
            </div>
            <div class="fee-pct">
              <span class="pct-label">P50</span>
              <span class="pct-value">${d.percentiles.p50.toLocaleString()}</span>
            </div>
            <div class="fee-pct">
              <span class="pct-label">P75</span>
              <span class="pct-value">${d.percentiles.p75.toLocaleString()}</span>
            </div>
            <div class="fee-pct">
              <span class="pct-label">P99</span>
              <span class="pct-value">${d.percentiles.p99.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getCongestionColor(level: string): string {
    switch (level) {
      case 'low': return '#14F195';
      case 'normal': return '#44AAFF';
      case 'high': return '#FFD700';
      case 'extreme': return '#FF4444';
      default: return '#888';
    }
  }
}
