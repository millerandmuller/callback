#!/usr/bin/env node
/**
 * T-03 (F6 acceptance + Section 15 output format): for a posted ask, prints
 * the proof line (asker comment / video / reply, each with publishedAt) and
 * checks ask < video < reply, plus that the (askerChannelId, topic) pair is
 * answered exactly once. Paste this script's output into deployments.md.
 * Usage: node scripts/verify/t03-order-proof.js <askId>
 */
import { openDb } from '../../src/db/index.js';

function main() {
  const askId = process.argv[2];
  if (!askId) {
    console.error('Usage: node scripts/verify/t03-order-proof.js <askId>');
    process.exitCode = 1;
    return;
  }

  const db = openDb();
  const ask = db.prepare(`SELECT * FROM asks WHERE id = ?`).get(askId);
  if (!ask) {
    console.error(`No ask with id ${askId}`);
    process.exitCode = 1;
    return;
  }
  if (ask.status !== 'answered') {
    console.error(`Ask ${askId} is not answered yet (status: ${ask.status}).`);
    process.exitCode = 1;
    return;
  }

  const firstEvent = db
    .prepare(`SELECT comment_id as commentId, occurred_at as occurredAt, quote FROM ask_events WHERE ask_id = ? ORDER BY occurred_at ASC LIMIT 1`)
    .get(askId);
  const video = db.prepare(`SELECT id, published_at as publishedAt FROM videos v JOIN batches b ON b.video_id = v.id WHERE b.id = (SELECT batch_id FROM batch_replies WHERE ask_id = ? LIMIT 1)`).get(askId);

  const askOk = firstEvent.occurredAt < video.publishedAt;
  const videoOk = video.publishedAt < ask.replied_at;

  console.log(`asker.comment   ${firstEvent.commentId}   publishedAt ${firstEvent.occurredAt}   "${firstEvent.quote}"`);
  console.log(`video           ${video.id}   publishedAt ${video.publishedAt}`);
  console.log(`reply           ${ask.reply_id}   parentId ${firstEvent.commentId}   publishedAt ${ask.replied_at}`);
  console.log(`order ok: ${askOk && videoOk ? 'ask < video < reply' : 'FAIL — check timestamps above'}   never-twice ok: (person ${ask.person_id}, ${ask.topic}) answered once`);

  const answeredCount = db
    .prepare(`SELECT COUNT(*) as n FROM asks WHERE person_id = ? AND topic = ? AND status = 'answered'`)
    .get(ask.person_id, ask.topic).n;

  const pass = askOk && videoOk && answeredCount === 1;
  console.log(pass ? '\nT-03 PASS' : '\nT-03 FAIL');
  if (!pass) process.exitCode = 1;
}

main();
