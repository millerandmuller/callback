import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { harvest } from '../src/harvest/harvest.js';

/** Same two comments on every call -- simulates a re-run with no new activity. */
function fakeReadClient() {
  return {
    channels: {
      async list() {
        return { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUowner' } } }] } };
      },
    },
    playlistItems: {
      async list() {
        return { data: { items: [{ contentDetails: { videoId: 'v1', videoPublishedAt: '2026-08-01T00:00:00Z' } }] } };
      },
    },
    videos: {
      async list() {
        return { data: { items: [{ snippet: { title: 'Video one', description: 'd', publishedAt: '2026-08-01T00:00:00Z' }, contentDetails: { caption: 'false' } }] } };
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
                    id: 'c1',
                    snippet: { authorChannelId: { value: 'UCkai' }, authorDisplayName: 'Kai', textOriginal: 'lighting?', publishedAt: '2026-08-23T00:00:00Z', likeCount: '0' },
                  },
                },
              },
              {
                snippet: {
                  topLevelComment: {
                    id: 'c2',
                    snippet: { authorChannelId: { value: 'UCmo' }, authorDisplayName: 'Mo', textOriginal: 'nice video', publishedAt: '2026-08-23T01:00:00Z', likeCount: '1' },
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

test('T-01: harvest is idempotent -- a re-run with unchanged remote data adds zero new comments and zero duplicate rows', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  const yt = fakeReadClient();

  const first = await harvest(db, yt, { namespace: 'own', channelId: 'UCowner', ownerChannelId: 'UCowner' });
  assert.equal(first.newComments, 2);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM comments').get().n, 2);

  const second = await harvest(db, yt, { namespace: 'own', channelId: 'UCowner', ownerChannelId: 'UCowner' });
  assert.equal(second.newComments, 0, 're-run must add zero new comments when nothing changed remotely');
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM comments').get().n, 2, 're-run must not create duplicate rows');
});

test('harvest marks a comments-disabled video with a visible row instead of throwing (D-19)', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  const yt = fakeReadClient();
  yt.commentThreads.list = async () => {
    const err = new Error('commentsDisabled');
    err.code = 403;
    err.errors = [{ reason: 'commentsDisabled' }];
    throw err;
  };

  const result = await harvest(db, yt, { namespace: 'own', channelId: 'UCowner', ownerChannelId: 'UCowner' });
  assert.deepEqual(result.commentsOffVideos, ['v1']);
  assert.equal(result.newComments, 0);
  const video = db.prepare(`SELECT comments_enabled FROM videos WHERE id = 'v1' AND namespace = 'own'`).get();
  assert.equal(video.comments_enabled, 0);
});

test('a channel with zero uploads (playlistItems.list 404 playlistNotFound) is treated as 0 videos, not an error (M0 platform finding)', async () => {
  // Confirmed live during M0 against the real persona test channel: channels.list
  // reports videoCount 0 and still names an uploads playlist id, but that
  // playlist has never actually been created, so playlistItems.list 404s.
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  const yt = fakeReadClient();
  yt.playlistItems.list = async () => {
    const err = new Error('The playlist identified with the request\'s playlistId parameter cannot be found.');
    err.code = 404;
    err.errors = [{ reason: 'playlistNotFound' }];
    throw err;
  };

  const result = await harvest(db, yt, { namespace: 'own', channelId: 'UCowner', ownerChannelId: 'UCowner' });
  assert.deepEqual(result, { videosSeen: 0, commentsOffVideos: [], newComments: 0 });
});

test('a genuine 404 with a different reason still propagates (playlistNotFound handling must not swallow unrelated errors)', async () => {
  const db = openDb(':memory:');
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  const yt = fakeReadClient();
  yt.playlistItems.list = async () => {
    const err = new Error('quotaExceeded');
    err.code = 403;
    err.errors = [{ reason: 'quotaExceeded' }];
    throw err;
  };

  await assert.rejects(
    () => harvest(db, yt, { namespace: 'own', channelId: 'UCowner', ownerChannelId: 'UCowner' }),
    /quotaExceeded/
  );
});
