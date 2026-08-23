import { insertReply, QUOTA_COST } from '../youtube/client.js';
import { canAfford, recordUsage } from '../youtube/quota.js';
import { markAskAnswered } from '../ledger/ledger.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** youtube.com URL to a specific comment (used for the stored reply_url / proof). */
function commentUrl(videoId, commentId) {
  return `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`;
}

/**
 * F6: posts every still-'approved' reply in a batch under the asker's
 * earliest comment on that topic (`parentId`), one per `throttleMs`
 * (default 20s per Section 6), quota-ledgered (50 units/insert, D-09).
 * Idempotent by construction: a reply already 'posted' is excluded by the
 * WHERE clause on every call, so a re-run never re-posts a 2xx (edge case
 * #2). Quota exhaustion queues the reply (post_queue, T-04) instead of
 * failing it. On success, closes the loop by marking the ask answered so
 * the Mind's memory (via the caller telling it the outcome) and the ledger
 * agree.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 * @param {string} batchId
 * @param {{throttleMs?: number, sleep?: (ms: number) => Promise<void>}} [opts]
 * @returns {Promise<{posted: number, failed: number, queued: number}>}
 */
export async function postApprovedBatch(db, ytWrite, batchId, opts = {}) {
  const throttleMs = opts.throttleMs ?? 20_000;
  const sleep = opts.sleep ?? defaultSleep;

  const batch = db.prepare(`SELECT * FROM batches WHERE id = ?`).get(batchId);
  if (!batch) throw new Error(`No such batch: ${batchId}`);

  const namespace = db.prepare(`SELECT kind FROM namespaces WHERE name = ?`).get(batch.namespace);
  if (namespace?.kind !== 'own') {
    throw new Error(
      `Refusing to post: namespace '${batch.namespace}' is not the 'own' posting-enabled channel (dry-run namespaces are read-only by design, E5).`
    );
  }

  const replies = db
    .prepare(`SELECT * FROM batch_replies WHERE batch_id = ? AND status = 'approved'`)
    .all(batchId);

  let posted = 0;
  let failed = 0;
  let queued = 0;

  for (let i = 0; i < replies.length; i += 1) {
    const reply = replies[i];

    if (!canAfford(db, QUOTA_COST.INSERT)) {
      db.prepare(
        `INSERT INTO post_queue (batch_reply_id, reason) VALUES (?, 'YouTube quota exhausted; queued past the Pacific-midnight reset')`
      ).run(reply.id);
      queued += 1;
      continue;
    }

    const originalEvent = db
      .prepare(
        `SELECT comment_id as commentId FROM ask_events WHERE ask_id = ? ORDER BY occurred_at ASC LIMIT 1`
      )
      .get(reply.ask_id);

    try {
      const { replyId, publishedAt } = await insertReply(ytWrite, originalEvent.commentId, reply.reply_text);
      recordUsage(db, QUOTA_COST.INSERT);
      db.prepare(
        `UPDATE batch_replies SET status = 'posted', reply_comment_id = ?, reply_published_at = ? WHERE id = ?`
      ).run(replyId, publishedAt, reply.id);
      markAskAnswered(db, {
        askId: reply.ask_id,
        replyId,
        replyUrl: commentUrl(batch.video_id, replyId),
        repliedAt: publishedAt,
      });
      posted += 1;
    } catch (err) {
      db.prepare(`UPDATE batch_replies SET status = 'failed', error = ? WHERE id = ?`).run(
        err?.message ?? String(err),
        reply.id
      );
      failed += 1;
    }

    if (i < replies.length - 1) await sleep(throttleMs);
  }

  const stillPending = db
    .prepare(`SELECT COUNT(*) as n FROM batch_replies WHERE batch_id = ? AND status IN ('approved', 'drafted')`)
    .get(batchId).n;
  const anyFailedOrQueued = failed > 0 || queued > 0;
  const status = stillPending > 0 || anyFailedOrQueued ? 'partial' : 'posted';
  db.prepare(`UPDATE batches SET status = ? WHERE id = ?`).run(status, batchId);

  return { posted, failed, queued };
}
