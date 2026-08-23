import { listRecentVideos, getVideoMeta, listCommentThreads, QUOTA_COST } from '../youtube/client.js';
import { recordUsage } from '../youtube/quota.js';

const upsertVideoStmt = (db) =>
  db.prepare(
    `INSERT INTO videos (id, namespace, title, description, published_at, comments_enabled, captions_available, last_harvested_at)
     VALUES (@id, @namespace, @title, @description, @publishedAt, @commentsEnabled, @captionsAvailable, @now)
     ON CONFLICT(id, namespace) DO UPDATE SET
       title = excluded.title, description = excluded.description,
       comments_enabled = excluded.comments_enabled, captions_available = excluded.captions_available,
       last_harvested_at = excluded.last_harvested_at`
  );

const insertCommentStmt = (db) =>
  db.prepare(
    `INSERT OR IGNORE INTO comments
       (id, namespace, video_id, author_channel_id, author_display_name, text, published_at, like_count, is_owner_reply)
     VALUES (@id, @namespace, @videoId, @authorChannelId, @authorDisplayName, @text, @publishedAt, @likeCount, @isOwnerReply)`
  );

/**
 * F1: pulls comment threads for the last N videos of `channelId` into
 * `namespace`, idempotently (INSERT OR IGNORE on the comments primary key —
 * T-01: a re-run adds zero duplicates). Videos with comments disabled get a
 * visible row instead of an error (D-19).
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {{namespace: string, channelId: string, ownerChannelId?: string, videoCount?: number}} args
 * @returns {Promise<{videosSeen: number, commentsOffVideos: string[], newComments: number}>}
 */
export async function harvest(db, yt, { namespace, channelId, ownerChannelId, videoCount = 10 }) {
  const upsertVideo = upsertVideoStmt(db);
  const insertComment = insertCommentStmt(db);

  const videos = await listRecentVideos(yt, channelId, videoCount);
  recordUsage(db, QUOTA_COST.READ);

  const commentsOffVideos = [];
  let newComments = 0;
  const now = new Date().toISOString();

  for (const video of videos) {
    const meta = await getVideoMeta(yt, video.videoId);
    recordUsage(db, QUOTA_COST.READ);
    if (!meta) continue;

    const threadResult = await listCommentThreads(yt, video.videoId, { ownerChannelId });
    recordUsage(db, QUOTA_COST.READ);

    const commentsEnabled = threadResult.commentsEnabled;
    if (!commentsEnabled) commentsOffVideos.push(video.videoId);

    upsertVideo.run({
      id: video.videoId,
      namespace,
      title: meta.title,
      description: meta.description,
      publishedAt: meta.publishedAt,
      commentsEnabled: commentsEnabled ? 1 : 0,
      captionsAvailable: meta.captionsAvailable ? 1 : 0,
      now,
    });

    if (commentsEnabled) {
      for (const c of threadResult.threads) {
        const info = insertComment.run({
          id: c.commentId,
          namespace,
          videoId: video.videoId,
          authorChannelId: c.authorChannelId,
          authorDisplayName: c.authorDisplayName,
          text: c.text,
          publishedAt: c.publishedAt,
          likeCount: c.likeCount,
          isOwnerReply: c.isOwnerReply ? 1 : 0,
        });
        if (info.changes > 0) newComments += 1;
      }
    }
  }

  return { videosSeen: videos.length, commentsOffVideos, newComments };
}
