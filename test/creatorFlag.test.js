import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ensureNamespace } from '../src/db/index.js';
import { checkCreatorFlag, formatSubscriberCount } from '../src/creatorFlag/creatorFlag.js';

function seedPerson(db) {
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: 'UCowner' });
  db.prepare(`INSERT INTO people (asker_channel_id, namespace, display_name) VALUES ('UCkai', 'own', 'Kai')`).run();
  return db.prepare(`SELECT id FROM people WHERE asker_channel_id = 'UCkai'`).get().id;
}

test('qualifying channel (uploads + >=1000 subs) is labeled and cached', async () => {
  const db = openDb(':memory:');
  const personId = seedPerson(db);
  let calls = 0;
  const fakeYt = {
    channels: {
      async list() {
        calls += 1;
        return { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUxxx' } }, statistics: { subscriberCount: '12400' } }] } };
      },
    },
  };
  const first = await checkCreatorFlag(db, fakeYt, { personId, askerChannelId: 'UCkai' });
  assert.deepEqual(first, { isCreator: true, subscriberCount: 12400 });
  assert.equal(calls, 1);

  const second = await checkCreatorFlag(db, fakeYt, { personId, askerChannelId: 'UCkai' });
  assert.deepEqual(second, { isCreator: true, subscriberCount: 12400 });
  assert.equal(calls, 1, 'second call must be served from the cache, not a new channels.list call');
});

test('non-qualifying channel (below threshold) is not labeled', async () => {
  const db = openDb(':memory:');
  const personId = seedPerson(db);
  const fakeYt = { channels: { async list() { return { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUxxx' } }, statistics: { subscriberCount: '40' } }] } }; } } };
  const result = await checkCreatorFlag(db, fakeYt, { personId, askerChannelId: 'UCkai' });
  assert.deepEqual(result, { isCreator: false, subscriberCount: null });
});

test('formatSubscriberCount renders compact labels', () => {
  assert.equal(formatSubscriberCount(340), '340');
  assert.equal(formatSubscriberCount(12400), '12.4k');
  assert.equal(formatSubscriberCount(12000), '12k');
  assert.equal(formatSubscriberCount(1_500_000), '1.5m');
});
