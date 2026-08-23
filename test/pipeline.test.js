import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks, getAnsweredAsks } from '../src/ledger/ledger.js';
import { matchAndDraft, getRegisterExamples } from '../src/matching/match.js';
import { getBatchView, approveBatch, strikeReply } from '../src/approval/approval.js';
import { postApprovedBatch } from '../src/posting/posting.js';

function seedOpenAsk(db, { namespace = 'own', videoId = 'v1', commentId, askerChannelId, askerName, topic, quote, publishedAt }) {
  ensureNamespace(db, { name: namespace, kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT OR IGNORE INTO videos (id, namespace, title, published_at) VALUES (?, ?, 'seed video', '2026-08-01T00:00:00Z')`).run(videoId, namespace);
  db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at)
     VALUES (@commentId, @namespace, @videoId, @askerChannelId, @askerName, @quote, @publishedAt)`
  ).run({ commentId, namespace, videoId, askerChannelId, askerName, quote, publishedAt });
  mergeExtractionResults(db, {
    namespace,
    videoId,
    items: [{ commentId, askerChannelId, askerName, isAsk: true, isAbusive: false, topic, quote, publishedAt }],
  });
}

/** Fake MindClient: hands back a canned reply for the match-and-draft prompt. */
function fakeMind(draftsJson) {
  return {
    calls: [],
    async ask(prompt) {
      this.calls.push(prompt);
      return { timedOut: false, text: `\`\`\`json\n${JSON.stringify(draftsJson)}\n\`\`\`\nDone.` };
    },
  };
}

test('F4 -> F5 -> F6: full callback loop closes an open ask', async () => {
  const db = openDb(':memory:');
  seedOpenAsk(db, {
    commentId: 'c1',
    askerChannelId: 'UCkai',
    askerName: 'Kai',
    topic: 'desk lighting',
    quote: 'how do you light the desk without the glare?',
    publishedAt: '2026-08-23T19:04:11Z',
  });
  const [ask] = getOpenAsks(db, 'own');

  const mind = fakeMind([
    { askId: ask.askId, askerChannelId: 'UCkai', replyText: "Kai, you asked how I light the desk without the glare. This one's for you; the part you want starts at 2:14.", timestamp: '2:14' },
  ]);

  const matched = await matchAndDraft(db, mind, {
    namespace: 'own',
    videoId: 'v2',
    videoTitle: 'How I light the desk without glare',
    videoDescription: 'A follow-up video',
    captionsText: '2:14 the actual fix',
    creatorName: 'Mei',
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.matchedCount, 1);

  const view = getBatchView(db, matched.batchId);
  assert.equal(view.batch.status, 'pending');
  assert.equal(view.replies.length, 1);
  assert.equal(view.replies[0].status, 'drafted');
  assert.equal(view.replies[0].originalComment.commentId, 'c1', 'shows the original comment beside the draft');

  // Nothing can post before approval: postApprovedBatch only ever selects status='approved' rows.
  const beforeApproval = await postApprovedBatch(db, {}, matched.batchId);
  assert.deepEqual(beforeApproval, { posted: 0, failed: 0, queued: 0 });

  const approval = approveBatch(db, matched.batchId);
  assert.equal(approval.approvedCount, 1);

  const fakeYtWrite = {
    comments: {
      async insert({ requestBody }) {
        assert.equal(requestBody.snippet.parentId, 'c1');
        return { data: { id: 'reply-1', snippet: { publishedAt: '2026-08-27T14:01:10Z' } } };
      },
    },
  };
  const posting = await postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 });
  assert.deepEqual(posting, { posted: 1, failed: 0, queued: 0 });

  assert.equal(getOpenAsks(db, 'own').length, 0);
  const [answered] = getAnsweredAsks(db, 'own');
  assert.equal(answered.replyUrl, 'https://www.youtube.com/watch?v=v2&lc=reply-1');

  // Idempotency: re-running posting on the same (now fully posted) batch is a no-op.
  const secondRun = await postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 });
  assert.deepEqual(secondRun, { posted: 0, failed: 0, queued: 0 });
});

test('a struck reply is never posted even after the batch is approved', async () => {
  const db = openDb(':memory:');
  seedOpenAsk(db, { commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', topic: 'lighting', quote: 'q1', publishedAt: '2026-08-23T00:00:00Z' });
  seedOpenAsk(db, { commentId: 'c2', askerChannelId: 'UCmo', askerName: 'Mo', topic: 'lighting', quote: 'q2', publishedAt: '2026-08-24T00:00:00Z' });
  const asks = getOpenAsks(db, 'own');

  const mind = fakeMind(
    asks.map((a) => ({ askId: a.askId, askerChannelId: a.askerChannelId, replyText: `${a.askerName}, here it is.`, timestamp: null }))
  );
  const matched = await matchAndDraft(db, mind, {
    namespace: 'own', videoId: 'v2', videoTitle: 'Lighting video', videoDescription: '', captionsText: null, creatorName: 'Mei',
  });
  assert.equal(matched.matchedCount, 2);

  const view = getBatchView(db, matched.batchId);
  const toStrike = view.replies[0];
  strikeReply(db, matched.batchId, toStrike.replyId);
  approveBatch(db, matched.batchId);

  const afterApproval = getBatchView(db, matched.batchId);
  assert.equal(afterApproval.replies.find((r) => r.replyId === toStrike.replyId).status, 'struck');
  assert.equal(afterApproval.replies.find((r) => r.replyId !== toStrike.replyId).status, 'approved');

  let insertCalls = 0;
  const fakeYtWrite = { comments: { async insert() { insertCalls += 1; return { data: { id: `reply-${insertCalls}`, snippet: { publishedAt: '2026-08-27T00:00:00Z' } } }; } } };
  const result = await postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 });
  assert.equal(result.posted, 1, 'only the approved reply posts, never the struck one');
  assert.equal(insertCalls, 1);
});

test('getRegisterExamples returns owner replies, most recent first, capped at 30', () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  const insert = db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at, is_owner_reply) VALUES (?, 'own', 'v1', 'UCowner', 'Mei', ?, ?, 1)`
  );
  insert.run('r1', 'Thanks for watching!', '2026-08-01T00:00:00Z');
  insert.run('r2', 'Glad it helped!', '2026-08-02T00:00:00Z');
  const examples = getRegisterExamples(db, 'own');
  assert.deepEqual(examples, ['Glad it helped!', 'Thanks for watching!']);
});
