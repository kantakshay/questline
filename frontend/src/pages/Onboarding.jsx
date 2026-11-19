import { useState } from 'react';
import { setExperienceLevel } from '../api/client';
import './Login.css';

const LEVELS = [
  {
    value: 'junior',
    title: 'Junior: learning the ropes',
    desc: 'Take on missions, open pull requests, and get reviewed by seniors.',
  },
  {
    value: 'senior',
    title: 'Senior: ready to guide others',
    desc: 'Do missions too, and review junior pull requests when assigned.',
  },
];

function Onboarding({ user, onDone }) {
  const [level, setLevel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDone(await setExperienceLevel(level));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="onboarding">
      <form className="onboarding-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          Quest<span className="login-logo-dot">line</span>
        </div>
        <h1 className="login-title">Welcome, {user.displayName || user.username}.</h1>
        <p className="login-sub">Pick your rank. This decides which missions you review, and you choose it once.</p>

        <div className="onboarding-options" role="radiogroup" aria-label="Experience level">
          {LEVELS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={level === option.value}
              className={`onboarding-option${level === option.value ? ' selected' : ''}`}
              onClick={() => setLevel(option.value)}
            >
              <div className="onboarding-option-title">{option.title}</div>
              <div className="onboarding-option-desc">{option.desc}</div>
            </button>
          ))}
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button className="login-button" type="submit" disabled={!level || saving}>
          {saving ? 'Saving…' : 'Start my first mission'}
        </button>
      </form>
    </div>
  );
}

export default Onboarding;
