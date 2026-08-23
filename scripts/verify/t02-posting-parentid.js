#!/usr/bin/env node
/**
 * T-02 (F6 acceptance): for every posted reply in a batch, confirms
 * reply.parentId equals the asker's original comment id — fetched live from
 * YouTube, not just read back from our own SQLite row (that would only prove
 * our code believes it, not that YouTube agrees).
 * Usage: node scripts/verify/t02-posting-parentid.js <batchId>
 */
import { openDb } from '../../src/db/index.js';
import { createReadClient } from '../../src/youtube/client.js';

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error('Usage: node scripts/verify/t02-posting-parentid.js <batchId>');
    process.exitCode = 1;
    return;
  }

  const db = openDb();
  const yt = createReadClient();

  const posted = db
    .prepare(
      `SELECT br.id, br.reply_comment_id as replyCommentId, a.id as askId
       FROM batch_replies br JOIN asks a ON a.id = br.ask_id
       WHERE br.batch_id = ? AND br.status = 'posted'`
    )
    .all(batchId);

  if (posted.length === 0) {
    console.log('No posted replies in this batch yet.');
    return;
  }

  let allOk = true;
  for (const row of posted) {
    const originalEvent = db
      .prepare(`SELECT comment_id as commentId FROM ask_events WHERE ask_id = ? ORDER BY occurred_at ASC LIMIT 1`)
      .get(row.askId);

    const res = await yt.comments.list({ part: ['snippet'], id: [row.replyCommentId] });
    const reply = res.data.items?.[0];
    const parentId = reply?.snippet?.parentId;

    const ok = parentId === originalEvent.commentId;
    allOk = allOk && ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  reply ${row.replyCommentId}  parentId=${parentId}  expected=${originalEvent.commentId}`);
  }

  console.log(allOk ? '\nT-02 PASS' : '\nT-02 FAIL');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
