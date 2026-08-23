import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { recordUsage, getUsedToday, getRemainingToday, canAfford } from '../src/youtube/quota.js';

test('quota accumulates within a day and reports remaining correctly', () => {
  const db = openDb(':memory:');
  assert.equal(getUsedToday(db), 0);
  recordUsage(db, 1);
  recordUsage(db, 50);
  assert.equal(getUsedToday(db), 51);
  assert.equal(getRemainingToday(db), 10_000 - 51);
  assert.equal(canAfford(db, 10_000 - 51), true);
  assert.equal(canAfford(db, 10_000 - 50), false);
});
