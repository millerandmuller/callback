/**
 * F2 (ledger of people), E1 (open-asks view), E3 (never-twice guard).
 * Pure SQLite logic — no external API calls — so this is fully unit-testable
 * without any live credentials.
 */

const classifyCommentStmt = (db) =>
  db.prepare(
    `UPDATE comments SET is_ask = @isAsk, is_abusive = @isAbusive WHERE id = @commentId AND namespace = @namespace`
  );

const upsertPersonStmt = (db) =>
  db.prepare(
    `INSERT INTO people (asker_channel_id, namespace, display_name) VALUES (@askerChannelId, @namespace, @displayName)
     ON CONFLICT(asker_channel_id, namespace) DO UPDATE SET display_name = excluded.display_name`
  );

const getPersonStmt = (db) =>
  db.prepare(`SELECT * FROM people WHERE asker_channel_id = ? AND namespace = ?`);

const getAskStmt = (db) =>
  db.prepare(`SELECT * FROM asks WHERE person_id = ? AND topic = ? AND namespace = ?`);

const insertAskStmt = (db) =>
  db.prepare(
    `INSERT INTO asks (person_id, namespace, topic, status, first_asked_at, last_asked_at)
     VALUES (@personId, @namespace, @topic, 'open', @askedAt, @askedAt)`
  );

const bumpAskStmt = (db) =>
  db.prepare(
    `UPDATE asks SET last_asked_at = @askedAt WHERE id = @askId AND last_asked_at < @askedAt`
  );

const insertAskEventStmt = (db) =>
  db.prepare(
    `INSERT INTO ask_events (ask_id, comment_id, video_id, namespace, quote, occurred_at)
     VALUES (@askId, @commentId, @videoId, @namespace, @quote, @occurredAt)`
  );

/**
 * Merges one video's worth of Mind extraction results (Section 15 shape) into
 * the ledger. Idempotent per commentId: re-running the same extraction over
 * the same comments updates classifications but only ever adds one ask_event
 * per (commentId), because harvest() already guarantees each commentId is
 * processed once (T-01's idempotency carries through here by construction —
 * callers should only pass newly-harvested comments). An item marked
 * isAsk=true with no usable askerChannelId/topic is counted as `malformed`
 * and skipped, never thrown -- one bad item from the Mind must not roll back
 * every other, correctly-classified item in the same batch.
 * @param {import('better-sqlite3').Database} db
 * @param {{namespace: string, videoId: string, items: Array<{commentId: string, askerChannelId: string, askerName: string, isAsk: boolean, isAbusive: boolean, topic?: string, quote?: string, publishedAt: string}>}} args
 * @returns {{asksCreated: number, asksBumped: number, filtered: number, malformed: number}}
 */
export function mergeExtractionResults(db, { namespace, videoId, items }) {
  const classifyComment = classifyCommentStmt(db);
  const upsertPerson = upsertPersonStmt(db);
  const getPerson = getPersonStmt(db);
  const getAsk = getAskStmt(db);
  const insertAsk = insertAskStmt(db);
  const bumpAsk = bumpAskStmt(db);
  const insertAskEvent = insertAskEventStmt(db);

  let asksCreated = 0;
  let asksBumped = 0;
  let filtered = 0;
  let malformed = 0;

  const run = db.transaction((rows) => {
    for (const item of rows) {
      classifyComment.run({
        commentId: item.commentId,
        namespace,
        isAsk: item.isAsk ? 1 : 0,
        isAbusive: item.isAbusive ? 1 : 0,
      });

      if (!item.isAsk || item.isAbusive) {
        filtered += 1;
        continue;
      }

      // The Mind's extraction reply is untrusted input: askerChannelId,
      // topic, and askerName all feed NOT NULL columns (people.asker_channel_id,
      // asks.topic, people.display_name). A presence-only check isn't enough --
      // a wrong-typed value (topic as a number/object) still throws inside the
      // transaction below and rolls back every other, correctly-classified
      // item in the same batch (re-review found this gap in the first pass
      // of this fix, which only checked for missing fields, not wrong types).
      const isUsableString = (value) => typeof value === 'string' && value.trim().length > 0;
      if (!isUsableString(item.askerChannelId) || !isUsableString(item.topic) || !isUsableString(item.askerName)) {
        malformed += 1;
        continue;
      }

      upsertPerson.run({
        askerChannelId: item.askerChannelId,
        namespace,
        displayName: item.askerName,
      });
      const person = getPerson.get(item.askerChannelId, namespace);

      const existing = getAsk.get(person.id, item.topic, namespace);
      if (existing) {
        bumpAsk.run({ askId: existing.id, askedAt: item.publishedAt });
        if (item.publishedAt > existing.last_asked_at) asksBumped += 1;
        insertAskEvent.run({
          askId: existing.id,
          commentId: item.commentId,
          videoId,
          namespace,
          quote: item.quote ?? '',
          occurredAt: item.publishedAt,
        });
      } else {
        insertAsk.run({
          personId: person.id,
          namespace,
          topic: item.topic,
          askedAt: item.publishedAt,
        });
        const created = getAsk.get(person.id, item.topic, namespace);
        insertAskEvent.run({
          askId: created.id,
          commentId: item.commentId,
          videoId,
          namespace,
          quote: item.quote ?? '',
          occurredAt: item.publishedAt,
        });
        asksCreated += 1;
      }
    }
  });
  run(items);

  return { asksCreated, asksBumped, filtered, malformed };
}

/**
 * E1: open-asks view. Grouped by topic, sorted by (count of people, then
 * oldest first_asked_at) as the brief specifies ("sorted by count and age").
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 */
export function getOpenAsks(db, namespace) {
  const asks = db
    .prepare(
      `SELECT a.id as askId, a.topic, a.first_asked_at, a.last_asked_at,
              p.id as personId, p.display_name as askerName, p.asker_channel_id as askerChannelId,
              p.is_creator as isCreator, p.creator_subscriber_count as creatorSubscriberCount
       FROM asks a JOIN people p ON p.id = a.person_id
       WHERE a.namespace = ? AND a.status = 'open'
       ORDER BY a.first_asked_at ASC`
    )
    .all(namespace);

  const eventsByAsk = db
    .prepare(
      `SELECT ask_id as askId, comment_id as commentId, video_id as videoId, quote, occurred_at as occurredAt
       FROM ask_events WHERE namespace = ? ORDER BY occurred_at ASC`
    )
    .all(namespace)
    .reduce((acc, row) => {
      (acc[row.askId] ??= []).push(row);
      return acc;
    }, {});

  const withEvents = asks.map((a) => ({ ...a, events: eventsByAsk[a.askId] ?? [] }));

  const countByTopic = withEvents.reduce((acc, a) => {
    acc[a.topic] = (acc[a.topic] ?? 0) + 1;
    return acc;
  }, {});

  return withEvents.sort((a, b) => {
    const countDiff = countByTopic[b.topic] - countByTopic[a.topic];
    if (countDiff !== 0) return countDiff;
    return a.first_asked_at < b.first_asked_at ? -1 : 1;
  });
}

/**
 * "Answered (23)" section.
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 */
export function getAnsweredAsks(db, namespace) {
  return db
    .prepare(
      `SELECT a.id as askId, a.topic, a.replied_at as repliedAt, a.reply_url as replyUrl,
              p.display_name as askerName, p.asker_channel_id as askerChannelId
       FROM asks a JOIN people p ON p.id = a.person_id
       WHERE a.namespace = ? AND a.status = 'answered'
       ORDER BY a.replied_at DESC`
    )
    .all(namespace);
}

/**
 * F6 close step: marks an ask answered with the posted reply's proof fields.
 * This is also the enforcement point of E3 (never-twice): once status is
 * 'answered', getOpenAsksForMatching (matching/matchAndDraft.js) excludes it,
 * so no future batch will draft a second reply for this (person, topic).
 * @param {import('better-sqlite3').Database} db
 * @param {{askId: number, replyId: string, replyUrl: string, repliedAt: string}} args
 */
export function markAskAnswered(db, { askId, replyId, replyUrl, repliedAt }) {
  db.prepare(
    `UPDATE asks SET status = 'answered', reply_id = @replyId, reply_url = @replyUrl, replied_at = @repliedAt WHERE id = @askId`
  ).run({ askId, replyId, replyUrl, repliedAt });
}
