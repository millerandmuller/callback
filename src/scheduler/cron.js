import cron from 'node-cron';
import { config } from '../config.js';
import { harvest } from '../harvest/harvest.js';
import { mergeExtractionResults, getOpenAsks } from '../ledger/ledger.js';
import { matchAndDraft } from '../matching/match.js';
import { buildExtractionPrompt } from '../prompts/extraction.js';
import { askMindForJson } from '../mind/parse.js';
import { postApprovedBatch } from '../posting/posting.js';

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
        channelTitle: config.creator.channelTitle,
        isOwnChannel: true,
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
 * matchAndDraft against every currently open ask. `ytWrite` (the
 * OAuth-authenticated client, not the API-key read client) is required here
 * so an unlisted upload is detected while it is still unlisted — the
 * public uploads playlist an API key can see never lists unlisted videos at
 * all (unlisted-first flow, decided 2026-08-22: drafting starts during the
 * 4-5 minutes the video sits unlisted, so the reply is ready the moment the
 * creator flips it public).
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 * @param {import('../mind/client.js').MindClient} mind
 */
async function runUploadPollCycle(db, ytWrite, mind, { listRecentVideos, getVideoMeta }) {
  const [latest] = await listRecentVideos(ytWrite, config.youtube.testChannelId, 1);
  if (!latest) return { newVideo: false };

  const known = db.prepare(`SELECT 1 FROM videos WHERE id = ? AND namespace = 'own'`).get(latest.videoId);
  if (known) return { newVideo: false };

  const meta = await getVideoMeta(ytWrite, latest.videoId);
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

// Batch ids currently mid-flight inside a postApprovedBatch call from this
// poller. A multi-reply batch takes throttleMs (20s default) per reply to
// post, longer than one 30s poll tick -- without this guard, the batch's
// own `status` column doesn't leave 'approved' until every reply is done
// (posting.js), so the next tick would re-select the SAME batch and start a
// second, genuinely concurrent postApprovedBatch call. The existing atomic
// per-reply claim still prevents any double-post, but the two overlapping
// calls' independent throttle sleeps collapse the pacing between different
// replies to well under 20s (adversarial find, Round 3) -- a real violation
// of F6's "one reply per 20s" on the account used for the live demo. Module-
// level and in-memory by design: it only needs to hold for this process's
// lifetime, and a restart naturally clears it (a stuck-mid-post batch is
// simply picked up fresh on the next tick after restart).
const batchesInFlight = new Set();

/**
 * F6: every POSTING_POLL_INTERVAL_SEC seconds, attempts to post every batch
 * that has been approved but not yet fully posted. postApprovedBatch itself
 * refuses to call comments.insert until the answering video's privacyStatus
 * is 'public' (checked fresh on every call — see src/posting/posting.js), so
 * this poller is what makes the brief's "re-check every 30 s" happen: it is
 * decoupled from whether anyone has the approval page open, and posts within
 * one poll interval of the creator flipping the video public in YouTube
 * Studio. Skips any batch a prior tick is still mid-way through posting (see
 * batchesInFlight above) so overlapping ticks never violate the per-reply
 * throttle.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 */
async function runPostingPollCycle(db, ytWrite) {
  const approvedBatches = db
    .prepare(
      `SELECT b.id FROM batches b JOIN namespaces n ON n.name = b.namespace
       WHERE n.kind = 'own' AND b.status = 'approved'`
    )
    .all();

  const results = [];
  for (const { id } of approvedBatches) {
    if (batchesInFlight.has(id)) continue;
    batchesInFlight.add(id);
    try {
      results.push({ batchId: id, ...(await postApprovedBatch(db, ytWrite, id)) });
    } catch (err) {
      console.error(`[posting-poll] batch ${id}:`, err);
    } finally {
      batchesInFlight.delete(id);
    }
  }
  return results;
}

/**
 * Starts all three cron jobs. Returns the ScheduledTask handles so a caller
 * (or a test) can stop them. Harvest (F1) reads with the API-key client;
 * the upload poll (F4) and posting poll (F6) both need the OAuth write
 * client — F4 to see unlisted uploads, F6 to call comments.insert.
 * @param {import('better-sqlite3').Database} db
 * @param {import('googleapis').youtube_v3.Youtube} ytRead
 * @param {import('googleapis').youtube_v3.Youtube} ytWrite
 * @param {import('../mind/client.js').MindClient} mind
 * @param {typeof import('../youtube/client.js')} ytModule injected so cron.js has no hard import cycle with youtube/client.js at module scope beyond what's needed
 */
export function startSchedulers(db, ytRead, ytWrite, mind, ytModule) {
  const harvestTask = cron.schedule(`*/${config.schedule.harvestIntervalMin} * * * *`, () => {
    runHarvestCycle(db, ytRead, mind).catch((err) => console.error('[harvest]', err));
  });

  const uploadPollTask = cron.schedule(`*/${config.schedule.uploadPollIntervalMin} * * * *`, () => {
    runUploadPollCycle(db, ytWrite, mind, ytModule).catch((err) => console.error('[upload-poll]', err));
  });

  const postingPollTask = cron.schedule(`*/${config.schedule.postingPollIntervalSec} * * * * *`, () => {
    runPostingPollCycle(db, ytWrite).catch((err) => console.error('[posting-poll]', err));
  });

  return { harvestTask, uploadPollTask, postingPollTask };
}

export { runHarvestCycle, runUploadPollCycle, runPostingPollCycle };
