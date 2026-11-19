// Data access used by the webhook handlers. Every method runs on the `db`
// passed in (a transaction client), so a whole webhook is applied atomically.

function makeStore(db) {
  return {
    // Returns true if this delivery is new, false if Gitea is redelivering it.
    async recordDelivery({ deliveryId, event, action, repoFullName }) {
      const { rowCount } = await db.query(
        `INSERT INTO webhook_deliveries (delivery_id, event, action, repo_full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (delivery_id) DO NOTHING`,
        [deliveryId, event, action ?? null, repoFullName ?? null],
      );
      return rowCount === 1;
    },

    async finishDelivery(deliveryId, status, detail) {
      await db.query(
        `UPDATE webhook_deliveries SET status = $2, detail = $3, processed_at = now()
         WHERE delivery_id = $1`,
        [deliveryId, status, detail ?? null],
      );
    },

    async findUserByGiteaLogin(login) {
      if (!login) return null;
      const { rows } = await db.query(
        'SELECT id, role, experience_level FROM users WHERE lower(gitea_login) = lower($1)',
        [login],
      );
      return rows[0] ?? null;
    },

    async findEnrollmentByRepo(repoFullName) {
      const { rows } = await db.query(
        'SELECT id, quest_id, user_id, status FROM quest_enrollments WHERE lower(repo_full_name) = lower($1)',
        [repoFullName],
      );
      return rows[0] ?? null;
    },

    // Inserts the PR or refreshes its descriptive fields. State and review status
    // are changed only through updatePullRequest so out-of-order events can't regress them.
    async upsertPullRequest(pr) {
      const { rows } = await db.query(
        `INSERT INTO pull_requests
           (gitea_pr_id, repo_full_name, number, enrollment_id, quest_id, author_user_id,
            author_login, title, body, html_url, head_ref, head_sha, base_ref, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, now()))
         ON CONFLICT (gitea_pr_id) DO UPDATE SET
           enrollment_id  = COALESCE(EXCLUDED.enrollment_id, pull_requests.enrollment_id),
           quest_id       = COALESCE(EXCLUDED.quest_id, pull_requests.quest_id),
           author_user_id = COALESCE(EXCLUDED.author_user_id, pull_requests.author_user_id),
           title = EXCLUDED.title, body = EXCLUDED.body, html_url = EXCLUDED.html_url,
           head_ref = EXCLUDED.head_ref, head_sha = EXCLUDED.head_sha, base_ref = EXCLUDED.base_ref,
           updated_at = now()
         RETURNING id, state, review_status, head_sha`,
        [
          pr.giteaPrId,
          pr.repoFullName,
          pr.number,
          pr.enrollmentId,
          pr.questId,
          pr.authorUserId,
          pr.authorLogin,
          pr.title,
          pr.body,
          pr.htmlUrl,
          pr.headRef,
          pr.headSha,
          pr.baseRef,
          pr.openedAt,
        ],
      );
      return rows[0];
    },

    async updatePullRequest(id, fields) {
      const columns = {
        state: 'state',
        reviewStatus: 'review_status',
        mergedByLogin: 'merged_by_login',
        closedAt: 'closed_at',
        mergedAt: 'merged_at',
      };
      const sets = [];
      const values = [id];
      for (const [key, column] of Object.entries(columns)) {
        if (key in fields) {
          values.push(fields[key]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (sets.length === 0) return;
      await db.query(`UPDATE pull_requests SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    },

    async setEnrollmentStatus(enrollmentId, status) {
      await db.query(
        `UPDATE quest_enrollments
         SET status = $2, completed_at = CASE WHEN $2 = 'merged' THEN now() ELSE NULL END
         WHERE id = $1`,
        [enrollmentId, status],
      );
    },

    async insertReviewComment(c) {
      await db.query(
        `INSERT INTO review_comments (pr_id, author_type, author_user_id, author_login, kind, body, head_sha)
         VALUES ($1, 'human', $2, $3, $4, $5, $6)`,
        [c.prId, c.authorUserId, c.authorLogin, c.kind, c.body, c.headSha],
      );
    },

    async completeAssignment(prId, reviewerUserId) {
      await db.query(
        `UPDATE review_assignments SET status = 'completed', completed_at = now()
         WHERE pr_id = $1 AND reviewer_user_id = $2 AND status = 'assigned'`,
        [prId, reviewerUserId],
      );
    },

    // When a PR closes, record the outcome against every AI review on it.
    // No-op until the AI reviewer starts writing review_comments rows.
    async recordFinalOutcome(prId, finalOutcome, finalHeadSha) {
      await db.query(
        `INSERT INTO feedback_log (review_comment_id, pr_id, final_outcome, final_head_sha, student_revised)
         SELECT rc.id, rc.pr_id, $2, $3, rc.head_sha <> $3
         FROM review_comments rc
         WHERE rc.pr_id = $1 AND rc.author_type = 'ai'
         ON CONFLICT (review_comment_id) DO UPDATE SET
           final_outcome   = EXCLUDED.final_outcome,
           final_head_sha  = EXCLUDED.final_head_sha,
           student_revised = EXCLUDED.student_revised,
           updated_at      = now()`,
        [prId, finalOutcome, finalHeadSha],
      );
    },
  };
}

module.exports = { makeStore };
