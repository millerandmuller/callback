/**
 * F4 match-and-draft prompt (Section 15). Sent once per newly published video;
 * the Mind matches open asks and drafts one reply per asker in the creator's
 * register (E2), skipping anyone already answered on that topic (E3).
 * @param {{
 *   creatorName: string,
 *   videoTitle: string, videoId: string, videoDescription: string,
 *   captionsText: string | null,
 *   openAsks: Array<{askId: number, askerChannelId: string, askerName: string, topic: string, quote: string}>,
 *   registerExamples: string[],
 * }} args
 * @returns {string}
 */
export function buildMatchAndDraftPrompt({
  creatorName,
  videoTitle,
  videoId,
  videoDescription,
  captionsText,
  openAsks,
  registerExamples,
}) {
  const asksBlock = openAsks
    .map(
      (a) =>
        `- askId=${a.askId} askerChannelId=${a.askerChannelId} askerName="${a.askerName}" topic="${a.topic}" quote="${a.quote}"`
    )
    .join('\n');

  const registerBlock =
    registerExamples.length > 0
      ? registerExamples.map((r) => `- "${r.replace(/"/g, '\\"')}"`).join('\n')
      : '(no reply history yet — use the plain register rules below)';

  const captionsBlock = captionsText
    ? `Captions:\n${captionsText}`
    : 'No captions are available for this video. Do not name a timestamp; do not guess one.';

  return `New video published: "${videoTitle}" (${videoId}), description: "${videoDescription}".
${captionsBlock}

Open asks that might be answered by this video:
${asksBlock}

${creatorName}'s real past replies, as register examples (match this voice):
${registerBlock}

Which of the open asks above does this video answer? For each one, write one reply to that person
in ${creatorName}'s register: address them by name, quote or paraphrase their own question, say that
the new video answers it (name it naturally — "today's video", "the new video", or its title; never a
URL), then give the one-sentence answer or point to m:ss from the captions when available, then stop.
The reply must make clear a whole video now exists for them, not just answer inline — that is the
callback. No thanks-for-watching, no subscribe, no links, no hashtags, no emoji unless the register
examples use them. Every reply must differ from every other reply in this batch. Skip any ask this
video does not answer. Never draft a reply for an ask you have already called back on this topic.

Reply with one fenced JSON block:
[{"askId": 0, "askerChannelId": "...", "replyText": "...", "timestamp": "m:ss or null"}]
Then, on one line: how many asks this answers, and how many open asks remain after this video.`;
}
