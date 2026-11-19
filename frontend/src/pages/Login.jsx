import { GITEA_LOGIN_URL } from '../api/client';
import './Login.css';

const LOGIN_ERRORS = {
  denied: 'Sign-in was cancelled on Gitea. Ready when you are.',
  state: 'That sign-in link expired or was already used. Please try again.',
  server: 'Something went wrong talking to Gitea. Please try again in a moment.',
};

export function loginErrorMessage(code) {
  if (!code) return null;
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.server;
}

function Login({ errorCode }) {
  const error = loginErrorMessage(errorCode);

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">
          Quest<span className="login-logo-dot">line</span>
        </div>
        <h1 className="login-title">Your missions are waiting.</h1>
        <p className="login-sub">
          Clone real repos, ship pull requests, and get reviewed by your crew. Sign in with your
          Questline Git account to begin.
        </p>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <a className="login-button" href={GITEA_LOGIN_URL}>
          Sign in with Gitea
        </a>

        <p className="login-hint">
          New here? Create a free account on the Git server first, then come back and sign in.
        </p>
      </div>
    </div>
  );
}

export default Login;
