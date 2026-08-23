import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { runDryRun } from '../src/dryrun/dryrun.js';
import { postApprovedBatch } from '../src/posting/posting.js';

function fakeReadClient() {
  return {
    channels: {
      async list({ id, forHandle }) {
        if (forHandle === '@somehowtocreator' || id?.[0] === 'UCother') {
          return {
            data: {
              items: [
                {
                  id: 'UCother',
                  snippet: { title: 'Some How-To Creator' },
                  statistics: { subscriberCount: '85000' },
                  contentDetails: { relatedPlaylists: { uploads: 'UUother' } },
                },
              ],
            },
          };
        }
        return { data: { items: [] } };
      },
    },
    playlistItems: {
      async list() {
        return {
          data: {
            items: [
              { contentDetails: { videoId: 'dv1', videoPublishedAt: '2026-06-01T00:00:00Z' }, snippet: { publishedAt: '2026-06-01T00:00:00Z' } },
            ],
          },
        };
      },
    },
    videos: {
      async list() {
        return {
          data: {
            items: [
              { snippet: { title: 'Their how-to video', description: 'desc', publishedAt: '2026-06-01T00:00:00Z' }, contentDetails: { caption: 'true' } },
            ],
          },
        };
      },
    },
    commentThreads: {
      async list() {
        return {
          data: {
            items: [
              {
                snippet: {
                  topLevelComment: {
                    id: 'dc1',
                    snippet: {
                      authorChannelId: { value: 'UCfan1' },
                      authorDisplayName: 'Fan One',
                      textOriginal: 'how do you do the thing?',
                      publishedAt: '2026-06-02T00:00:00Z',
                      likeCount: '2',
                    },
                  },
                },
              },
            ],
          },
        };
      },
    },
  };
}

function fakeMindClassifyingEveryCommentAsAsk() {
  return {
    async ask(prompt) {
      const match = prompt.match(/commentId=(\S+)/g) ?? [];
      const data = match.map((m) => {
        const commentId = m.split('=')[1];
        return { commentId, askerChannelId: 'UCfan1', askerName: 'Fan One', isAsk: true, isAbusive: false, topic: 'the thing', quote: 'how do you do the thing?', publishedAt: '2026-06-02T00:00:00Z' };
      });
      return { timedOut: false, text: '```json\n' + JSON.stringify(data) + '\n```' };
    },
  };
}

test('E5 dry run harvests read-only into a separate namespace with real open asks', async () => {
  const db = openDb(':memory:');
  const result = await runDryRun(db, fakeReadClient(), fakeMindClassifyingEveryCommentAsAsk(), {
    handleOrChannelId: 'somehowtocreator',
  });
  assert.equal(result.ok, true);
  assert.equal(result.namespace, 'UCother');
  assert.equal(result.channelTitle, 'Some How-To Creator');
  assert.equal(result.openAsks.length, 1);
  assert.equal(result.openAsks[0].askerName, 'Fan One');
});

test('E5 has structurally no posting path: postApprovedBatch refuses a dry-run namespace batch', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'UCother', kind: 'dryrun', channelId: 'UCother' });
  db.prepare(`INSERT INTO batches (id, namespace, video_id, status) VALUES ('b1', 'UCother', 'dv1', 'approved')`).run();
  await assert.rejects(() => postApprovedBatch(db, {}, 'b1'), /Refusing to post/);
});

test('own-namespace batch posting still works (regression guard for the refusal check above)', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO batches (id, namespace, video_id, status) VALUES ('b1', 'own', 'v1', 'approved')`).run();
  const result = await postApprovedBatch(db, {}, 'b1');
  assert.deepEqual(result, { posted: 0, failed: 0, queued: 0 });
});
