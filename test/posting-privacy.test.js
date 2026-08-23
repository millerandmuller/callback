import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks } from '../src/ledger/ledger.js';
import { matchAndDraft } from '../src/matching/match.js';
import { approveBatch } from '../src/approval/approval.js';
import { postApprovedBatch } from '../src/posting/posting.js';

// F6 acceptance: "posting is refused while the video is non-public and starts
// once it is public (tests for both)". The unlisted-first flow (decided
// 2026-08-22) drafts and approves a batch while the answering video is still
// unlisted, so postApprovedBatch must read privacyStatus fresh -- via
// videos.list on ytWrite -- before its first comments.insert, every call.

function seedApprovedBatch(db) {
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
  return getOpenAsks(db, 'own');
}

async function draftAndApprove(db, videoId = 'v2') {
  const [ask] = seedApprovedBatch(db);
  const mind = { async ask() { return { timedOut: false, text: `\`\`\`json\n[{"askId":${ask.askId},"askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n\`\`\`` }; } };
  const matched = await matchAndDraft(db, mind, { namespace: 'own', videoId, videoTitle: 't2', videoDescription: '', captionsText: null, creatorName: 'Mei' });
  approveBatch(db, matched.batchId);
  return matched.batchId;
}

function fakeYtWriteWithPrivacy(privacyStatus) {
  let insertCalls = 0;
  return {
    insertCalls: () => insertCalls,
    videos: {
      async list({ id }) {
        assert.deepEqual(id, ['v2'], 'checks the answering video, not some other id');
        return { data: { items: [{ status: { privacyStatus } }] } };
      },
    },
    comments: {
      async insert() {
        insertCalls += 1;
        return { data: { id: `reply-${insertCalls}`, snippet: { publishedAt: '2026-08-27T14:01:10Z' } } };
      },
    },
  };
}

test('F6: refuses to post while the answering video is unlisted', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApprove(db);
  const ytWrite = fakeYtWriteWithPrivacy('unlisted');

  const result = await postApprovedBatch(db, ytWrite, batchId, { throttleMs: 0 });

  assert.deepEqual(result, { posted: 0, failed: 0, queued: 0, waitingForPublic: true, privacyStatus: 'unlisted' });
  assert.equal(ytWrite.insertCalls(), 0, 'comments.insert is never called while the video is non-public');
  const reply = db.prepare(`SELECT status FROM batch_replies WHERE batch_id = ?`).get(batchId);
  assert.equal(reply.status, 'approved', 'the reply stays approved, not posted or failed, while waiting');
  const batch = db.prepare(`SELECT status FROM batches WHERE id = ?`).get(batchId);
  assert.equal(batch.status, 'approved', 'the batch itself is untouched while waiting');
});

test('F6: refuses to post while the answering video is private', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApprove(db);
  const ytWrite = fakeYtWriteWithPrivacy('private');

  const result = await postApprovedBatch(db, ytWrite, batchId, { throttleMs: 0 });

  assert.deepEqual(result, { posted: 0, failed: 0, queued: 0, waitingForPublic: true, privacyStatus: 'private' });
  assert.equal(ytWrite.insertCalls(), 0);
});

test('F6: posts once the answering video is public', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApprove(db);
  const ytWrite = fakeYtWriteWithPrivacy('public');

  const result = await postApprovedBatch(db, ytWrite, batchId, { throttleMs: 0 });

  assert.deepEqual(result, { posted: 1, failed: 0, queued: 0 });
  assert.equal(ytWrite.insertCalls(), 1);
  const reply = db.prepare(`SELECT status FROM batch_replies WHERE batch_id = ?`).get(batchId);
  assert.equal(reply.status, 'posted');
});

test('F6: a batch first seen while unlisted posts as soon as a later re-check finds it public (re-check flow)', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApprove(db);

  const waitingCheck = await postApprovedBatch(db, fakeYtWriteWithPrivacy('unlisted'), batchId, { throttleMs: 0 });
  assert.equal(waitingCheck.waitingForPublic, true);

  // Simulates the posting-poll cron's next 30s tick, or the approval page's
  // own 30s meta-refresh cycle, after the creator flips the video public.
  const nowPublicCheck = await postApprovedBatch(db, fakeYtWriteWithPrivacy('public'), batchId, { throttleMs: 0 });
  assert.deepEqual(nowPublicCheck, { posted: 1, failed: 0, queued: 0 });
});

test('F6: a batch with nothing left to post never triggers a privacy check', async () => {
  const db = openDb(':memory:');
  const batchId = await draftAndApprove(db);

  let listCalled = false;
  const ytWriteThatShouldNotBeCalled = {
    videos: { async list() { listCalled = true; return { data: { items: [{ status: { privacyStatus: 'public' } }] } }; } },
    comments: { async insert() { return { data: { id: 'r1', snippet: { publishedAt: '2026-08-27T00:00:00Z' } } }; } },
  };
  await postApprovedBatch(db, ytWriteThatShouldNotBeCalled, batchId, { throttleMs: 0 });
  assert.equal(listCalled, true, 'sanity: the first call does check');

  listCalled = false;
  const result = await postApprovedBatch(db, ytWriteThatShouldNotBeCalled, batchId, { throttleMs: 0 });
  assert.deepEqual(result, { posted: 0, failed: 0, queued: 0 });
  assert.equal(listCalled, false, 'nothing approved left to post, so no privacy check is made');
});
