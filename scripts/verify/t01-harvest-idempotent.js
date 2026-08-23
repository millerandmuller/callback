#!/usr/bin/env node
/**
 * T-01 (F1 acceptance): harvest the 'own' channel twice back to back; the
 * second run must add zero new comments (idempotent re-run). A live comment
 * arriving in the few seconds between the two calls would show up as one
 * "new" comment on the second run — acceptable noise for a manual check,
 * not a reason to loosen the assertion below.
 */
import { config } from '../../src/config.js';
import { openDb, ensureNamespace } from '../../src/db/index.js';
import { createReadClient } from '../../src/youtube/client.js';
import { harvest } from '../../src/harvest/harvest.js';

async function main() {
  const db = openDb();
  ensureNamespace(db, { name: 'own', kind: 'own', channelId: config.youtube.testChannelId });
  const yt = createReadClient();

  const first = await harvest(db, yt, { namespace: 'own', channelId: config.youtube.testChannelId, ownerChannelId: config.youtube.testChannelId });
  console.log(`First run:  ${first.videosSeen} videos, ${first.newComments} new comments, comments-off: [${first.commentsOffVideos.join(', ')}]`);

  const second = await harvest(db, yt, { namespace: 'own', channelId: config.youtube.testChannelId, ownerChannelId: config.youtube.testChannelId });
  console.log(`Second run: ${second.videosSeen} videos, ${second.newComments} new comments`);

  if (second.newComments === 0) {
    console.log('\nT-01 PASS: re-run added zero duplicates.');
  } else {
    console.log(`\nT-01 result unclear: second run added ${second.newComments} comment(s). If this matches real new activity between the two runs (check publishedAt), this is not a failure — re-run once more with no live traffic in between to confirm idempotency.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
