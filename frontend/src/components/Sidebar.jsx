import './Sidebar.css';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', active: true },
  { key: 'quests', label: 'Quests' },
  { key: 'review-queue', label: 'Review Queue', badge: 1 },
  { key: 'profile', label: 'Profile' },
];

function ProgressRow({ label, value, max, color, showFraction }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="progress-row">
      <div className="progress-row-labels">
        <span>{label}</span>
        <span className="progress-row-value">{showFraction ? `${value} / ${max}` : value}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Sidebar({ progress }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        <div className="sidebar-label">Navigation</div>
        {NAV_ITEMS.map((item) => (
          <div key={item.key} className={`sidebar-item${item.active ? ' active' : ''}`}>
            <span className="sidebar-item-label">{item.label}</span>
            {item.badge != null && <span className="sidebar-item-badge">{item.badge}</span>}
          </div>
        ))}
      </div>

      <div className="sidebar-progress-wrap">
        <div className="sidebar-progress-card">
          <div className="sidebar-label">Your Progress</div>
          <ProgressRow
            label="Quests done"
            value={progress.questsDone}
            max={progress.questsTotal}
            color="var(--accent)"
            showFraction
          />
          <ProgressRow label="PRs merged" value={progress.prsMerged} max={progress.questsTotal} color="var(--success)" />
          <ProgressRow label="Reviews given" value={progress.reviewsGiven} max={progress.questsTotal} color="#a78bfa" />
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
