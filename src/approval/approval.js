/**
 * F5 approval: the batch is the unit of approval (one tap approves everything
 * not struck); no insert call is reachable without an approved batch id
 * (enforced here, not just at the UI layer — posting.js requires status
 * 'approved' on the reply row before it will call comments.insert).
 */

/**
 * Full view of a batch for the approval page: each reply alongside the
 * original comment it answers.
 * @param {import('better-sqlite3').Database} db
 * @param {string} batchId
 */
export function getBatchView(db, batchId) {
  const batch = db.prepare(`SELECT * FROM batches WHERE id = ?`).get(batchId);
  if (!batch) return null;

  const replies = db
    .prepare(
      `SELECT br.id as replyId, br.reply_text as replyText, br.timestamp_pointer as timestampPointer,
              br.status, br.error, br.reply_comment_id as replyCommentId, br.reply_published_at as replyPublishedAt,
              a.id as askId, a.topic,
              p.display_name as askerName, p.asker_channel_id as askerChannelId
       FROM batch_replies br
       JOIN asks a ON a.id = br.ask_id
       JOIN people p ON p.id = a.person_id
       WHERE br.batch_id = ?
       ORDER BY br.id ASC`
    )
    .all(batchId);

  const withOriginal = replies.map((r) => {
    const originalEvent = db
      .prepare(
        `SELECT quote, occurred_at as occurredAt, comment_id as commentId
         FROM ask_events WHERE ask_id = ? ORDER BY occurred_at DESC LIMIT 1`
      )
      .get(r.askId);
    return { ...r, originalComment: originalEvent ?? null };
  });

  return { batch, replies: withOriginal };
}

/**
 * One tap: approves every reply still in 'drafted' state (per-reply strikes
 * already moved theirs to 'struck', which this leaves untouched) and marks
 * the batch 'approved'. Nothing posts here — posting.js runs separately.
 * @param {import('better-sqlite3').Database} db
 * @param {string} batchId
 * @returns {{ok: boolean, approvedCount: number}}
 */
export function approveBatch(db, batchId) {
  const run = db.transaction(() => {
    const info = db
      .prepare(`UPDATE batch_replies SET status = 'approved' WHERE batch_id = ? AND status = 'drafted'`)
      .run(batchId);
    db.prepare(`UPDATE batches SET status = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(
      batchId
    );
    return info.changes;
  });
  const approvedCount = run();
  return { ok: approvedCount > 0, approvedCount };
}

/**
 * Per-row strike: removes one reply from the batch before approval. A struck
 * reply is never posted even if the batch is later approved.
 * @param {import('better-sqlite3').Database} db
 * @param {string} batchId
 * @param {number} replyId
 */
export function strikeReply(db, batchId, replyId) {
  const info = db
    .prepare(`UPDATE batch_replies SET status = 'struck' WHERE batch_id = ? AND id = ? AND status = 'drafted'`)
    .run(batchId, replyId);
  return { ok: info.changes > 0 };
}
