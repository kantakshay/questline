# Questline

A peer coding learning platform where quests feel like missions, not homework.

Students pick a quest, clone its repo from a self-hosted **Gitea**, write code on their own
machine, push, and open a pull request. Senior peers review it, and the admin gives final
approval and merges. Teams are organised by language; **v1 is JavaScript only**.

> Think of it like a guild: the quest board hands out missions, Gitea is the forge where the
> work happens, peers inspect each other's gear, and the guild master signs off.

## How it works

1. **Sign in with Gitea.** Questline never sees your password; Gitea is the identity provider
   (OAuth2 + PKCE). On first sign-in you choose your level: junior or senior.
2. **Accept a quest.** Each quest has a briefing, difficulty, XP, and a template repo.
   You get your own Gitea repo for it.
3. **Clone, code, push.** Everything happens locally with your normal tools and `git`.
   There is no browser editor, on purpose.
4. **Open a PR.** A Gitea webhook tells Questline, and the PR joins the reviewer queue.
5. **Peer review.** Seniors review and request changes or approve. Pushing new commits after
   "changes requested" puts the PR back in the queue.
6. **Merge.** The admin merges, and the quest is complete.

## Tech stack

| Part        | Tech                                                                 |
| ----------- | -------------------------------------------------------------------- |
| Backend     | Node 20, Express 5 (CommonJS), PostgreSQL via `pg`                   |
| Frontend    | React 19, Vite                                                       |
| Git hosting | Gitea (self-hosted)                                                  |
| Tests       | `node:test` (backend, no DB needed) · Vitest + Testing Library (frontend) |
| Tooling     | ESLint, Prettier, Docker Compose                                     |

**Production (v1):** Vercel (frontend, `app.questline.io`) · Railway (backend,
`api.questline.io`) · Neon (Postgres) · Hetzner VPS (Gitea + Nginx, `git.questline.io`) ·
Cloudflare DNS.

## Repository layout

```
Questline/
├── backend/                 Express API
│   ├── src/
│   │   ├── index.js         entry point
│   │   ├── app.js           createApp(deps): DB deps injected so tests run without Postgres
│   │   ├── config.js        all env config (loads .env)
│   │   ├── auth/            Sign in with Gitea (OAuth2 + PKCE + state), session tokens
│   │   ├── api/             /api/* JSON routes for the frontend
│   │   ├── http/security.js CORS, CSRF origin check, session loading, requireAuth
│   │   ├── webhooks/        POST /webhooks/gitea (signature check, dedupe, dispatch)
│   │   └── db/              pg pool, stores, numbered SQL migrations
│   └── test/
├── frontend/                React + Vite app (src/api/client.js is the only backend caller)
├── docker-compose.yml       local Gitea (:3001) and Postgres (:5432)
├── ARCHITECTURE.md          how the system fits together, with diagrams
└── interview_questions.md   interview Q&A tied to this codebase
```

## Getting started

### Prerequisites

- Node.js 20+
- Docker Desktop (for local Gitea and Postgres)

### 1. Start Gitea and Postgres

```bash
docker compose up -d gitea postgres
```

Open Gitea at <http://localhost:3001> and finish the first-run setup (create the admin user).

### 2. Configure the backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill in these values in `backend/.env`:

| Variable                    | What it is                                                                 |
| --------------------------- | -------------------------------------------------------------------------- |
| `GITEA_WEBHOOK_SECRET`      | Shared secret; must match the "Secret" field on the Gitea webhook          |
| `GITEA_ADMIN_LOGIN`         | Gitea username of the final approver; gets `role = admin` on sign-in       |
| `GITEA_OAUTH_CLIENT_ID`     | From a Gitea OAuth2 application (confidential client)                      |
| `GITEA_OAUTH_CLIENT_SECRET` | Same application                                                           |
| `GITEA_API_TOKEN`           | Gitea service-account token                                                |

The OAuth application's Redirect URI must equal `GITEA_OAUTH_REDIRECT_URL`
(`http://localhost:4000/auth/gitea/callback` locally). See `backend/.env.example` for all options.

### 3. Run migrations and start the API

```bash
npm run migrate   # apply SQL migrations
npm run dev       # API on http://localhost:4000 with --watch
```

### 4. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:4000
npm run dev            # http://localhost:5173
```

### 5. Add the Gitea webhook

On the quest repo (or org) in Gitea, add a webhook:

- **URL:** `http://host.docker.internal:4000/webhooks/gitea`
- **Content type:** `application/json`
- **Secret:** the same value as `GITEA_WEBHOOK_SECRET`
- **Events:** Pull Request, Pull Request Reviews

## Scripts

**Backend** (`cd backend`)

| Command                | Does                                   |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start the API with file watching       |
| `npm start`            | Start the API                          |
| `npm run migrate`      | Apply SQL migrations in filename order |
| `npm test`             | Run tests (no database needed)         |
| `npm run lint`         | ESLint                                 |
| `npm run format:check` | Prettier check (`npm run format` fixes)|

**Frontend** (`cd frontend`)

| Command         | Does                          |
| --------------- | ----------------------------- |
| `npm run dev`   | Vite dev server               |
| `npm run build` | Production build              |
| `npm test`      | Vitest + Testing Library      |

## API overview

| Method  | Path                    | Purpose                                              |
| ------- | ----------------------- | ---------------------------------------------------- |
| `GET`   | `/health`               | Health check                                         |
| `GET`   | `/auth/gitea/login`     | Start Sign in with Gitea                             |
| `GET`   | `/auth/gitea/callback`  | OAuth callback; creates the session                  |
| `POST`  | `/auth/logout`          | End the session                                      |
| `GET`   | `/api/me`               | Current user                                         |
| `PATCH` | `/api/me`               | Set experience level once (409 if already set)       |
| `POST`  | `/webhooks/gitea`       | Gitea pull request and review events                 |

## Security at a glance

- **No passwords stored.** Gitea handles sign-in via OAuth2 authorization code + PKCE + `state`.
- **Sessions:** an opaque random token in an `HttpOnly; SameSite=Lax` cookie (`Secure` in
  production). Only its SHA-256 hash is stored, so a database leak doesn't leak sessions.
  Not JWTs, so logout and revocation are instant.
- **CORS** allows only `FRONTEND_URL`, with credentials.
- **CSRF:** every non-GET `/api` request and `/auth/logout` must carry `Origin: FRONTEND_URL`.
- **Webhooks:** `X-Gitea-Signature` (HMAC-SHA256 of the raw body) is verified and requests
  are rejected if no secret is configured. Redeliveries are deduplicated by `X-Gitea-Delivery`,
  and each event is applied in a single transaction.

## Project status

- ✅ Sign in with Gitea, onboarding (junior/senior), logout
- ✅ Gitea webhook ingestion: PR and review tracking, reviewer queue state
- 🚧 Quest catalogue, clone URLs, reviewer queue UI (dashboard still uses sample data)
- 🔜 Questline-branded sign-up (Gitea account created automatically)
- 🔜 AI PR reviewer (advisory comments), added just before release
- Later: Java and other language packs, `questline` CLI

## Learn more

- [`ARCHITECTURE.md`](ARCHITECTURE.md): system diagrams, webhook flow, quest lifecycle, data model,
  local and production setup
- [`interview_questions.md`](interview_questions.md): Node.js, backend, frontend and system design
  questions based on this codebase
