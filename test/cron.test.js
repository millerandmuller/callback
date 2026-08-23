import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { mergeExtractionResults, getOpenAsks } from '../src/ledger/ledger.js';
import { runUploadPollCycle } from '../src/scheduler/cron.js';

// F4 acceptance: "an unlisted upload produces an approval batch before the
// video is public (unit test with a fake uploads list)". runUploadPollCycle
// itself is client-agnostic (it just calls whatever listRecentVideos/
// getVideoMeta it's given) -- the "must be the OAuth client" requirement is
// enforced by the caller (src/index.js / src/scheduler/cron.js's
// startSchedulers passing ytWrite, not ytRead). What's unit-testable here is
// the behavior once an unlisted upload appears in the uploads list: it must
// be detected as new and matched-and-drafted against open asks, exactly as
// it would be for a public one -- privacy status plays no part in detection
// or matching, only in F6's later posting gate.

function seedOpenAsk(db) {
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v1','own','t','2026-08-01T00:00:00Z')`).run();
  db.prepare(
    `INSERT INTO comments (id, namespace, video_id, author_channel_id, author_display_name, text, published_at) VALUES ('c1','own','v1','UCkai','Kai','how do you light the desk?','2026-08-23T00:00:00Z')`
  ).run();
  mergeExtractionResults(db, {
    namespace: 'own',
    videoId: 'v1',
    items: [{ commentId: 'c1', askerChannelId: 'UCkai', askerName: 'Kai', isAsk: true, isAbusive: false, topic: 'lighting', quote: 'how do you light the desk?', publishedAt: '2026-08-23T00:00:00Z' }],
  });
  return getOpenAsks(db, 'own');
}

function fakeMindDrafting(askId) {
  return {
    async ask() {
      return { timedOut: false, text: `\`\`\`json\n[{"askId":${askId},"askerChannelId":"UCkai","replyText":"Kai, here it is; the part you want starts at 2:14.","timestamp":"2:14"}]\n\`\`\`` };
    },
  };
}

test('F4: an unlisted upload in the fake uploads list is detected as new and matched-and-drafted', async () => {
  const db = openDb(':memory:');
  const [ask] = seedOpenAsk(db);
  const mind = fakeMindDrafting(ask.askId);
  const oauthClient = { label: 'this stands in for the OAuth write client, whatever it is' };

  // A fake uploads list carrying one video -- as an OAuth-authenticated
  // listRecentVideos would return for an unlisted upload (an API-key read
  // client would never surface it here at all; that's enforced by which
  // client the caller passes in, not by this function).
  const fakeUploadsList = [{ videoId: 'v2', title: 'How I light the desk', publishedAt: '2026-08-24T10:00:00Z' }];
  let listRecentVideosCalledWith = null;
  const listRecentVideos = async (yt, channelId, n) => {
    listRecentVideosCalledWith = { yt, channelId, n };
    return fakeUploadsList;
  };
  const getVideoMeta = async (yt, videoId) => ({
    videoId,
    title: 'How I light the desk',
    description: 'A follow-up video about desk lighting',
    publishedAt: '2026-08-24T10:00:00Z',
    captionsAvailable: true,
    privacyStatus: 'unlisted',
  });

  const result = await runUploadPollCycle(db, oauthClient, mind, { listRecentVideos, getVideoMeta });

  assert.equal(listRecentVideosCalledWith.yt, oauthClient, 'must poll uploads with whatever client it was given (the OAuth client, per the caller)');
  assert.equal(result.newVideo, true);
  assert.equal(result.matched, true);
  assert.equal(result.matchedCount, 1);

  const batch = db.prepare(`SELECT * FROM batches WHERE video_id = 'v2'`).get();
  assert.ok(batch, 'a batch was created for the unlisted video before it was public');
  const reply = db.prepare(`SELECT * FROM batch_replies WHERE batch_id = ?`).get(batch.id);
  assert.equal(reply.status, 'drafted');
  assert.match(reply.reply_text, /2:14/);
});

test('F4: an already-known video (already harvested this cycle) is not re-matched', async () => {
  const db = openDb(':memory:');
  seedOpenAsk(db);
  db.prepare(`INSERT INTO videos (id, namespace, title, published_at) VALUES ('v2','own','known already','2026-08-24T10:00:00Z')`).run();

  const listRecentVideos = async () => [{ videoId: 'v2', title: 'known already', publishedAt: '2026-08-24T10:00:00Z' }];
  const getVideoMeta = async () => { throw new Error('must not be called for an already-known video'); };

  const result = await runUploadPollCycle(db, {}, { async ask() { throw new Error('must not be called'); } }, { listRecentVideos, getVideoMeta });

  assert.deepEqual(result, { newVideo: false });
});

test('F4: a new video with zero open asks produces no batch', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });

  const listRecentVideos = async () => [{ videoId: 'v3', title: 'nothing to answer', publishedAt: '2026-08-24T10:00:00Z' }];
  const getVideoMeta = async (yt, videoId) => ({ videoId, title: 'nothing to answer', description: '', publishedAt: '2026-08-24T10:00:00Z', captionsAvailable: false, privacyStatus: 'unlisted' });

  const result = await runUploadPollCycle(db, {}, {}, { listRecentVideos, getVideoMeta });

  assert.deepEqual(result, { newVideo: true, matched: false, reason: 'no open asks' });
  const batch = db.prepare(`SELECT * FROM batches WHERE video_id = 'v3'`).get();
  assert.equal(batch, undefined);
});
