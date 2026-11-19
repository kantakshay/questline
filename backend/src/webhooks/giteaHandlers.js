// Turns Gitea webhook payloads into Questline state changes.
// Each handler returns { status: 'processed' | 'ignored', detail }.

const REVIEW_EVENT_KINDS = {
  pull_request_review_approved: 'approve',
  pull_request_review_rejected: 'request_changes',
  pull_request_review_comment: 'comment',
};

// Creates or refreshes our copy of the PR and links it to the quest enrollment
// that owns the repo (null for repos that aren't quest repos).
async function syncPullRequest(store, payload) {
  const pr = payload.pull_request;
  const repoFullName = payload.repository.full_name;
  const enrollment = await store.findEnrollmentByRepo(repoFullName);
  const author = await store.findUserByGiteaLogin(pr.user?.login);

  const row = await store.upsertPullRequest({
    giteaPrId: pr.id,
    repoFullName,
    number: pr.number,
    enrollmentId: enrollment?.id ?? null,
    questId: enrollment?.quest_id ?? null,
    authorUserId: author?.id ?? null,
    authorLogin: pr.user?.login ?? 'unknown',
    title: pr.title ?? '',
    body: pr.body ?? '',
    htmlUrl: pr.html_url,
    headRef: pr.head?.ref ?? '',
    headSha: pr.head?.sha ?? '',
    baseRef: pr.base?.ref ?? '',
    openedAt: pr.created_at ?? null,
  });
  return { row, enrollment };
}

async function handlePullRequest(store, payload, { adminLogin, logger }) {
  const { action } = payload;
  const pr = payload.pull_request;
  const { row, enrollment } = await syncPullRequest(store, payload);

  switch (action) {
    case 'opened':
    case 'reopened':
      await store.updatePullRequest(row.id, {
        state: 'open',
        reviewStatus: 'awaiting_review',
        closedAt: null,
        mergedAt: null,
        mergedByLogin: null,
      });
      if (enrollment) await store.setEnrollmentStatus(enrollment.id, 'in_review');
      // AI reviewer hook: enqueue an advisory review for (row.id, pr.head.sha) here.
      return { status: 'processed', detail: `PR #${pr.number} queued for review` };

    case 'synchronized':
      // New commits pushed. If a reviewer had asked for changes, put it back in the queue.
      if (row.state === 'open' && row.review_status === 'changes_requested') {
        await store.updatePullRequest(row.id, { reviewStatus: 'awaiting_review' });
        if (enrollment) await store.setEnrollmentStatus(enrollment.id, 'in_review');
      }
      return { status: 'processed', detail: `PR #${pr.number} updated to ${pr.head?.sha}` };

    case 'edited':
      return { status: 'processed', detail: `PR #${pr.number} details refreshed` };

    case 'closed': {
      const headSha = pr.head?.sha ?? row.head_sha;
      if (pr.merged) {
        const mergedBy = pr.merged_by?.login ?? null;
        await store.updatePullRequest(row.id, {
          state: 'merged',
          mergedByLogin: mergedBy,
          mergedAt: pr.merged_at ?? new Date().toISOString(),
          closedAt: pr.closed_at ?? new Date().toISOString(),
        });
        if (enrollment) await store.setEnrollmentStatus(enrollment.id, 'merged');
        await store.recordFinalOutcome(row.id, 'merged', headSha);
        if (adminLogin && mergedBy && mergedBy.toLowerCase() !== adminLogin.toLowerCase()) {
          logger.warn(`PR ${payload.repository.full_name}#${pr.number} merged by ${mergedBy}, not the admin`);
        }
        return { status: 'processed', detail: `PR #${pr.number} merged by ${mergedBy}` };
      }
      await store.updatePullRequest(row.id, {
        state: 'closed',
        closedAt: pr.closed_at ?? new Date().toISOString(),
      });
      if (enrollment) await store.setEnrollmentStatus(enrollment.id, 'in_progress');
      await store.recordFinalOutcome(row.id, 'closed_unmerged', headSha);
      return { status: 'processed', detail: `PR #${pr.number} closed without merge` };
    }

    default:
      return { status: 'ignored', detail: `pull_request action "${action}" not handled` };
  }
}

async function handlePullRequestReview(store, event, payload) {
  const kind = REVIEW_EVENT_KINDS[payload.review?.type] ?? REVIEW_EVENT_KINDS[event];
  if (!kind) return { status: 'ignored', detail: `review type "${payload.review?.type}" not handled` };

  const { row, enrollment } = await syncPullRequest(store, payload);
  const reviewerLogin = payload.sender?.login ?? null;
  const reviewer = await store.findUserByGiteaLogin(reviewerLogin);

  await store.insertReviewComment({
    prId: row.id,
    authorUserId: reviewer?.id ?? null,
    authorLogin: reviewerLogin,
    kind,
    body: payload.review?.content ?? '',
    headSha: payload.pull_request.head?.sha ?? row.head_sha,
  });
  if (reviewer) await store.completeAssignment(row.id, reviewer.id);

  if (row.state === 'open') {
    if (kind === 'approve') {
      await store.updatePullRequest(row.id, { reviewStatus: 'approved' });
    } else if (kind === 'request_changes') {
      await store.updatePullRequest(row.id, { reviewStatus: 'changes_requested' });
      if (enrollment) await store.setEnrollmentStatus(enrollment.id, 'changes_requested');
    } else if (row.review_status === 'awaiting_review') {
      await store.updatePullRequest(row.id, { reviewStatus: 'in_review' });
    }
  }
  return { status: 'processed', detail: `${kind} by ${reviewerLogin} on PR #${row.id}` };
}

async function dispatchGiteaEvent(store, event, payload, options) {
  if (!payload?.pull_request || !payload?.repository?.full_name) {
    return { status: 'ignored', detail: `event "${event}" has no pull request` };
  }
  if (event === 'pull_request') return handlePullRequest(store, payload, options);
  if (event.startsWith('pull_request_review')) return handlePullRequestReview(store, event, payload);
  return { status: 'ignored', detail: `event "${event}" not handled` };
}

module.exports = { dispatchGiteaEvent };
