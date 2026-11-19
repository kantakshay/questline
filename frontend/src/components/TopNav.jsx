import './TopNav.css';

function TopNav({ username, onLogout }) {
  return (
    <header className="topnav">
      <div className="topnav-logo">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="1.5" y="2.5" width="17" height="15" rx="2.5" stroke="var(--accent)" strokeWidth="1.5" />
          <path d="M5 7.5l3 2.5-3 2.5" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 12.5h4" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span>
          Quest<span className="topnav-logo-dot">line</span>
        </span>
      </div>

      <nav className="topnav-links">
        <a className="topnav-link active" href="/">Dashboard</a>
        <a className="topnav-link" href="/quests">Quests</a>
        <a className="topnav-link" href="/review-queue">
          Review Queue
          <span className="topnav-badge">1</span>
        </a>
      </nav>

      <div className="topnav-spacer" />

      <div className="topnav-user">
        <div className="topnav-avatar">{username.charAt(0).toUpperCase()}</div>
        <span>{username}</span>
        {onLogout && (
          <button type="button" className="topnav-logout" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

export default TopNav;
