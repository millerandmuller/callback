import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks } from '../src/ledger/ledger.js';
import { matchAndDraft } from '../src/matching/match.js';
import { approveBatch } from '../src/approval/approval.js';
import { postApprovedBatch } from '../src/posting/posting.js';
import { createApp } from '../src/web/server.js';

// Regression tests for findings from the Round 1 adversarial examiner pass
// (see examiner_report.md). Each test names the probe it closes.

test('Probe 2/3: a malformed extraction item (isAsk=true, no topic) is skipped, not thrown -- surrounding well-formed items still merge', () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  const insert = db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES (?, 'own', 'v1', ?, ?, ?, ?)`
  );
  insert.run('c1', 'UCkai', 'Kai', 'lighting?', '2026-08-23T00:00:00Z');
  insert.run('c2', 'UCweird', 'Weird', 'ambiguous comment', '2026-08-23T00:01:00Z');
  insert.run('c3', 'UCmo', 'Mo', 'mic setup?', '2026-08-23T00:02:00Z');

  assert.doesNotThrow(() => {
    const result = mergeExtractionResults(db, {
      namespace: 'own',
      videoId: 'v1',
      items: [
        { commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'lighting?', publishedAt: '2026-08-23T00:00:00Z' },
        { commentId: 'c2', askerChannelId: 'UCweird', askerName: 'Weird', isAsk: true, isAbusive: false, publishedAt: '2026-08-23T00:01:00Z' }, // no topic -- malformed
        { commentId: 'c3', askerChannelId: 'UCmo', askerName: 'Mo', isAsk: true, isAbusive: false, topic: 'mic', quote: 'mic setup?', publishedAt: '2026-08-23T00:02:00Z' },
      ],
    });
    assert.equal(result.asksCreated, 2, 'both well-formed items still become asks');
    assert.equal(result.malformed, 1, 'the malformed item is counted, not silently dropped without a trace');
  });

  const open = getOpenAsks(db, 'own');
  assert.equal(open.length, 2);
  assert.deepEqual(open.map((a) => a.askerName).sort(), ['Kai', 'Mo']);
});

test('Re-review follow-up: a wrong-TYPED (not just missing) field is also skipped, not thrown -- topic as a number/object, askerChannelId as an object, askerName omitted', () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  const insert = db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES (?, 'own', 'v1', ?, ?, ?, ?)`
  );
  insert.run('c1', 'UCa', 'A', 'a', '2026-08-23T00:00:00Z');
  insert.run('c2', 'UCb', 'B', 'b', '2026-08-23T00:01:00Z');
  insert.run('c3', 'UCc', 'C', 'c', '2026-08-23T00:02:00Z');
  insert.run('c4', 'UCd', 'D', 'd', '2026-08-23T00:03:00Z');

  assert.doesNotThrow(() => {
    const result = mergeExtractionResults(db, {
      namespace: 'own',
      videoId: 'v1',
      items: [
        { commentId: 'c1', askerChannelId: 'UCa', askerName: 'A', isAsk: true, isAbusive: false, topic: 42, quote: 'a', publishedAt: '2026-08-23T00:00:00Z' }, // topic: number
        { commentId: 'c2', askerChannelId: 'UCb', askerName: 'B', isAsk: true, isAbusive: false, topic: { foo: 'bar' }, quote: 'b', publishedAt: '2026-08-23T00:01:00Z' }, // topic: object
        { commentId: 'c3', askerChannelId: { weird: true }, askerName: 'C', isAsk: true, isAbusive: false, topic: 'mic', quote: 'c', publishedAt: '2026-08-23T00:02:00Z' }, // askerChannelId: object
        { commentId: 'c4', askerChannelId: 'UCd', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'd', publishedAt: '2026-08-23T00:03:00Z' }, // askerName: omitted
      ],
    });
    assert.equal(result.asksCreated, 0);
    assert.equal(result.malformed, 4, 'every wrong-typed/missing field is caught, none reach the NOT NULL insert');
  });

  assert.equal(getOpenAsks(db, 'own').length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM people').get().n, 0);
});

test('Probe 3: POST /dryrun survives a malformed Mind classification on one comment instead of returning a bare 500', async () => {
  const db = openDb(':memory:');
  const fakeYtRead = {
    channels: {
      async list({ id, forHandle }) {
        const matches = forHandle === '@other' || id?.[0] === 'UCother';
        return { data: { items: matches ? [{ id: 'UCother', snippet: { title: 'Other Channel' }, statistics: { subscriberCount: '5000' }, contentDetails: { relatedPlaylists: { uploads: 'UUother' } } }] : [] } };
      },
    },
    playlistItems: { async list() { return { data: { items: [{ contentDetails: { videoId: 'dv1', videoPublishedAt: '2026-06-01T00:00:00Z' } }] } }; } },
    videos: { async list() { return { data: { items: [{ snippet: { title: 'their video', description: '', publishedAt: '2026-06-01T00:00:00Z' }, contentDetails: { caption: 'false' } }] } }; } },
    commentThreads: {
      async list() {
        return {
          data: {
            items: [
              { snippet: { topLevelComment: { id: 'dc1', snippet: { authorChannelId: { value: 'UCfan' }, authorDisplayName: 'Fan', textOriginal: 'ambiguous', publishedAt: '2026-06-02T00:00:00Z', likeCount: '0' } } } },
            ],
          },
        };
      },
    },
  };
  // Mind returns isAsk=true with no topic for the one comment -- this used to throw
  // inside mergeExtractionResults and propagate as a bare 500 from the route.
  const fakeMind = { async ask() { return { timedOut: false, text: '```json\n[{"commentId":"dc1","askerChannelId":"UCfan","askerName":"Fan","isAsk":true,"isAbusive":false,"publishedAt":"2026-06-02T00:00:00Z"}]\n```' }; } };

  const app = createApp({ db, namespace: 'own', ytRead: fakeYtRead, mind: fakeMind });
  const res = await app.request('/dryrun', {
    method: 'POST',
    body: new URLSearchParams({ handle: 'other' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.status, 200, 'must not surface as a bare 500 to a live audience-suggested dry run');
  const html = await res.text();
  assert.match(html, /Other Channel/);
});

test('Probe 1: two concurrent postApprovedBatch calls on the same batch never double-post the same reply', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES ('c1','own','v1','UCkai','Kai','q','2026-08-23T00:00:00Z')`).run();
  mergeExtractionResults(db, { namespace: 'own', videoId: 'v1', items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'q', publishedAt: '2026-08-23T00:00:00Z' }] });
  const [ask] = getOpenAsks(db, 'own');

  const mind = { async ask() { return { timedOut: false, text: `\`\`\`json\n[{"askId":${ask.askId},"askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n\`\`\`` }; } };
  const matched = await matchAndDraft(db, mind, { namespace: 'own', videoId: 'v2', videoTitle: 't2', videoDescription: '', captionsText: null, creatorName: 'Mei' });
  approveBatch(db, matched.batchId);

  let insertCalls = 0;
  const fakeYtWrite = {
    videos: { async list() { return { data: { items: [{ status: { privacyStatus: 'public' } }] } }; } },
    comments: {
      async insert() {
        insertCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15)); // simulate a real HTTPS round trip window for the race to occur in
        return { data: { id: `reply-${insertCalls}`, snippet: { publishedAt: '2026-08-27T00:00:00Z' } } };
      },
    },
  };

  const [resultA, resultB] = await Promise.all([
    postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 }),
    postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 }),
  ]);

  assert.equal(insertCalls, 1, 'comments.insert must be called exactly once total across both concurrent calls');
  assert.equal(resultA.posted + resultB.posted, 1, 'exactly one of the two calls reports having posted it');
  const postedRows = db.prepare(`SELECT * FROM batch_replies WHERE batch_id = ? AND status = 'posted'`).all(matched.batchId);
  assert.equal(postedRows.length, 1);
});

test('Probe 4: a stringified askId from the Mind is normalized, not silently dropped', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES ('c1','own','v1','UCkai','Kai','q','2026-08-23T00:00:00Z')`).run();
  mergeExtractionResults(db, { namespace: 'own', videoId: 'v1', items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'q', publishedAt: '2026-08-23T00:00:00Z' }] });
  const [ask] = getOpenAsks(db, 'own');

  // askId comes back as a JSON string, not a number.
  const mind = { async ask() { return { timedOut: false, text: `\`\`\`json\n[{"askId":"${ask.askId}","askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n\`\`\`` }; } };
  const matched = await matchAndDraft(db, mind, { namespace: 'own', videoId: 'v2', videoTitle: 't2', videoDescription: '', captionsText: null, creatorName: 'Mei' });

  assert.equal(matched.ok, true, 'a correctly-matched draft must not be silently discarded just because askId was a string');
  assert.equal(matched.matchedCount, 1);
});
