# Questline

A peer coding learning platform where quests feel like missions, not homework.

Students pick a quest, clone its repo from a self-hosted **Gitea**, code on their own machine,
push, and open a pull request. Senior peers review it, and the admin merges it.
v1 is JavaScript only.

## How it works

1. **Sign in with Gitea** and pick your rank: junior or senior.
2. **Accept a quest** and get your own Gitea repo.
3. **Clone, code, push** locally with normal `git`.
4. **Open a PR.** Gitea sends a webhook to Questline, and the PR joins the review queue.
5. **Peer review.** Seniors approve or request changes.
6. **Merge.** The admin merges, and the quest is complete.

```
Browser ──▶ Frontend (React) ──▶ Backend (Express) ──▶ Postgres
                                       ▲
                       Gitea ──────────┘  (sign-in + webhooks)
```

## Backend (`backend/`)

**Stack:** Node 20 · Express 5 · PostgreSQL (`pg`) · `node:test`

The backend is the brain: it signs users in, keeps sessions, and turns Gitea events into
quest progress.

```
src/
├── index.js        starts the server
├── app.js          builds the Express app (dependencies injected, so tests need no DB)
├── config.js       reads environment variables
├── auth/           Sign in with Gitea (OAuth2 + PKCE), session tokens
├── api/            JSON routes for the frontend
├── webhooks/       receives Gitea pull request and review events
├── http/           CORS, CSRF check, session loading
└── db/             connection pool, SQL queries, migrations
```

| Route                       | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `GET /health`               | Health check                             |
| `GET /auth/gitea/login`     | Start sign-in                            |
| `GET /auth/gitea/callback`  | Finish sign-in, set the session cookie   |
| `POST /auth/logout`         | Sign out                                 |
| `GET /api/me`               | Current user                             |
| `PATCH /api/me`             | Choose junior/senior (only once)         |
| `POST /webhooks/gitea`      | Gitea PR and review events               |

**Key ideas**

- **No passwords stored.** Gitea handles sign-in.
- **Sessions** are a random token in an `HttpOnly` cookie; only its hash is saved in the database.
- **Only the Questline frontend** can call the API (CORS and an `Origin` check against CSRF).
- **Webhooks are verified** with an HMAC signature, deduplicated, and applied in one transaction.

## Frontend (`frontend/`)

**Stack:** React 19 · Vite · Vitest + Testing Library

The frontend is the face: it shows the right screen and talks to the backend.

```
src/
├── main.jsx        starts React
├── App.jsx         picks the screen: login, onboarding or dashboard
├── api/client.js   the only file that calls the backend
├── pages/          Login, Onboarding, Dashboard
└── components/     TopNav, Sidebar, QuestCard
```

**Screens**

| User is…                   | Sees                                      |
| -------------------------- | ----------------------------------------- |
| Not signed in              | Login ("Sign in with Gitea")              |
| Signed in, new             | Onboarding (pick junior or senior)        |
| Signed in, onboarded       | Dashboard (quests, progress, sign out)    |
| Backend unreachable        | A "can't reach the server" message        |

**Key ideas**

- On load, `App.jsx` calls `GET /api/me`; the answer decides the screen.
- The browser sends the session cookie automatically; JavaScript never touches the token.
- Theme colours live as CSS variables in `src/index.css`.
- Quest cards and stats still use **sample data** until the quest API is built.

## Getting started

**Needs:** Node 20+ and Docker.

```bash
# 1. Start Gitea (http://localhost:3001) and Postgres
docker compose up -d gitea postgres

# 2. Backend (http://localhost:4000)
cd backend
npm install
cp .env.example .env     # fill in the Gitea values (see below)
npm run migrate
npm run dev

# 3. Frontend (http://localhost:5173)
cd frontend
npm install
cp .env.example .env
npm run dev
```

**Backend `.env` values to fill in:** `GITEA_OAUTH_CLIENT_ID`, `GITEA_OAUTH_CLIENT_SECRET`
(from a Gitea OAuth2 app), `GITEA_WEBHOOK_SECRET`, and `GITEA_ADMIN_LOGIN`.

**Gitea webhook:** point it at `http://host.docker.internal:4000/webhooks/gitea`
(JSON, same secret, events: Pull Request + Pull Request Reviews).

## Tests and checks

| Backend                 | Frontend      |
| ----------------------- | ------------- |
| `npm test`              | `npm test`    |
| `npm run lint`          |               |
| `npm run format:check`  |               |

Neither test suite needs a database or a running server.

## Learn more

- [`ARCHITECTURE.md`](ARCHITECTURE.md): full design, diagrams, data model, production setup
- [`interview_questions.md`](interview_questions.md): interview Q&A based on this project
