import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface ETFData {
  ticker: string;
  issuer: string;
  name?: string;
  type?: string;
  status?: 'active' | 'unavailable';
  price: number;
  priceChange: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  direction: 'inflow' | 'outflow' | 'neutral';
  estFlow: number;
  aum?: number;
  exchange?: string;
}

interface ETFFlowsResult {
  timestamp: string;
  asset?: string;
  solPrice?: number;
  solChange24h?: number;
  dataSource?: string;
  summary: {
    etfCount: number;
    activeCount?: number;
    totalVolume: number;
    totalEstFlow: number;
    netDirection: string;
    inflowCount: number;
    outflowCount: number;
  };
  etfs: ETFData[];
  unavailable?: boolean;
}

function fmtVol(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function fmtUsd(v: number): string {
  return `$${fmtVol(Math.abs(v))}`;
}

function flowCls(direction: string): string {
  if (direction === 'inflow') return 'flow-inflow';
  if (direction === 'outflow') return 'flow-outflow';
  return 'flow-neutral';
}

function changeCls(val: number): string {
  if (val > 0.1) return 'change-positive';
  if (val < -0.1) return 'change-negative';
  return 'change-neutral';
}

function typeBadge(type?: string): string {
  if (type === 'trust') return '<span class="etf-badge etf-badge-trust">Trust</span>';
  if (type === 'spot-etf') return '<span class="etf-badge etf-badge-spot">Spot</span>';
  if (type === 'staking-etf') return '<span class="etf-badge etf-badge-staking">Staking</span>';
  if (type === 'leveraged') return '<span class="etf-badge etf-badge-leveraged">2×</span>';
  if (type === 'futures') return '<span class="etf-badge etf-badge-futures">Futures</span>';
  return '';
}

export class ETFFlowsPanel extends Panel {
  private data: ETFFlowsResult | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'etf-flows', title: 'Solana ETF Tracker', showCount: false });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 3 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/api/etf-flows');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading Solana ETF data…');
      return;
    }

    if (this.error || !this.data) {
      this.showError(this.error || 'No data available');
      return;
    }

    if (this.data.unavailable) {
      this.showError('ETF data source temporarily unavailable — will retry');
      return;
    }

    const d = this.data;
    if (!d.etfs.length) {
      this.setContent('<div class="panel-loading-text">No Solana ETF data available</div>');
      return;
    }

    const s = d.summary;
    const dirClass = flowCls(
      s.netDirection.includes('INFLOW') ? 'inflow'
        : s.netDirection.includes('OUTFLOW') ? 'outflow'
        : 'neutral'
    );

    // ── SOL price header ──
    const solPx = d.solPrice ? d.solPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
    const solChg = d.solChange24h ?? 0;
    const solChgStr = `${solChg >= 0 ? '+' : ''}${solChg.toFixed(1)}%`;
    const solChgCls = changeCls(solChg);

    // ── Source badge ──
    const srcBadge = d.dataSource === 'yahoo-finance'
      ? '<span class="etf-source-badge etf-src-live">Yahoo Finance</span>'
      : '<span class="etf-source-badge etf-src-est">Unavailable</span>';

    // ── Table rows ──
    // Only show active ETFs in the table (skip unavailable)
    const activeEtfs = d.etfs.filter(etf => etf.status === 'active');
    const rows = activeEtfs.map(etf => {
      const flowSign = etf.direction === 'inflow' ? '+' : etf.direction === 'outflow' ? '−' : '';
      const aumStr = etf.aum ? fmtUsd(etf.aum) : '—';
      const volRatioStr = etf.volumeRatio > 0 ? `${etf.volumeRatio.toFixed(1)}×` : '—';
      const statusDot = '<span class="etf-status-dot etf-dot-active" title="Live data"></span>';
      const nameStr = etf.name ? `<span class="etf-name">${escapeHtml(etf.name)}</span>` : '';

      return `
      <tr class="etf-row">
        <td class="etf-ticker">${statusDot}${escapeHtml(etf.ticker)} ${typeBadge(etf.type)}${nameStr}</td>
        <td class="etf-issuer">${escapeHtml(etf.issuer)}</td>
        <td class="etf-aum">${aumStr}</td>
        <td class="etf-flow ${flowCls(etf.direction)}">${flowSign}${fmtUsd(etf.estFlow)}</td>
        <td class="etf-volume">${fmtVol(etf.volume)}<span class="etf-vol-ratio">${volRatioStr}</span></td>
        <td class="etf-change ${changeCls(etf.priceChange)}">${etf.priceChange > 0 ? '+' : ''}${etf.priceChange.toFixed(2)}%</td>
      </tr>`;
    }).join('');

    const html = `
      <div class="etf-flows-container">
        <div class="etf-header-row">
          <span class="etf-sol-price">SOL <strong>$${escapeHtml(solPx)}</strong> <span class="${solChgCls}">${solChgStr}</span></span>
          ${srcBadge}
        </div>
        <div class="etf-summary ${dirClass}">
          <div class="etf-summary-item">
            <span class="etf-summary-label">24h Net Flow</span>
            <span class="etf-summary-value ${dirClass}">${escapeHtml(s.netDirection)}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">Est. Flow</span>
            <span class="etf-summary-value ${s.totalEstFlow >= 0 ? 'flow-inflow' : 'flow-outflow'}">${fmtUsd(s.totalEstFlow)}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">Total Volume</span>
            <span class="etf-summary-value">${fmtVol(s.totalVolume)}</span>
          </div>
          <div class="etf-summary-item">
            <span class="etf-summary-label">Products</span>
            <span class="etf-summary-value">${s.inflowCount}<span class="flow-inflow">↑</span> ${s.outflowCount}<span class="flow-outflow">↓</span></span>
          </div>
        </div>
        <div class="etf-table-wrap">
          <table class="etf-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Issuer</th>
                <th>AUM</th>
                <th>Est. Flow</th>
                <th>Volume</th>
                <th>Chg%</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    this.setContent(html);
  }
}
