import { insertReply, getVideoMeta, QUOTA_COST } from '../youtube/client.js';
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
 *
 * Before the first comments.insert of a batch, reads the answering video's
 * privacyStatus fresh (videos.list, via `ytWrite`) and refuses to post while
 * it is unlisted or private — the unlisted-first flow drafts and approves
 * the batch while the video is still unlisted, so this is the gate that
 * keeps a reply from landing before the creator has actually made the video
 * public. Callers (the approval page, the posting-poll cron) re-check by
 * calling this again; nothing here retries or blocks internally.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 * @param {string} batchId
 * @param {{throttleMs?: number, sleep?: (ms: number) => Promise<void>}} [opts]
 * @returns {Promise<{posted: number, failed: number, queued: number, waitingForPublic?: true, privacyStatus?: string | null}>}
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

  const candidateIds = db
    .prepare(`SELECT id FROM batch_replies WHERE batch_id = ? AND status = 'approved'`)
    .all(batchId)
    .map((r) => r.id);

  if (candidateIds.length === 0) {
    return { posted: 0, failed: 0, queued: 0 };
  }

  const videoMeta = await getVideoMeta(ytWrite, batch.video_id);
  const privacyStatus = videoMeta?.privacyStatus ?? null;
  if (privacyStatus !== 'public') {
    return { posted: 0, failed: 0, queued: 0, waitingForPublic: true, privacyStatus };
  }

  // Claim statement: atomically flips 'approved' -> 'posting' and reports how
  // many rows it actually changed. better-sqlite3 statements run
  // synchronously, so between this call and the next one nothing else on
  // this connection can interleave -- two concurrent postApprovedBatch calls
  // (a double-tap, a retry, a duplicate cron tick) can therefore never both
  // win the claim for the same reply, which is what let Beat 3 double-post
  // live to YouTube before this fix (adversarial find).
  const claimStmt = db.prepare(`UPDATE batch_replies SET status = 'posting' WHERE id = ? AND status = 'approved'`);
  const revertToApprovedStmt = db.prepare(`UPDATE batch_replies SET status = 'approved' WHERE id = ?`);

  let posted = 0;
  let failed = 0;
  let queued = 0;

  for (let i = 0; i < candidateIds.length; i += 1) {
    const replyId = candidateIds[i];
    const claim = claimStmt.run(replyId);
    if (claim.changes === 0) continue; // lost the race to a concurrent call; nothing to do

    const reply = db.prepare(`SELECT * FROM batch_replies WHERE id = ?`).get(replyId);

    if (!canAfford(db, QUOTA_COST.INSERT)) {
      revertToApprovedStmt.run(replyId);
      db.prepare(
        `INSERT INTO post_queue (batch_reply_id, reason) VALUES (?, 'YouTube quota exhausted; queued past the Pacific-midnight reset')`
      ).run(replyId);
      queued += 1;
      continue;
    }

    const originalEvent = db
      .prepare(
        `SELECT comment_id as commentId FROM ask_events WHERE ask_id = ? ORDER BY occurred_at ASC LIMIT 1`
      )
      .get(reply.ask_id);

    try {
      const { replyId: postedCommentId, publishedAt } = await insertReply(ytWrite, originalEvent.commentId, reply.reply_text);
      recordUsage(db, QUOTA_COST.INSERT);
      db.prepare(
        `UPDATE batch_replies SET status = 'posted', reply_comment_id = ?, reply_published_at = ? WHERE id = ?`
      ).run(postedCommentId, publishedAt, replyId);
      markAskAnswered(db, {
        askId: reply.ask_id,
        replyId: postedCommentId,
        replyUrl: commentUrl(batch.video_id, postedCommentId),
        repliedAt: publishedAt,
      });
      posted += 1;
    } catch (err) {
      db.prepare(`UPDATE batch_replies SET status = 'failed', error = ? WHERE id = ?`).run(
        err?.message ?? String(err),
        replyId
      );
      failed += 1;
    }

    if (i < candidateIds.length - 1) await sleep(throttleMs);
  }

  const stillPending = db
    .prepare(`SELECT COUNT(*) as n FROM batch_replies WHERE batch_id = ? AND status IN ('approved', 'drafted', 'posting')`)
    .get(batchId).n;
  const anyFailedOrQueued = failed > 0 || queued > 0;
  const status = stillPending > 0 || anyFailedOrQueued ? 'partial' : 'posted';
  db.prepare(`UPDATE batches SET status = ? WHERE id = ?`).run(status, batchId);

  return { posted, failed, queued };
}
