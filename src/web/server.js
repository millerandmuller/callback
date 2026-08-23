import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpenAsks, getAnsweredAsks } from '../ledger/ledger.js';
import { getBatchView, approveBatch, strikeReply } from '../approval/approval.js';
import { runDryRun } from '../dryrun/dryrun.js';
import { renderLedgerPage } from './templates/ledger.js';
import { renderApprovePage } from './templates/approve.js';
import { renderDryRunPage } from './templates/dryrun.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = readFileSync(join(__dirname, 'static/style.css'), 'utf8');

/**
 * Builds the Hono app. Every dependency is passed in (db, plus optional
 * ytRead/mind for the one route that needs live calls) so the ledger and
 * approval pages never touch the network — F7's "renders from the committed
 * snapshot with network disabled" acceptance check is just: don't start
 * ytRead/mind, still be able to GET /ledger.
 * @param {{db: import('better-sqlite3').Database, namespace: string, ytRead?: object, mind?: object}} deps
 */
export function createApp({ db, namespace, ytRead, mind }) {
  const app = new Hono();

  app.get('/style.css', (c) => c.body(STYLE_CSS, 200, { 'Content-Type': 'text/css' }));

  app.get('/ledger', (c) => {
    const openAsks = getOpenAsks(db, namespace);
    const answeredAsks = getAnsweredAsks(db, namespace);
    return c.html(renderLedgerPage({ openAsks, answeredAsks, namespace }));
  });

  app.get('/approve/:batchId', (c) => {
    const view = getBatchView(db, c.req.param('batchId'));
    if (!view) return c.text('Batch not found', 404);
    return c.html(renderApprovePage(view));
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
    const result = await runDryRun(db, ytRead, mind, { handleOrChannelId: handle });
    return c.html(renderDryRunPage({ handle, result }));
  });

  return app;
}
