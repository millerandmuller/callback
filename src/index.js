import { serve } from '@hono/node-server';
import { config } from './config.js';
import { openDb, ensureNamespace } from './db/index.js';
import { createReadClient, createWriteClient } from './youtube/client.js';
import * as ytModule from './youtube/client.js';
import { createMindClient } from './mind/client.js';
import { createApp } from './web/server.js';
import { startSchedulers } from './scheduler/cron.js';

const NAMESPACE = 'own';

// Hono's own error boundary only covers request handlers; a rejection from
// the cron jobs (which run outside any request) or any other stray async
// error would otherwise crash the process with no trace of why -- exactly
// the kind of silent, undiagnosable death flagged during
// this round's review. Log loudly and exit non-zero so a crash during
// rehearsal or recording leaves a reason behind instead of just vanishing.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException', err);
  process.exitCode = 1;
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection', reason);
  process.exitCode = 1;
});

function tryCreate(label, factory) {
  try {
    return factory();
  } catch (err) {
    console.warn(`[startup] ${label} unavailable: ${err.message}`);
    return undefined;
  }
}

async function main() {
  const db = openDb();

  let ytRead;
  let ytWrite;
  let mind;

  if (config.youtube.testChannelId) {
    ensureNamespace(db, { name: NAMESPACE, kind: 'own', channelId: config.youtube.testChannelId });
    ytRead = tryCreate('YouTube read client', createReadClient);
    ytWrite = tryCreate('YouTube write client', createWriteClient);
  } else {
    console.warn('[startup] YOUTUBE_TEST_CHANNEL_ID is not set — pages will render from whatever is already in the local DB, harvest/publish-detect cannot run.');
  }

  mind = tryCreate('Mind client', createMindClient);
  if (mind) {
    try {
      await mind.ready();
    } catch (err) {
      console.warn(`[startup] Mind client created but ensureConversation failed: ${err.message}`);
      mind = undefined;
    }
  }

  const app = createApp({ db, namespace: NAMESPACE, ytRead, ytWrite, mind });

  serve({ fetch: app.fetch, port: config.server.port }, (info) => {
    console.log(`Callback listening on http://localhost:${info.port}`);
  });

  if (ytRead && ytWrite && mind) {
    startSchedulers(db, ytRead, ytWrite, mind, ytModule);
    console.log(`Schedulers running: harvest every ${config.schedule.harvestIntervalMin}m, upload poll every ${config.schedule.uploadPollIntervalMin}m, posting poll every ${config.schedule.postingPollIntervalSec}s.`);
  } else {
    console.warn('[startup] M0 not complete — schedulers not started. See SETUP.md.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
