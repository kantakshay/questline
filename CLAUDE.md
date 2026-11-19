# Questline

**Naming:** the project is called **Questline** everywhere: code, Docker (`questline-*`),
packages (`questline-backend`, `questline-frontend`), database (`questline`), domains
(`questline.io`), CLI (`questline`). Don't introduce other names.

A peer coding learning platform. Students clone quest repos from a self-hosted
Gitea, push code, open PRs, and get peer-reviewed. Akshay (admin) is the final
approver who merges. Teams are organised by language; v1 is JavaScript only.

## Working rules

- Never commit, push, or create branches unless explicitly asked. The user handles git.
- **No AI features yet.** The AI PR reviewer (Claude API) is deferred until just
  before release. Don't add the Anthropic SDK or AI code unless asked. The hook point
  is marked in `backend/src/webhooks/giteaHandlers.js` ("AI reviewer hook").
- Students always clone and push locally. Don't build a browser-based editor.
- Quests should feel like missions, not homework. This matters for copy and UI text.
- ask for approval before using git commands
- add test cases for every feature added or any bug,security fix positive test and negetive test.
- explain me every feature bug or security fix we do while building this project in points
- try to explain in simple words instead of making it too complicated to understand you can use analogies.
- no need to keep so short that it looses the context or the seriousness of this code changes.
- Make the code and test changes; run npm run lint, npm run format:check, npm test.
- create a interview_questions.md file and put every interview question and answers possible related to this project, node js, backend development, and every feature or fix.
- relate node.js, backend & frontend development and system design question from this repo and level of questions must be for an experince dev
- answers must be in details,in points
- this project is also for learning new tech so please create a doc where you explains the Architecture of this project and how does it works   

## Layout

- `backend/`: Node 20 + Express 5, CommonJS, PostgreSQL via `pg` (Neon in prod for v1; Aurora later)
- Production v1: Vercel (frontend, `app.questline.io`) · Railway (backend, `api.questline.io`) ·
  Neon (Postgres) · Hetzner CX22 VPS (Gitea + Nginx, `git.questline.io`) · Cloudflare DNS.
  Details in `ARCHITECTURE.md` §7.
  - `src/index.js`: entry point. `src/app.js`: `createApp(deps)` with injected DB deps so tests run without Postgres
  - `src/config.js`: all env config (loads `.env` via dotenv)
  - `src/db/pool.js`: pg pool + `withTransaction(fn)`
  - `src/db/store.js`: SQL used by webhook handlers; all methods run on the transaction client
  - `src/db/migrations/*.sql`: schema, applied in filename order by `src/db/scripts/migrate.js`
  - `src/webhooks/`: `POST /webhooks/gitea` (signature check, delivery dedupe, event dispatch)
  - `src/auth/`: Sign in with Gitea (OAuth2 + PKCE + state), session tokens, cookie parsing
  - `src/api/`: `/api/*` JSON routes for the frontend (`GET/PATCH /api/me`)
  - `src/http/security.js`: CORS (frontend origin only), CSRF origin check, session loading, `requireAuth`
  - `src/db/userStore.js`: users + sessions SQL
- `frontend/`: React 19 + Vite. `src/api/client.js` is the only place that calls the backend.
  Sign-in, onboarding and logout are real; dashboard quests/stats are still sample data. Deploys to Vercel.
- `docker-compose.yml`: local Gitea (:3001) and Postgres (:5432).
- `notes/`, `dev-cycle-architecture.html`: personal notes, gitignored.
- `ARCHITECTURE.md`: learning doc with Mermaid diagrams (system, backend layers, webhook sequence,
  quest lifecycle, data model, local/prod setup). Update it when architecture changes.
- `interview_questions.md`: interview Q&A tied to this repo. Add to it with every feature or fix.

## Commands

```bash
docker compose up -d gitea postgres   # from repo root
cd backend
cp .env.example .env                  # then set GITEA_WEBHOOK_SECRET, GITEA_ADMIN_LOGIN, GITEA_OAUTH_CLIENT_ID/SECRET
npm run migrate                       # apply SQL migrations
npm run dev                           # API on :4000 with --watch
npm test                              # node:test, no DB needed
npm run lint                          # ESLint (eslint.config.js)
npm run format:check                  # Prettier check; `npm run format` to fix

cd frontend && npm run dev            # Vite dev server (:5173)
cd frontend && npm test               # Vitest + Testing Library (jsdom)
```

## Authentication

- **v1: Sign in with Gitea.** Gitea is the identity provider (OAuth2 authorization code + PKCE + `state`).
  Questline never sees or stores passwords. Users are created on first sign-in, keyed by
  `gitea_user_id`; they pick junior/senior once at onboarding (`PATCH /api/me`, 409 if already set).
  `GITEA_ADMIN_LOGIN` gets `role = admin`, re-derived on every sign-in.
- **Sessions:** opaque random token in an `HttpOnly; SameSite=Lax` cookie (`ql_session`, 30 days,
  `Secure` in prod); only its SHA-256 is stored in `sessions`. Not JWTs, so logout and revocation are instant.
- **Browser security:** CORS allows only `FRONTEND_URL` with credentials; every non-GET `/api` and
  `/auth/logout` request must carry `Origin: FRONTEND_URL` (CSRF). Webhooks get no CORS.
- **Planned (option 2): branded Questline sign-up.** Questline's own sign-up page; the backend creates the
  matching Gitea account through the Gitea admin API and stores it on the same `users` row
  (`gitea_user_id`, `password_hash` already exist). Both sign-in methods can coexist. See ARCHITECTURE.md §8.

## Data model (`backend/src/db/migrations/`)

users (role student|admin, experience_level junior|senior, gitea_login) · teams + team_members ·
quests (slug, briefing, difficulty, xp, template_repo) · quest_enrollments (one Gitea repo per
student per quest; status in_progress → in_review → changes_requested → merged) ·
pull_requests (state open|closed|merged; review_status drives the reviewer queue) ·
review_assignments (seniors assigned to a PR) · review_comments (human or AI; AI columns
record model/prompt/rules versions) · feedback_log (one row per AI comment: admin verdict
approved|edited|rejected + auto-filled final outcome; this is the reviewer's eval dataset) ·
webhook_deliveries (dedupe by X-Gitea-Delivery) · sessions (002: hashed session tokens;
`users.experience_level` is NULL until onboarding).

Conventions: enums are CHECK constraints (not PG enum types); case-insensitive uniqueness
via `lower()` indexes; new schema changes go in a new numbered migration file, never by
editing an applied one.

## Gitea webhook flow

Configure a Gitea webhook (content type `application/json`, the shared secret, events:
Pull Request + Pull Request Reviews) pointing at `http://host.docker.internal:4000/webhooks/gitea`
for local dev. The handler:

- verifies `X-Gitea-Signature` (HMAC-SHA256 of the raw body) and rejects if no secret is configured
- records `X-Gitea-Delivery` and returns `duplicate` for redeliveries
- applies the whole event in one transaction; on error returns 500 so Gitea redelivery retries it
- `opened`/`reopened` → queue for review; `synchronized` after changes requested → back in queue;
  `closed` → merged/closed state, enrollment status, `feedback_log` outcome; reviews → `review_comments`,
  assignment completed, review_status updated
- PRs in non-quest repos are still tracked, with `quest_id` NULL

## Roadmap

- v1: ✅ Sign in with Gitea + experience level · quest catalogue + clone URL · reviewer queue · admin merge. AI reviewer added before release.
- Branding: replace "Sign in with Gitea" with a Questline-branded sign-up (option 2, Gitea account auto-created).
- AI reviewer, iterative: v1 raw diff + JS review rules → advisory Gitea comment; v2 RAG over quest reference docs; v3 eval set of 30–50 PRs scored using `feedback_log`.
- Later: Java and other language packs, `questline` Rust CLI, AI scrum master / team chat.
