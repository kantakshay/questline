import { useEffect, useState } from 'react';
import TopNav from './components/TopNav';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import { getMe, logout } from './api/client';
import './App.css';

// Still sample data until the quest API exists.
const PROGRESS = {
  questsDone: 5,
  questsTotal: 12,
  prsMerged: 4,
  reviewsGiven: 3,
};

// Reads ?login_error=... set by the backend after a failed sign-in, then removes it from the URL.
function takeLoginError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('login_error');
  if (code) {
    params.delete('login_error');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
  return code;
}

function App() {
  // loading → signedOut | ready (needsOnboarding decides which screen) | error
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [loginError] = useState(takeLoginError);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err.status === 401 ? 'signedOut' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Server unreachable: still sign out in this tab. The session expires server-side anyway.
    }
    setUser(null);
    setStatus('signedOut');
  }

  if (status === 'loading') return <div className="app-status">Loading your quests…</div>;
  if (status === 'error') {
    return <div className="app-status">Can't reach the Questline server. Is the backend running?</div>;
  }
  if (status === 'signedOut') return <Login errorCode={loginError} />;
  if (user.needsOnboarding) return <Onboarding user={user} onDone={setUser} />;

  return (
    <div className="app-shell">
      <TopNav username={user.username} onLogout={handleLogout} />
      <div className="app-body">
        <Sidebar progress={PROGRESS} />
        <Dashboard username={user.displayName || user.username} />
      </div>
    </div>
  );
}

export default App;
