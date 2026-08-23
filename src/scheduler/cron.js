import cron from 'node-cron';
import { config } from '../config.js';
import { harvest } from '../harvest/harvest.js';
import { mergeExtractionResults, getOpenAsks } from '../ledger/ledger.js';
import { matchAndDraft } from '../matching/match.js';
import { buildExtractionPrompt } from '../prompts/extraction.js';
import { askMindForJson } from '../mind/parse.js';

/**
 * F1: every HARVEST_INTERVAL_MIN minutes, pulls new comments for the 'own'
 * namespace and sends any newly-harvested comments to the Mind for
 * extraction (F2), merging the classified result into the ledger.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytRead
 * @param {import('../mind/client.js').MindClient} mind
 */
async function runHarvestCycle(db, ytRead, mind) {
  const result = await harvest(db, ytRead, {
    namespace: 'own',
    channelId: config.youtube.testChannelId,
    ownerChannelId: config.youtube.testChannelId,
  });

  const unclassified = db
    .prepare(
      `SELECT id as commentId, video_id as videoId, author_channel_id as authorChannelId, author_display_name as authorDisplayName, text, published_at as publishedAt
       FROM comments WHERE namespace = 'own' AND is_ask IS NULL AND is_owner_reply = 0`
    )
    .all();

  const byVideo = Object.groupBy(unclassified, (c) => c.videoId);
  for (const [videoId, comments] of Object.entries(byVideo)) {
    // One video's extraction failing (a Mind error, a malformed reply that
    // still slips past mergeExtractionResults' own validation, a transient
    // DB error) must not stop the rest of this harvest cycle's videos from
    // being classified -- each video is independent.
    try {
      const video = db.prepare(`SELECT title FROM videos WHERE id = ? AND namespace = 'own'`).get(videoId);
      const prompt = buildExtractionPrompt({
        creatorName: config.creator.displayName,
        videoTitle: video?.title ?? videoId,
        videoId,
        comments,
      });
      const extraction = await askMindForJson(mind, prompt);
      if (extraction.ok && Array.isArray(extraction.data)) {
        mergeExtractionResults(db, { namespace: 'own', videoId, items: extraction.data });
      }
    } catch (err) {
      console.error(`[harvest] extraction failed for video ${videoId}:`, err);
    }
  }

  return result;
}

/**
 * F4: every UPLOAD_POLL_INTERVAL_MIN minutes, checks for a new video on the
 * test channel and, if one has appeared since the last check, runs
 * matchAndDraft against every currently open ask.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytRead
 * @param {import('../mind/client.js').MindClient} mind
 */
async function runUploadPollCycle(db, ytRead, mind, { listRecentVideos, getVideoMeta }) {
  const [latest] = await listRecentVideos(ytRead, config.youtube.testChannelId, 1);
  if (!latest) return { newVideo: false };

  const known = db.prepare(`SELECT 1 FROM videos WHERE id = ? AND namespace = 'own'`).get(latest.videoId);
  if (known) return { newVideo: false };

  const meta = await getVideoMeta(ytRead, latest.videoId);
  if (getOpenAsks(db, 'own').length === 0) return { newVideo: true, matched: false, reason: 'no open asks' };

  const matched = await matchAndDraft(db, mind, {
    namespace: 'own',
    videoId: latest.videoId,
    videoTitle: meta?.title ?? latest.title,
    videoDescription: meta?.description ?? '',
    captionsText: null, // captions text fetch is a stretch beyond F0-F8's committed scope; see README "after-hackathon"
    creatorName: config.creator.displayName,
  });
  return { newVideo: true, matched: matched.ok, ...matched };
}

/**
 * Starts both cron jobs. Returns the two ScheduledTask handles so a caller
 * (or a test) can stop them.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytRead
 * @param {import('../mind/client.js').MindClient} mind
 * @param {typeof import('../youtube/client.js')} ytModule injected so cron.js has no hard import cycle with youtube/client.js at module scope beyond what's needed
 */
export function startSchedulers(db, ytRead, mind, ytModule) {
  const harvestTask = cron.schedule(`*/${config.schedule.harvestIntervalMin} * * * *`, () => {
    runHarvestCycle(db, ytRead, mind).catch((err) => console.error('[harvest]', err));
  });

  const uploadPollTask = cron.schedule(`*/${config.schedule.uploadPollIntervalMin} * * * *`, () => {
    runUploadPollCycle(db, ytRead, mind, ytModule).catch((err) => console.error('[upload-poll]', err));
  });

  return { harvestTask, uploadPollTask };
}

export { runHarvestCycle, runUploadPollCycle };
