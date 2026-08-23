const CREATOR_SUBSCRIBER_THRESHOLD = 1000;

/**
 * E4: one cached `channels.list` call per asker; if their channel has
 * uploads and at least 1,000 subscribers, the ledger row gets a small
 * "creator · 12k" label. No outreach, no matching — just a label.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {{personId: number, askerChannelId: string}} args
 * @returns {Promise<{isCreator: boolean, subscriberCount: number | null}>}
 */
export async function checkCreatorFlag(db, yt, { personId, askerChannelId }) {
  const cached = db
    .prepare(`SELECT is_creator, creator_subscriber_count, creator_checked_at FROM people WHERE id = ?`)
    .get(personId);
  if (cached?.creator_checked_at) {
    return { isCreator: Boolean(cached.is_creator), subscriberCount: cached.creator_subscriber_count };
  }

  const res = await yt.channels.list({ part: ['statistics', 'contentDetails'], id: [askerChannelId] });
  const item = res.data.items?.[0];
  const hasUploads = Boolean(item?.contentDetails?.relatedPlaylists?.uploads);
  const subscriberCount = Number(item?.statistics?.subscriberCount ?? 0);
  const isCreator = hasUploads && subscriberCount >= CREATOR_SUBSCRIBER_THRESHOLD;

  db.prepare(
    `UPDATE people SET is_creator = @isCreator, creator_subscriber_count = @subscriberCount, creator_checked_at = @now WHERE id = @personId`
  ).run({
    isCreator: isCreator ? 1 : 0,
    subscriberCount: isCreator ? subscriberCount : null,
    now: new Date().toISOString(),
    personId,
  });

  return { isCreator, subscriberCount: isCreator ? subscriberCount : null };
}

/** "12k" / "340" style compact label for the ledger row. */
export function formatSubscriberCount(count) {
  if (count == null) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}m`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count % 1_000 === 0 ? 0 : 1)}k`;
  return String(count);
}

export { CREATOR_SUBSCRIBER_THRESHOLD };
