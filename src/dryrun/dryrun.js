import { ensureNamespace } from '../db/index.js';
import { resolveChannel } from '../youtube/client.js';
import { harvest } from '../harvest/harvest.js';
import { mergeExtractionResults, getOpenAsks } from '../ledger/ledger.js';

/**
 * E5: read-only harvest + ledger for a public channel the team does not own,
 * into a namespace whose `kind` is 'dryrun' — postApprovedBatch (F6) refuses
 * to post into any namespace that isn't 'own', so this mode has no posting
 * path even if a caller mistakenly tried to invoke one.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytRead
 * @param {import('../mind/client.js').MindClient} mind
 * @param {{handleOrChannelId: string, videoCount?: number}} args
 */
export async function runDryRun(db, ytRead, mind, { handleOrChannelId, videoCount = 5 }) {
  const channel = await resolveChannel(ytRead, handleOrChannelId);
  if (!channel) return { ok: false, reason: `channel not found: ${handleOrChannelId}` };

  const namespace = channel.channelId;
  ensureNamespace(db, { name: namespace, kind: 'dryrun', channelId: channel.channelId });

  const harvestResult = await harvest(db, ytRead, { namespace, channelId: channel.channelId, videoCount });

  const newComments = db
    .prepare(
      `SELECT id as commentId, video_id as videoId, author_channel_id as authorChannelId, author_display_name as authorDisplayName, text, published_at as publishedAt
       FROM comments WHERE namespace = ? AND is_ask IS NULL`
    )
    .all(namespace);

  if (newComments.length > 0) {
    const byVideo = Object.groupBy(newComments, (c) => c.videoId);
    for (const [videoId, comments] of Object.entries(byVideo)) {
      const video = db.prepare(`SELECT title FROM videos WHERE id = ? AND namespace = ?`).get(videoId, namespace);
      const { buildExtractionPrompt } = await import('../prompts/extraction.js');
      const { askMindForJson } = await import('../mind/parse.js');
      const prompt = buildExtractionPrompt({
        creatorName: channel.title,
        videoTitle: video?.title ?? videoId,
        videoId,
        comments,
      });
      const result = await askMindForJson(mind, prompt);
      if (result.ok && Array.isArray(result.data)) {
        mergeExtractionResults(db, { namespace, videoId, items: result.data });
      }
    }
  }

  return {
    ok: true,
    namespace,
    channelTitle: channel.title,
    videosSeen: harvestResult.videosSeen,
    openAsks: getOpenAsks(db, namespace),
  };
}
