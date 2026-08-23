#!/usr/bin/env node
/**
 * T-04 (F7 acceptance): reports today's quota usage and anything sitting in
 * post_queue (replies that hit an exhausted quota and were queued instead of
 * failed, per postApprovedBatch in src/posting/posting.js). The
 * queue-instead-of-fail behavior itself is unit-tested in
 * test/quota-queue.test.js; this script is the live-state check to paste
 * into deployments.md.
 */
import { config } from '../../src/config.js';
import { openDb } from '../../src/db/index.js';
import { getUsedToday, getRemainingToday, pacificDayKey } from '../../src/youtube/quota.js';

function main() {
  const db = openDb();
  const used = getUsedToday(db);
  const remaining = getRemainingToday(db);

  console.log(`Pacific day: ${pacificDayKey()}`);
  console.log(`Quota used:      ${used} / ${config.youtube.quotaDailyUnits}`);
  console.log(`Quota remaining: ${remaining}`);

  const queued = db
    .prepare(
      `SELECT pq.id, pq.reason, pq.queued_at as queuedAt, br.reply_text as replyText
       FROM post_queue pq JOIN batch_replies br ON br.id = pq.batch_reply_id`
    )
    .all();

  console.log(`\nQueued replies: ${queued.length}`);
  for (const q of queued) {
    console.log(`  #${q.id} queued ${q.queuedAt} — ${q.reason}`);
  }

  console.log(
    queued.length > 0
      ? '\nT-04: queue is populated as expected when quota is (or was) exhausted — re-run postApprovedBatch after the Pacific-midnight reset to drain it.'
      : '\nT-04: queue is empty — either quota has never been exhausted, or nothing is currently queued. See test/quota-queue.test.js for the unit-level proof of the queuing behavior itself.'
  );
}

main();
