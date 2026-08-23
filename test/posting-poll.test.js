import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks } from '../src/ledger/ledger.js';
import { matchAndDraft } from '../src/matching/match.js';
import { approveBatch } from '../src/approval/approval.js';
import { runPostingPollCycle } from '../src/scheduler/cron.js';

// Adversarial find, Round 3: runPostingPollCycle fires every 30s regardless
// of whether a prior tick's postApprovedBatch call for the same batch has
// finished (a multi-reply batch's own posting.js status stays 'approved'
// until every reply is done). Without a guard, an overlapping tick starts a
// second, genuinely concurrent postApprovedBatch call on the SAME batch --
// the existing atomic per-reply claim still prevents any double-post, but
// the two calls' independent throttle sleeps collapse the pacing between
// different replies to well under the intended 20s, violating F6's stated
// "one reply per 20s". The fix: an in-memory batchesInFlight guard in
// cron.js. This test proves the guard actually prevents the SECOND
// overlapping call from even starting (not just that posting stays safe --
// that was already covered by test/adversarial-fixes.test.js's Probe 1).

async function draftAndApproveOneReply(db) {
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES ('c1','own','v1','UCkai','Kai','q','2026-08-23T00:00:00Z')`
  ).run();
  mergeExtractionResults(db, {
    namespace: 'own',
    videoId: 'v1',
    items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'q', publishedAt: '2026-08-23T00:00:00Z' }],
  });
  const [ask] = getOpenAsks(db, 'own');
  const mind = { async ask() { return { timedOut: false, text: `\`\`\`json\n[{"askId":${ask.askId},"askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n\`\`\`` }; } };
  const matched = await matchAndDraft(db, mind, { namespace: 'own', videoId: 'v2', videoTitle: 't2', videoDescription: '', captionsText: null, creatorName: 'Mei' });
  approveBatch(db, matched.batchId);
  return matched.batchId;
}

/** A slow-but-realistic fake: the privacy read itself takes a beat, exactly the kind
 * of async gap a real HTTPS round trip creates -- enough for a second overlapping
 * runPostingPollCycle() call to observe the batch mid-flight if the guard didn't exist. */
function slowFakeYtWrite() {
  let listCalls = 0;
  let insertCalls = 0;
  return {
    listCalls: () => listCalls,
    insertCalls: () => insertCalls,
    videos: {
      async list() {
        listCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { data: { items: [{ status: { privacyStatus: 'public' } }] } };
      },
    },
    comments: {
      async insert() {
        insertCalls += 1;
        return { data: { id: `reply-${insertCalls}`, snippet: { publishedAt: '2026-08-27T00:00:00Z' } } };
      },
    },
  };
}

test('runPostingPollCycle: two overlapping ticks on the same batch only ever run postApprovedBatch once', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApproveOneReply(db);
  const ytWrite = slowFakeYtWrite();

  const [resultsA, resultsB] = await Promise.all([
    runPostingPollCycle(db, ytWrite),
    runPostingPollCycle(db, ytWrite),
  ]);

  assert.equal(ytWrite.listCalls(), 1, 'the privacy check (and therefore the whole postApprovedBatch call) must run exactly once across both overlapping ticks');
  assert.equal(ytWrite.insertCalls(), 1);

  const combined = [...resultsA, ...resultsB];
  const forThisBatch = combined.filter((r) => r.batchId === batchId);
  assert.equal(forThisBatch.length, 1, 'the skipped tick must not report a result for a batch it never touched');
  assert.equal(forThisBatch[0].posted, 1);

  const reply = db.prepare(`SELECT status FROM batch_replies WHERE batch_id = ?`).get(batchId);
  assert.equal(reply.status, 'posted');
});

test('runPostingPollCycle: the in-flight guard releases after completion, so a later tick can process a NEW batch', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApproveOneReply(db);
  const ytWrite = slowFakeYtWrite();

  await runPostingPollCycle(db, ytWrite);
  assert.equal(ytWrite.insertCalls(), 1);

  // The batch is now fully posted (status != 'approved'), so a later tick simply
  // finds nothing to do -- this also confirms the guard didn't leak and block
  // a batch id forever after it finished.
  const secondTick = await runPostingPollCycle(db, ytWrite);
  assert.deepEqual(secondTick, []);
  assert.equal(ytWrite.insertCalls(), 1, 'no re-post on a later tick once already posted');
});
