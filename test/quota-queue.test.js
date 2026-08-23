import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults } from '../src/ledger/ledger.js';
import { getOpenAsks } from '../src/ledger/ledger.js';
import { matchAndDraft } from '../src/matching/match.js';
import { approveBatch } from '../src/approval/approval.js';
import { postApprovedBatch } from '../src/posting/posting.js';
import { recordUsage } from '../src/youtube/quota.js';

test('T-04: quota exhaustion queues a reply instead of failing it', async () => {
  const db = openDb(':memory:');
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

  // Spend the day's entire quota budget so the one reply insert (50 units) can't be afforded.
  recordUsage(db, 10_000);

  let insertCalled = false;
  const fakeYtWrite = {
    videos: { async list() { return { data: { items: [{ status: { privacyStatus: 'public' } }] } }; } },
    comments: { async insert() { insertCalled = true; return { data: { id: 'r1', snippet: { publishedAt: '2026-08-27T00:00:00Z' } } }; } },
  };
  const result = await postApprovedBatch(db, fakeYtWrite, matched.batchId, { throttleMs: 0 });

  assert.deepEqual(result, { posted: 0, failed: 0, queued: 1 });
  assert.equal(insertCalled, false, 'quota-exhausted replies must never reach comments.insert');
  const queued = db.prepare(`SELECT * FROM post_queue`).all();
  assert.equal(queued.length, 1);
  assert.match(queued[0].reason, /quota exhausted/i);

  const stillOpen = getOpenAsks(db, 'own');
  assert.equal(stillOpen.length, 1, 'ask stays open, not answered, while queued');

  const batch = db.prepare(`SELECT status FROM batches WHERE id = ?`).get(matched.batchId);
  assert.equal(batch.status, 'partial');
});
