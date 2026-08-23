import { randomBytes } from 'node:crypto';
import { getOpenAsks } from '../ledger/ledger.js';
import { buildMatchAndDraftPrompt } from '../prompts/matchAndDraft.js';
import { askMindForJson } from '../mind/parse.js';

const REGISTER_EXAMPLE_LIMIT = 30;

/** Unguessable batch id (Section 14: "no auth on the local pages; the approval page id is unguessable"). */
function newBatchId() {
  return randomBytes(16).toString('hex');
}

/**
 * Up to 30 of the creator's own past replies, most recent first, as E2
 * register examples. Empty when the channel has no reply history yet
 * (edge case #10 — the Mind falls back to the plain register rules).
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 */
export function getRegisterExamples(db, namespace) {
  const rows = db
    .prepare(
      `SELECT text FROM comments WHERE namespace = ? AND is_owner_reply = 1 ORDER BY published_at DESC LIMIT ?`
    )
    .all(namespace, REGISTER_EXAMPLE_LIMIT);
  return rows.map((r) => r.text);
}

/**
 * F4: matches a newly published video against open asks and drafts one reply
 * per matched asker via the Mind, then persists a pending approval batch.
 * Only 'own'-namespace open asks are ever passed in by callers — dry-run
 * namespaces have no posting path and never reach this function.
 * @param {import('better-sqlite3').Database} db
 * @param {import('../mind/client.js').MindClient} mind
 * @param {{namespace: string, videoId: string, videoTitle: string, videoDescription: string, captionsText: string | null, creatorName: string}} args
 * @returns {Promise<{ok: true, batchId: string, matchedCount: number, remainingOpen: number} | {ok: false, reason: string}>}
 */
export async function matchAndDraft(db, mind, args) {
  const { namespace, videoId, videoTitle, videoDescription, captionsText, creatorName } = args;

  const openAsks = getOpenAsks(db, namespace).map((a) => ({
    askId: a.askId,
    askerChannelId: a.askerChannelId,
    askerName: a.askerName,
    topic: a.topic,
    quote: a.events.at(-1)?.quote ?? '',
  }));
  if (openAsks.length === 0) return { ok: false, reason: 'no open asks to match against' };

  const registerExamples = getRegisterExamples(db, namespace);

  const prompt = buildMatchAndDraftPrompt({
    creatorName,
    videoTitle,
    videoId,
    videoDescription,
    captionsText,
    openAsks,
    registerExamples,
  });

  const result = await askMindForJson(mind, prompt);
  if (!result.ok) return { ok: false, reason: 'could not parse' };

  const drafts = Array.isArray(result.data) ? result.data : [];
  const openAskIds = new Set(openAsks.map((a) => a.askId));
  const validDrafts = drafts.filter((d) => openAskIds.has(d.askId) && d.replyText?.trim());
  if (validDrafts.length === 0) return { ok: false, reason: 'no open asks answered by this video' };

  const batchId = newBatchId();
  const insertBatch = db.prepare(
    `INSERT INTO batches (id, namespace, video_id, status) VALUES (?, ?, ?, 'pending')`
  );
  const insertReply = db.prepare(
    `INSERT INTO batch_replies (batch_id, ask_id, reply_text, timestamp_pointer, status)
     VALUES (@batchId, @askId, @replyText, @timestampPointer, 'drafted')`
  );

  const run = db.transaction(() => {
    insertBatch.run(batchId, namespace, videoId);
    for (const d of validDrafts) {
      insertReply.run({
        batchId,
        askId: d.askId,
        replyText: d.replyText,
        timestampPointer: d.timestamp && d.timestamp !== 'null' ? d.timestamp : null,
      });
    }
  });
  run();

  return {
    ok: true,
    batchId,
    matchedCount: validDrafts.length,
    remainingOpen: openAsks.length - validDrafts.length,
  };
}
