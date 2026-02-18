// Governance Panel — Solana governance proposals, Realms DAO votes
import { Panel } from './Panel';
import { escapeHtml } from '../utils/sanitize';

interface GovernanceProposal {
  id: string;
  title: string;
  dao: string;
  daoSlug: string;
  status: 'voting' | 'passed' | 'defeated' | 'cancelled' | 'draft';
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  quorumReached: boolean;
  endDate: number;
  description: string;
  proposer: string;
  platform: 'realms' | 'squads' | 'spl-governance' | 'other';
}

interface GovernanceData {
  activeProposals: GovernanceProposal[];
  recentPassed: GovernanceProposal[];
  totalDaos: number;
}

export class GovernancePanel extends Panel {
  private data: GovernanceData | null = null;

  constructor() {
    super({
      id: 'governance',
      title: 'Governance',
      showCount: true,
      className: 'governance-panel',
      infoTooltip: 'Active governance proposals from Solana DAOs. Tracks Realms, Squads, and SPL Governance platforms.',
    });

    this.render();
  }

  public update(data: GovernanceData): void {
    this.data = data;
    this.updateCount(data.activeProposals.length);
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.content.innerHTML = '<div class="panel-loading">Loading governance data...</div>';
      return;
    }

    const d = this.data;

    this.content.innerHTML = `
      <div class="gov-overview">
        <div class="gov-summary">
          <span class="gov-active-count">${d.activeProposals.length} active proposals</span>
          <span class="gov-dao-count">${d.totalDaos} DAOs tracked</span>
        </div>

        <div class="gov-proposal-list">
          ${d.activeProposals.slice(0, 15).map(p => {
            const totalVotes = p.votesFor + p.votesAgainst;
            const forPercent = totalVotes > 0 ? (p.votesFor / totalVotes) * 100 : 0;
            const timeLeft = this.getTimeLeft(p.endDate);
            const statusClass = `status-${p.status}`;

            return `
              <div class="gov-proposal-row ${statusClass}" data-id="${escapeHtml(p.id)}" data-dao="${escapeHtml(p.daoSlug)}">
                <div class="gov-proposal-header">
                  <span class="gov-dao-name">${escapeHtml(p.dao)}</span>
                  <span class="gov-platform">${escapeHtml(p.platform)}</span>
                  <span class="gov-time-left">${timeLeft}</span>
                </div>
                <div class="gov-proposal-title">${escapeHtml(p.title)}</div>
                <div class="gov-vote-bar-container">
                  <div class="gov-vote-bar">
                    <div class="gov-vote-for" style="width: ${forPercent}%"></div>
                  </div>
                  <div class="gov-vote-labels">
                    <span class="gov-for">For ${forPercent.toFixed(0)}%</span>
                    <span class="gov-against">Against ${(100 - forPercent).toFixed(0)}%</span>
                  </div>
                </div>
                <div class="gov-proposal-meta">
                  <span class="gov-voters">${p.totalVoters} voters</span>
                  ${p.quorumReached ? '<span class="gov-quorum reached">✓ Quorum</span>' : '<span class="gov-quorum pending">◯ Quorum</span>'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.content.querySelectorAll('.gov-proposal-row').forEach(row => {
      row.addEventListener('click', () => {
        const dao = (row as HTMLElement).dataset.dao;
        const id = (row as HTMLElement).dataset.id;
        if (dao && id) {
          window.open(`https://app.realms.today/dao/${dao}/proposal/${id}`, '_blank', 'noopener');
        }
      });
    });
  }

  private getTimeLeft(endDate: number): string {
    const diff = (endDate - Date.now()) / 1000;
    if (diff <= 0) return 'Ended';
    if (diff < 3600) return `${Math.round(diff / 60)}m left`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h left`;
    return `${Math.round(diff / 86400)}d left`;
  }
}
