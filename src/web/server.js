import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpenAsks, getAnsweredAsks } from '../ledger/ledger.js';
import { getBatchView, approveBatch, strikeReply } from '../approval/approval.js';
import { runDryRun } from '../dryrun/dryrun.js';
import { getVideoMeta } from '../youtube/client.js';
import { renderLedgerPage } from './templates/ledger.js';
import { renderApprovePage } from './templates/approve.js';
import { renderDryRunPage } from './templates/dryrun.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = readFileSync(join(__dirname, 'static/style.css'), 'utf8');

/**
 * Builds the Hono app. Every dependency is passed in (db, plus optional
 * ytRead/ytWrite/mind for the routes that need live calls) so the ledger and
 * approval pages never touch the network — F7's "renders from the committed
 * snapshot with network disabled" acceptance check is just: don't start
 * ytRead/ytWrite/mind, still be able to GET /ledger.
 * @param {{db: import('better-sqlite3').Database, namespace: string, ytRead?: object, ytWrite?: object, mind?: object}} deps
 */
export function createApp({ db, namespace, ytRead, ytWrite, mind }) {
  const app = new Hono();

  app.get('/style.css', (c) => c.body(STYLE_CSS, 200, { 'Content-Type': 'text/css' }));

  app.get('/ledger', (c) => {
    const openAsks = getOpenAsks(db, namespace);
    const answeredAsks = getAnsweredAsks(db, namespace);
    return c.html(renderLedgerPage({ openAsks, answeredAsks, namespace }));
  });

  app.get('/approve/:batchId', async (c) => {
    const view = getBatchView(db, c.req.param('batchId'));
    if (!view) return c.text('Batch not found', 404);

    // F6: once approved but not yet fully posted, this is a read-only check
    // (never posts — the posting-poll cron does that) so the page can tell
    // the creator honestly whether the video needs to go public first. The
    // actual re-check-and-post cadence is the cron's 30s interval; this page
    // shows the same 30s cadence via a meta-refresh so it stays in sync.
    let waitingForPublic = false;
    if (view.batch.status === 'approved' && ytWrite) {
      try {
        const meta = await getVideoMeta(ytWrite, view.batch.video_id);
        waitingForPublic = meta?.privacyStatus !== 'public';
      } catch (err) {
        console.error('[approve] privacy check failed', err);
        // Adversarial find, Round 3: leaving waitingForPublic false here made
        // a transient read failure render a static "Batch status: approved"
        // with no explanation and no refresh -- indistinguishable from
        // everything being fine. We genuinely don't know the video is public
        // when this check itself failed, so say so (true) rather than imply
        // settled state (misleading); the 30s refresh then retries on its own.
        waitingForPublic = true;
      }
    }

    return c.html(renderApprovePage({ ...view, waitingForPublic }));
  });

  app.post('/approve/:batchId/approve', (c) => {
    approveBatch(db, c.req.param('batchId'));
    return c.redirect(`/approve/${c.req.param('batchId')}`);
  });

  app.post('/approve/:batchId/strike/:replyId', (c) => {
    strikeReply(db, c.req.param('batchId'), Number(c.req.param('replyId')));
    return c.redirect(`/approve/${c.req.param('batchId')}`);
  });

  app.get('/dryrun', (c) => c.html(renderDryRunPage()));

  app.post('/dryrun', async (c) => {
    const body = await c.req.parseBody();
    const handle = String(body.handle ?? '').trim();
    if (!handle) return c.html(renderDryRunPage({ result: { ok: false, reason: 'Enter a channel handle.' } }));
    if (!ytRead || !mind) {
      return c.html(
        renderDryRunPage({
          handle,
          result: { ok: false, reason: 'OPEN (M0 not complete): YouTube and Minds credentials are not configured yet.' },
        })
      );
    }
    // E5 runs live, on stage, against an audience-suggested public channel --
    // its comments are real and un-rehearsed, so this route must never take
    // down the whole request on one unexpected error (adversarial find:
    // reachable via a single odd Mind classification before the ledger-level
    // fix above; this stays as defense in depth for anything else that could
    // throw here, e.g. a transient YouTube/Minds API error).
    try {
      const result = await runDryRun(db, ytRead, mind, { handleOrChannelId: handle });
      return c.html(renderDryRunPage({ handle, result }));
    } catch (err) {
      console.error('[dryrun]', err);
      return c.html(renderDryRunPage({ handle, result: { ok: false, reason: `Dry run failed: ${err.message}` } }));
    }
  });

  return app;
}
