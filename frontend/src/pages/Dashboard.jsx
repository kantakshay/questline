import { useState } from 'react';
import QuestCard from '../components/QuestCard';
import './Dashboard.css';

const SAMPLE_QUESTS = [
  {
    id: 1,
    title: 'Build a Todo App',
    repoSlug: 'quest-todo-app',
    difficulty: 'beginner',
    status: 'in_progress',
    pushedAgo: '2h ago',
    cloneUrl: 'git clone https://git.questline.io/akshay/quest-todo-app',
    tags: ['HTML', 'CSS', 'JavaScript'],
  },
  {
    id: 2,
    title: 'Build a REST API',
    repoSlug: 'quest-rest-api',
    difficulty: 'intermediate',
    status: 'in_review',
    pushedAgo: '5h ago',
    tags: ['Node.js', 'Express', 'REST'],
    pr: { number: 3, badge: 'CHANGES REQUESTED', reviewer: 'priya', commentsCount: 2 },
  },
  {
    id: 3,
    title: 'Build a CRUD App',
    status: 'merged',
    mergedAgo: '2 days ago',
  },
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'merged', label: 'Done' },
];

function StatTile({ label, value, valueColor, sublabel, icon }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-head">
        {icon}
        <span className="stat-tile-label">{label}</span>
      </div>
      <div className="stat-tile-value" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="stat-tile-sublabel">{sublabel}</div>
    </div>
  );
}

function Dashboard({ username }) {
  const [filter, setFilter] = useState('all');

  const quests = filter === 'all' ? SAMPLE_QUESTS : SAMPLE_QUESTS.filter((q) => q.status === filter);

  const activeCount = SAMPLE_QUESTS.filter((q) => q.status === 'in_progress').length;
  const completedCount = SAMPLE_QUESTS.filter((q) => q.status === 'merged').length;
  const toReviewCount = SAMPLE_QUESTS.filter((q) => q.status === 'in_review').length;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-eyebrow">Overview</div>
        <div className="dashboard-title-row">
          <h1 className="dashboard-title">Dashboard</h1>
          <span className="dashboard-welcome">Welcome back, {username}.</span>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile
          label="Active"
          value={activeCount}
          valueColor="var(--accent)"
          sublabel="quests in progress"
          icon={
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="var(--accent)" strokeWidth="1.3" />
              <path d="M6.5 3.5v3l2 1.5" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
        <StatTile
          label="Completed"
          value={completedCount}
          valueColor="var(--success)"
          sublabel="quests merged"
          icon={
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="var(--success)" strokeWidth="1.3" />
              <path d="M4 6.5l2 2 3.5-3.5" stroke="var(--success)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
        <StatTile
          label="To Review"
          value={toReviewCount}
          valueColor="var(--warning)"
          sublabel="peer PRs waiting"
          icon={
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 3.5h9M2 6.5h9M2 9.5h5.5" stroke="var(--warning)" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      <div className="section-header">
        <h2 className="section-title">Active Quests</h2>
        <div className="filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-tab${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="quest-list">
        {quests.map((quest) => (
          <QuestCard key={quest.id} quest={quest} />
        ))}
      </div>
    </div>
  );
}

export default Dashboard;
