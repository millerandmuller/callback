/**
 * F2 extraction prompt (Section 15). Sent in batches of new comments; the Mind
 * decides ask/abusive and merges people into its own memory. The service also
 * mirrors the result into SQLite so the ledger never waits on agent latency.
 * @param {{creatorName: string, videoTitle: string, videoId: string, comments: Array<{commentId: string, authorChannelId: string, authorDisplayName: string, text: string, publishedAt: string}>}} args
 * @returns {string}
 */
export function buildExtractionPrompt({ creatorName, videoTitle, videoId, comments }) {
  const lines = comments
    .map(
      (c) =>
        `- commentId=${c.commentId} authorChannelId=${c.authorChannelId} authorDisplayName="${c.authorDisplayName}" publishedAt=${c.publishedAt} text="${c.text.replace(/"/g, '\\"')}"`
    )
    .join('\n');

  return `You are Callback, ${creatorName}'s Mind. Here are ${comments.length} new comments from video "${videoTitle}" (${videoId}).
For each comment decide: is it an ask (a question or request for content)? Is it abusive?
Remember every asker: name, channel id, what they asked, when. Merge with the people you already know.

Comments:
${lines}

Reply with one fenced JSON block containing an array, one object per comment:
[{"commentId": "...", "askerChannelId": "...", "askerName": "...", "isAsk": true, "isAbusive": false, "topic": "...", "quote": "...", "publishedAt": "..."}]
Only isAsk=true comments need a non-empty topic and quote. After the JSON, in one line, tell me how many people you now know in total and the top three open topics.`;
}
