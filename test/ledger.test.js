import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks, getAnsweredAsks, markAskAnswered } from '../src/ledger/ledger.js';

function seedVideoAndComments(db, { namespace, videoId, comments }) {
  ensureNamespace(db, { name: namespace, kind: 'own', channelId: 'UCowner' });
  db.prepare(
    `INSERT INTO videos (id, namespace, title, published_at) VALUES (?, ?, 'Test video', '2026-08-01T00:00:00Z')`
  ).run(videoId, namespace);
  const insert = db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at)
     VALUES (@id, @namespace, @videoId, @authorChannelId, @authorDisplayName, @text, @publishedAt)`
  );
  for (const c of comments) insert.run({ namespace, videoId, ...c });
}

test('same person asking the same topic twice yields one ask row with two events', () => {
  const db = openDb(':memory:');
  const namespace = 'own';
  const videoId = 'v1';
  seedVideoAndComments(db, {
    namespace,
    videoId,
    comments: [
      { id: 'c1', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'how do you light the desk?', publishedAt: '2026-08-23T19:04:11Z' },
      { id: 'c2', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'still wondering about the glare', publishedAt: '2026-08-25T08:12:40Z' },
    ],
  });

  mergeExtractionResults(db, {
    namespace,
    videoId,
    items: [
      { commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'how do you light the desk?', publishedAt: '2026-08-23T19:04:11Z' },
      { commentId: 'c2', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'still wondering about the glare', publishedAt: '2026-08-25T08:12:40Z' },
    ],
  });

  const open = getOpenAsks(db, namespace);
  assert.equal(open.length, 1, 'one row, not two, for the same person + topic');
  assert.equal(open[0].askerName, 'Kai');
  assert.equal(open[0].events.length, 2, 'both dates recorded as events on the one ask');
  assert.equal(open[0].first_asked_at, '2026-08-23T19:04:11Z');
  assert.equal(open[0].last_asked_at, '2026-08-25T08:12:40Z');
});

test('repeat ask arriving OUT of chronological order still yields correct first/last dates (2026-08-25 live finding: the Mind returns batches in its own order)', () => {
  const db = openDb(':memory:');
  const namespace = 'own';
  const videoId = 'v1';
  seedVideoAndComments(db, {
    namespace,
    videoId,
    comments: [
      { id: 'c1', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'how do you light the desk?', publishedAt: '2026-08-23T19:04:11Z' },
      { id: 'c2', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'still wondering about the glare', publishedAt: '2026-08-25T08:12:40Z' },
    ],
  });

  // Same two comments as the test above, but the NEWER one is merged first —
  // exactly what happened live with T1's Monday-before-Sunday batch order.
  mergeExtractionResults(db, {
    namespace,
    videoId,
    items: [
      { commentId: 'c2', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'still wondering about the glare', publishedAt: '2026-08-25T08:12:40Z' },
      { commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'how do you light the desk?', publishedAt: '2026-08-23T19:04:11Z' },
    ],
  });

  const open = getOpenAsks(db, namespace);
  assert.equal(open.length, 1);
  assert.equal(open[0].events.length, 2);
  assert.equal(open[0].first_asked_at, '2026-08-23T19:04:11Z', 'first_asked_at must be the OLDER date even when it arrives second');
  assert.equal(open[0].last_asked_at, '2026-08-25T08:12:40Z');
});

test('abusive and non-ask comments never appear as asks', () => {
  const db = openDb(':memory:');
  const namespace = 'own';
  const videoId = 'v1';
  seedVideoAndComments(db, {
    namespace,
    videoId,
    comments: [
      { id: 'c1', authorChannelId: 'UCtroll', authorDisplayName: 'Troll', text: 'you are terrible', publishedAt: '2026-08-23T19:04:11Z' },
      { id: 'c2', authorChannelId: 'UCfan', authorDisplayName: 'Fan', text: 'nice video!', publishedAt: '2026-08-23T19:05:11Z' },
    ],
  });

  const result = mergeExtractionResults(db, {
    namespace,
    videoId,
    items: [
      { commentId: 'c1', askerChannelId: 'UCtroll', askerName: 'Troll', isAsk: false, isAbusive: true, publishedAt: '2026-08-23T19:04:11Z' },
      { commentId: 'c2', askerChannelId: 'UCfan', askerName: 'Fan', isAsk: false, isAbusive: false, publishedAt: '2026-08-23T19:05:11Z' },
    ],
  });

  assert.equal(result.filtered, 2);
  assert.equal(getOpenAsks(db, namespace).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM people').get().n, 0, 'no person row for filtered comments');
});

test('never-twice: answering an ask removes it from open and it never reopens', () => {
  const db = openDb(':memory:');
  const namespace = 'own';
  const videoId = 'v1';
  seedVideoAndComments(db, {
    namespace,
    videoId,
    comments: [{ id: 'c1', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'lighting?', publishedAt: '2026-08-23T19:04:11Z' }],
  });
  mergeExtractionResults(db, {
    namespace,
    videoId,
    items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'lighting?', publishedAt: '2026-08-23T19:04:11Z' }],
  });

  const [ask] = getOpenAsks(db, namespace);
  markAskAnswered(db, { askId: ask.askId, replyId: 'reply1', replyUrl: 'https://youtu.be/x', repliedAt: '2026-08-27T14:01:10Z' });

  assert.equal(getOpenAsks(db, namespace).length, 0);
  const answered = getAnsweredAsks(db, namespace);
  assert.equal(answered.length, 1);
  assert.equal(answered[0].replyUrl, 'https://youtu.be/x');

  // A later comment on the same topic from the same person must bump the
  // now-answered ask's dates but must NOT flip it back to 'open' — matching
  // (matchAndDraft.js) is what excludes answered asks from future drafts.
  seedVideoAndComments(db, {
    namespace,
    videoId: 'v2',
    comments: [{ id: 'c2', authorChannelId: 'UCkai', authorDisplayName: 'Kai', text: 'still glare', publishedAt: '2026-08-29T00:00:00Z' }],
  });
  mergeExtractionResults(db, {
    namespace,
    videoId: 'v2',
    items: [{ commentId: 'c2', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'still glare', publishedAt: '2026-08-29T00:00:00Z' }],
  });
  assert.equal(getOpenAsks(db, namespace).length, 0, 'answered ask must not reopen from a later mention');
  const status = db.prepare('SELECT status FROM asks WHERE id = ?').get(ask.askId).status;
  assert.equal(status, 'answered');
});
