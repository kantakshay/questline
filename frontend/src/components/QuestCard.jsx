import './QuestCard.css';

const STATUS_LABEL = {
  in_progress: 'IN PROGRESS',
  in_review: 'IN REVIEW',
  merged: 'MERGED',
};

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="var(--accent)" strokeWidth="1.1" />
      <path
        d="M3.5 8.5H2A1.5 1.5 0 01.5 7V2A1.5 1.5 0 012 .5h5A1.5 1.5 0 018.5 2v1.5"
        stroke="var(--accent)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QuestCard({ quest }) {
  const { title, repoSlug, difficulty, status, pushedAgo, cloneUrl, tags, pr, mergedAgo } = quest;

  if (status === 'merged') {
    return (
      <div className="quest-card quest-card-merged">
        <div className="quest-card-rail" style={{ background: 'var(--success)' }} />
        <div className="quest-card-merged-row">
          <div className="quest-card-merged-title-group">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" fill="var(--success-bg)" stroke="var(--success)" strokeWidth="1.3" />
              <path d="M5 8l2.5 2.5 4-4" stroke="var(--success)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="quest-card-merged-title">{title}</span>
            <span className="quest-badge" style={{ background: 'var(--success-bg)', border: '1px solid #1a4a38', color: 'var(--success)' }}>
              MERGED
            </span>
          </div>
          <span className="quest-card-meta">merged {mergedAgo}</span>
        </div>
      </div>
    );
  }

  const railColor = status === 'in_progress' ? 'var(--accent)' : 'var(--warning)';
  const badgeStyle =
    status === 'in_progress'
      ? { background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }
      : { background: 'var(--warning-bg)', border: '1px solid #3a2800', color: 'var(--warning)' };

  return (
    <div className="quest-card">
      <div className="quest-card-rail" style={{ background: railColor }} />

      <div className="quest-card-top">
        <div>
          <div className="quest-card-title-row">
            <span className="quest-card-title">{title}</span>
            <span className="quest-badge" style={badgeStyle}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="quest-card-subline">
            <span>{repoSlug}</span>
            <span className="quest-card-dot">·</span>
            <span className="quest-card-difficulty">{difficulty}</span>
          </div>
        </div>
        <div className="quest-card-pushed">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4" stroke="var(--text-3)" strokeWidth="1.1" />
            <path d="M5.5 3v2.5l1.5 1.2" stroke="var(--text-3)" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          <span>pushed {pushedAgo}</span>
        </div>
      </div>

      {status === 'in_progress' && (
        <div className="quest-card-clone-row">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="var(--text-3)" strokeWidth="1.1" />
            <path d="M3 3h5M3 5h5M3 7h3" stroke="var(--text-3)" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
          <code className="quest-card-clone-url">{cloneUrl}</code>
          <button className="quest-card-copy-btn" type="button" aria-label="Copy clone URL">
            <CopyIcon />
          </button>
        </div>
      )}

      {status === 'in_review' && pr && (
        <div className="quest-card-pr-row">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="3.5" cy="3" r="1.5" stroke="var(--warning)" strokeWidth="1.2" />
            <circle cx="10.5" cy="3" r="1.5" stroke="var(--warning)" strokeWidth="1.2" />
            <circle cx="3.5" cy="11" r="1.5" stroke="var(--warning)" strokeWidth="1.2" />
            <path d="M3.5 4.5V9.5" stroke="var(--warning)" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M10.5 4.5V7a3 3 0 01-3 3H5" stroke="var(--warning)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <div className="quest-card-pr-info">
            <div className="quest-card-pr-title-row">
              <span className="quest-card-pr-number">PR #{pr.number}</span>
              <span className="quest-pr-badge">{pr.badge}</span>
            </div>
            <div className="quest-card-pr-detail">
              Reviewer <span className="quest-card-pr-reviewer">@{pr.reviewer}</span> left {pr.commentsCount} comments
            </div>
          </div>
        </div>
      )}

      <div className="quest-card-bottom">
        <div className="quest-card-tags">
          {tags.map((tag) => (
            <span key={tag} className="quest-tag">
              {tag}
            </span>
          ))}
        </div>
        <div className="quest-card-actions">
          {status === 'in_review' && (
            <button className="quest-btn quest-btn-ghost" type="button">
              Push Fix
            </button>
          )}
          <button className={`quest-btn ${status === 'in_review' ? 'quest-btn-warning' : 'quest-btn-accent'}`} type="button">
            {status === 'in_progress' ? 'Open PR →' : 'View PR →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuestCard;
