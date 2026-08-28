import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults } from '../src/ledger/ledger.js';
import { matchAndDraft } from '../src/matching/match.js';
import { approveBatch } from '../src/approval/approval.js';
import { createApp } from '../src/web/server.js';

function seedOneOpenAsk(db) {
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1', 'own', 'Video one', '2026-08-01T00:00:00Z')`).run();
  db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at)
     VALUES ('c1', 'own', 'v1', 'UCkai', 'Kai', 'glare?', '2026-08-23T19:04:11Z')`
  ).run();
  mergeExtractionResults(db, {
    namespace: 'own',
    videoId: 'v1',
    items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'desk lighting', quote: 'glare?', publishedAt: '2026-08-23T19:04:11Z' }],
  });
}

test('F7: /ledger renders from SQLite with no ytRead/mind configured (offline snapshot rendering)', async () => {
  const db = openDb(':memory:');
  seedOneOpenAsk(db);
  const app = createApp({ db, namespace: 'own' }); // no ytRead, no mind passed in at all
  const res = await app.request('/ledger');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Open asks \(1\)/);
  assert.match(html, /Kai/);
});

test('/ledger shows the empty state when there are no open asks', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  const app = createApp({ db, namespace: 'own' });
  const res = await app.request('/ledger');
  const html = await res.text();
  assert.match(html, /No open asks\. Your comment section is caught up\./);
});

test('/approve/:batchId approve flow: nothing posts, one tap approves, struck rows are excluded from the count', async () => {
  const db = openDb(':memory:');
  seedOneOpenAsk(db);
  const mind = {
    async ask() {
      return { timedOut: false, text: '```json\n[{"askId":1,"askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n```' };
    },
  };
  const matched = await matchAndDraft(db, mind, {
    namespace: 'own', videoId: 'v2', videoTitle: 'Follow-up', videoDescription: '', captionsText: null, creatorName: 'Mei',
  });

  const app = createApp({ db, namespace: 'own' });
  const getRes = await app.request(`/approve/${matched.batchId}`);
  const getHtml = await getRes.text();
  assert.match(getHtml, /Nothing posts until you tap/);
  assert.match(getHtml, /Call back 1 people/);
  // Form actions must be ABSOLUTE paths carrying the batch id: a relative
  // action ("approve") resolves in the browser against /approve/<batchId> to
  // /approve/approve and 404s — found live at the first real tap. This app
  // .request() call bypasses browser URL resolution, so assert on the HTML.
  assert.ok(
    getHtml.includes(`action="/approve/${matched.batchId}/approve"`),
    'approve form action must be absolute and include the batch id'
  );
  assert.ok(
    getHtml.includes(`action="/approve/${matched.batchId}/strike/`),
    'strike form actions must be absolute and include the batch id'
  );

  const approveRes = await app.request(`/approve/${matched.batchId}/approve`, { method: 'POST' });
  assert.equal(approveRes.status, 302);

  const batchAfter = db.prepare('SELECT status FROM batches WHERE id = ?').get(matched.batchId);
  assert.equal(batchAfter.status, 'approved');
});

test('/approve/:batchId: a failed privacy check shows "waiting", not a misleading static "approved"', async () => {
  // Adversarial find, Round 3: a transient getVideoMeta error used to leave
  // waitingForPublic at its default false, rendering an unexplained static
  // "Batch status: approved" -- indistinguishable from everything being
  // fine. It must instead show the same honest "waiting" state a genuinely
  // unlisted/private video would, with the 30s refresh so it retries itself.
  const db = openDb(':memory:');
  seedOneOpenAsk(db);
  const mind = {
    async ask() {
      return { timedOut: false, text: '```json\n[{"askId":1,"askerChannelId":"UCkai","replyText":"Kai, here it is.","timestamp":null}]\n```' };
    },
  };
  const matched = await matchAndDraft(db, mind, {
    namespace: 'own', videoId: 'v2', videoTitle: 'Follow-up', videoDescription: '', captionsText: null, creatorName: 'Mei',
  });
  approveBatch(db, matched.batchId);

  const throwingYtWrite = { videos: { async list() { throw new Error('simulated transient network error'); } } };
  const app = createApp({ db, namespace: 'own', ytWrite: throwingYtWrite });
  const res = await app.request(`/approve/${matched.batchId}`);
  const html = await res.text();

  assert.match(html, /Waiting for the video to go public/);
  assert.doesNotMatch(html, /Batch status: approved/);
  assert.match(html, /<meta http-equiv="refresh" content="30">/);
});

test('/dryrun shows a clear OPEN message when credentials are not configured', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, namespace: 'own' }); // ytRead/mind omitted, as they will be until M0 is done
  const res = await app.request('/dryrun', { method: 'POST', body: new URLSearchParams({ handle: 'somechannel' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const html = await res.text();
  assert.match(html, /M0 not complete/);
});
