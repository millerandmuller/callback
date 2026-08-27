/**
 * F2 extraction prompt (Section 15). Sent in batches of new comments; the Mind
 * decides ask/abusive and merges people into its own memory. The service also
 * mirrors the result into SQLite so the ledger never waits on agent latency.
 *
 * Channel attribution is load-bearing: the Mind holds one memory across the
 * shared `callback-main` conversation, and the Aug 23 dry-run test introduced
 * itself as the OTHER creator's Mind — after which the Mind filed every asker
 * (Mei's included) under that channel (DECISION_LOG 2026-08-25/27). So the
 * prompt always speaks as Mei's Mind, always names the channel the comments
 * are from, and says explicitly whether that channel is Mei's own.
 * @param {{creatorName: string, channelTitle: string, isOwnChannel: boolean, videoTitle: string, videoId: string, comments: Array<{commentId: string, authorChannelId: string, authorDisplayName: string, text: string, publishedAt: string}>}} args
 * @returns {string}
 */
export function buildExtractionPrompt({ creatorName, channelTitle, isOwnChannel, videoTitle, videoId, comments }) {
  const lines = comments
    .map(
      (c) =>
        `- commentId=${c.commentId} authorChannelId=${c.authorChannelId} authorDisplayName="${c.authorDisplayName}" publishedAt=${c.publishedAt} text="${c.text.replace(/"/g, '\\"')}"`
    )
    .join('\n');

  const intro = isOwnChannel
    ? `You are Callback, ${creatorName}'s Mind. Here are ${comments.length} new comments from video "${videoTitle}" (${videoId}) on ${creatorName}'s own YouTube channel "${channelTitle}".`
    : `You are Callback, ${creatorName}'s Mind, running a READ-ONLY dry run on the YouTube channel "${channelTitle}" — a channel that is NOT ${creatorName}'s. Here are ${comments.length} new comments from video "${videoTitle}" (${videoId}) on that channel.`;

  const memoryRule = isOwnChannel
    ? `Remember every asker as one of ${creatorName}'s own viewers on "${channelTitle}": name, channel id, what they asked, when. Merge with the people you already know from that channel.`
    : `Remember these askers as viewers of "${channelTitle}", kept strictly separate from ${creatorName}'s own viewers: name, channel id, what they asked, when.`;

  return `${intro}
For each comment decide: is it an ask (a question or request for content)? Is it abusive?
${memoryRule}

Comments:
${lines}

Reply with one fenced JSON block containing an array, one object per comment:
[{"commentId": "...", "askerChannelId": "...", "askerName": "...", "isAsk": true, "isAbusive": false, "topic": "...", "quote": "...", "publishedAt": "..."}]
Only isAsk=true comments need a non-empty topic and quote. After the JSON, in one line, tell me how many people you now know in total and the top three open topics.`;
}
