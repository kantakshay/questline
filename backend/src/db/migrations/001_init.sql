-- Questline v1 schema (PostgreSQL / Aurora PostgreSQL 16).
-- Enumerations use CHECK constraints rather than CREATE TYPE so new values
-- (languages, statuses) can be added later with a simple constraint swap.

CREATE TABLE users (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email            TEXT NOT NULL,
  username         TEXT NOT NULL,
  display_name     TEXT,
  password_hash    TEXT,
  role             TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  experience_level TEXT NOT NULL CHECK (experience_level IN ('junior', 'senior')),
  gitea_user_id    BIGINT UNIQUE,
  gitea_login      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key       ON users (lower(email));
CREATE UNIQUE INDEX users_username_key    ON users (lower(username));
CREATE UNIQUE INDEX users_gitea_login_key ON users (lower(gitea_login));

-- Teams are organised by programming language.
CREATE TABLE teams (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  language   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id   BIGINT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE quests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  briefing      TEXT NOT NULL DEFAULT '',          -- mission briefing shown to students
  language      TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  template_repo TEXT NOT NULL,                     -- Gitea "owner/name" each student's repo is created from
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quests_catalogue_idx ON quests (language, sort_order) WHERE is_published;

-- A student accepting a quest. Each enrollment owns one Gitea repo the student clones.
CREATE TABLE quest_enrollments (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  quest_id       BIGINT NOT NULL REFERENCES quests (id) ON DELETE RESTRICT,
  repo_full_name TEXT NOT NULL,
  clone_url      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'in_review', 'changes_requested', 'merged')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (user_id, quest_id)
);
CREATE UNIQUE INDEX quest_enrollments_repo_key ON quest_enrollments (lower(repo_full_name));

CREATE TABLE pull_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gitea_pr_id     BIGINT NOT NULL UNIQUE,
  repo_full_name  TEXT NOT NULL,
  number          INTEGER NOT NULL,
  enrollment_id   BIGINT REFERENCES quest_enrollments (id) ON DELETE SET NULL,
  quest_id        BIGINT REFERENCES quests (id) ON DELETE SET NULL,
  author_user_id  BIGINT REFERENCES users (id) ON DELETE SET NULL,
  author_login    TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  html_url        TEXT NOT NULL,
  head_ref        TEXT NOT NULL,
  head_sha        TEXT NOT NULL,
  base_ref        TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'merged')),
  review_status   TEXT NOT NULL DEFAULT 'awaiting_review'
                  CHECK (review_status IN ('awaiting_review', 'in_review', 'changes_requested', 'approved')),
  merged_by_login TEXT,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  merged_at       TIMESTAMPTZ,
  UNIQUE (repo_full_name, number)
);
-- Reviewer queue: open PRs ordered by age.
CREATE INDEX pull_requests_queue_idx  ON pull_requests (review_status, opened_at) WHERE state = 'open';
CREATE INDEX pull_requests_author_idx ON pull_requests (author_user_id);

-- Seniors (or the admin) assigned to review a PR.
CREATE TABLE review_assignments (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pr_id               BIGINT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  reviewer_user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_by_user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'dismissed')),
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  UNIQUE (pr_id, reviewer_user_id)
);
CREATE INDEX review_assignments_reviewer_idx ON review_assignments (reviewer_user_id, status);

-- Every review on a PR, human or AI. The AI-only columns stay NULL for humans.
CREATE TABLE review_comments (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pr_id            BIGINT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  author_type      TEXT NOT NULL CHECK (author_type IN ('ai', 'human')),
  author_user_id   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  author_login     TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('comment', 'approve', 'request_changes')),
  body             TEXT NOT NULL,
  head_sha         TEXT NOT NULL,                  -- commit the review was written against
  gitea_comment_id BIGINT UNIQUE,
  -- AI reviewer metadata (filled in once the AI reviewer ships)
  model            TEXT,
  prompt_version   TEXT,
  rules_version    TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (author_type = 'human' OR (model IS NOT NULL AND prompt_version IS NOT NULL))
);
CREATE INDEX review_comments_pr_idx ON review_comments (pr_id, created_at);

-- Eval dataset for the AI reviewer: one row per AI review comment.
-- final_outcome / student_revised are filled automatically when the PR closes;
-- verdict / edited_body are the admin's explicit judgement of the AI comment.
CREATE TABLE feedback_log (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_comment_id  BIGINT NOT NULL UNIQUE REFERENCES review_comments (id) ON DELETE CASCADE,
  pr_id              BIGINT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  verdict            TEXT CHECK (verdict IN ('approved', 'edited', 'rejected')),
  edited_body        TEXT,
  notes              TEXT,
  decided_by_user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  final_outcome      TEXT CHECK (final_outcome IN ('merged', 'closed_unmerged')),
  final_head_sha     TEXT,
  student_revised    BOOLEAN,                      -- new commits landed after the AI review
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verdict <> 'edited' OR edited_body IS NOT NULL)
);
CREATE INDEX feedback_log_pr_idx ON feedback_log (pr_id);

-- Gitea webhook deliveries, used to drop redeliveries of an event already processed.
CREATE TABLE webhook_deliveries (
  delivery_id    TEXT PRIMARY KEY,
  event          TEXT NOT NULL,
  action         TEXT,
  repo_full_name TEXT,
  status         TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored')),
  detail         TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);
