import { google } from 'googleapis';
import { config, requireEnv } from '../config.js';

/**
 * Read-only YouTube Data API client (API key auth). Used for harvest (F1),
 * publish detection (F4), and the creator flag (E4).
 * @returns {import('googleapis').youtube_v3.Youtube}
 */
export function createReadClient() {
  requireEnv('youtubeRead');
  return google.youtube({ version: 'v3', auth: config.youtube.apiKey });
}

/**
 * OAuth-authenticated YouTube Data API client (the test channel's refresh
 * token). Used only for comments.insert (F6) — never for reads, so a read
 * quota unit is never spent on the write credential by mistake.
 * @returns {import('googleapis').youtube_v3.Youtube}
 */
export function createWriteClient() {
  requireEnv('youtubeWrite');
  const oauth2 = new google.auth.OAuth2(
    config.youtube.oauthClientId,
    config.youtube.oauthClientSecret
  );
  oauth2.setCredentials({ refresh_token: config.youtube.oauthRefreshToken });
  return google.youtube({ version: 'v3', auth: oauth2 });
}

/**
 * Resolves a channel id from a handle (E5 dry-run input) or returns the id
 * unchanged if it already looks like one (starts with 'UC').
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {string} handleOrId
 * @returns {Promise<{channelId: string, title: string, subscriberCount: number} | null>}
 */
export async function resolveChannel(yt, handleOrId) {
  const forHandle = handleOrId.startsWith('@') ? handleOrId : `@${handleOrId}`;
  const params = handleOrId.startsWith('UC')
    ? { part: ['snippet', 'statistics'], id: [handleOrId] }
    : { part: ['snippet', 'statistics'], forHandle };
  const res = await yt.channels.list(params);
  const item = res.data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? '',
    subscriberCount: Number(item.statistics?.subscriberCount ?? 0),
  };
}

/**
 * The channel's uploads playlist id, used to page through recent videos.
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {string} channelId
 */
async function getUploadsPlaylistId(yt, channelId) {
  const res = await yt.channels.list({ part: ['contentDetails'], id: [channelId] });
  const uploads = res.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`No uploads playlist found for channel ${channelId}`);
  return uploads;
}

/**
 * The last N videos published on a channel, newest first.
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {string} channelId
 * @param {number} n
 * @returns {Promise<Array<{videoId: string, title: string, publishedAt: string}>>}
 */
export async function listRecentVideos(yt, channelId, n = 10) {
  const uploadsPlaylistId = await getUploadsPlaylistId(yt, channelId);
  const res = await yt.playlistItems.list({
    part: ['snippet', 'contentDetails'],
    playlistId: uploadsPlaylistId,
    maxResults: Math.min(n, 50),
  });
  return (res.data.items ?? []).map((item) => ({
    videoId: item.contentDetails?.videoId ?? '',
    title: item.snippet?.title ?? '',
    publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? '',
  }));
}

/**
 * Full video metadata: description (for F4 matching) and whether captions
 * exist (E7 — the pointer is only ever set when this is true).
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {string} videoId
 */
export async function getVideoMeta(yt, videoId) {
  const res = await yt.videos.list({ part: ['snippet', 'contentDetails'], id: [videoId] });
  const item = res.data.items?.[0];
  if (!item) return null;
  return {
    videoId,
    title: item.snippet?.title ?? '',
    description: item.snippet?.description ?? '',
    publishedAt: item.snippet?.publishedAt ?? '',
    captionsAvailable: item.contentDetails?.caption === 'true',
  };
}

/**
 * Top-level comment threads for a video, newest first. Videos with comments
 * disabled respond with a 403 (commentsDisabled reason) — this is surfaced as
 * a visible "comments off" row (D-19), never thrown as an error to the caller.
 * Also flattens in the first few replies per thread (part=replies, no extra
 * quota cost) so E2 can pull the creator's own past replies as register
 * examples; each record is tagged isOwnerReply against `ownerChannelId`.
 * @param {import('googleapis').youtube_v3.Youtube} yt
 * @param {string} videoId
 * @param {{ownerChannelId?: string}} [opts]
 * @returns {Promise<{commentsEnabled: true, threads: Array<{commentId: string, authorChannelId: string, authorDisplayName: string, text: string, publishedAt: string, likeCount: number, isOwnerReply: boolean}>} | {commentsEnabled: false}>}
 */
export async function listCommentThreads(yt, videoId, opts = {}) {
  const threads = [];
  let pageToken;
  do {
    let res;
    try {
      res = await yt.commentThreads.list({
        part: ['snippet', 'replies'],
        videoId,
        order: 'time',
        maxResults: 100,
        pageToken,
      });
    } catch (err) {
      const reasons = err?.errors?.map((e) => e.reason) ?? [];
      if (err?.code === 403 && reasons.includes('commentsDisabled')) {
        return { commentsEnabled: false };
      }
      throw err;
    }
    for (const item of res.data.items ?? []) {
      const top = item.snippet?.topLevelComment?.snippet;
      if (top) {
        const authorChannelId = top.authorChannelId?.value ?? '';
        threads.push({
          commentId: item.snippet?.topLevelComment?.id ?? '',
          authorChannelId,
          authorDisplayName: top.authorDisplayName ?? '',
          text: top.textOriginal ?? '',
          publishedAt: top.publishedAt ?? '',
          likeCount: Number(top.likeCount ?? 0),
          isOwnerReply: Boolean(opts.ownerChannelId) && authorChannelId === opts.ownerChannelId,
        });
      }
      for (const reply of item.replies?.comments ?? []) {
        const authorChannelId = reply.snippet?.authorChannelId?.value ?? '';
        threads.push({
          commentId: reply.id ?? '',
          authorChannelId,
          authorDisplayName: reply.snippet?.authorDisplayName ?? '',
          text: reply.snippet?.textOriginal ?? '',
          publishedAt: reply.snippet?.publishedAt ?? '',
          likeCount: Number(reply.snippet?.likeCount ?? 0),
          isOwnerReply: Boolean(opts.ownerChannelId) && authorChannelId === opts.ownerChannelId,
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return { commentsEnabled: true, threads };
}

/**
 * Posts one reply under a comment (F6). OAuth-authenticated write client only.
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 * @param {string} parentId
 * @param {string} text
 * @returns {Promise<{replyId: string, publishedAt: string}>}
 */
export async function insertReply(ytWrite, parentId, text) {
  const res = await ytWrite.comments.insert({
    part: ['snippet'],
    requestBody: { snippet: { parentId, textOriginal: text } },
  });
  return { replyId: res.data.id ?? '', publishedAt: res.data.snippet?.publishedAt ?? '' };
}

export const QUOTA_COST = { READ: 1, INSERT: 50 };
