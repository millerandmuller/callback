/**
 * Strips HTML tags and decodes common entities from Builder API messageText,
 * which wraps replies in simple HTML (confirmed live during M0: a plain "ok"
 * reply came back as messageText "<p>ok</p>"). <p>/<div> become paragraph
 * breaks, <br> becomes a newline, everything else is just removed -- this is
 * a targeted cleanup for locating a fenced JSON block and for human-readable
 * text, not a general HTML-to-text converter.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const INTERIM_ACK_PATTERN =
  /\bI(?:'|’)?ll\s+(?:notify|let you know|get back to you|update you|message you|reach out to you|ping you)\b|\b(?:still\s+)?(?:thinking|working on it|processing)\.{0,3}\s*$|\bgive me (?:a\s+)?(?:moment|minute|second)\b/i;

/**
 * True when a Mind reply looks like an interim acknowledgment ("I'll notify
 * you here when I've finished.") rather than the real answer, which
 * sometimes arrives as a separate, later message a minute or two afterward
 * (confirmed live during M0). Deliberately narrow (pattern plus a length
 * cap) so a genuine short final answer is never mistaken for one.
 * @param {string} text plain text, already HTML-stripped
 * @returns {boolean}
 */
export function isInterimAck(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return false;
  return INTERIM_ACK_PATTERN.test(trimmed);
}

/**
 * Extracts the first fenced code block from a Mind reply and parses it as JSON.
 * Accepts ```json ... ``` or plain ``` ... ``` fences (the Mind does not always
 * label the fence). Returns null on no fence or invalid JSON — callers decide
 * whether to re-ask or surface "could not parse" (see askMindForJson below).
 * @param {string} text
 * @returns {unknown | null}
 */
export function parseFencedJson(text) {
  if (!text) return null;
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/i);
  const candidate = match ? match[1] : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Sends a prompt to the Mind and returns parsed JSON from the fenced block in
 * its reply, re-asking once with a stricter instruction if parsing fails.
 * @param {import('./client.js').MindClient} mindClient
 * @param {string} prompt
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, data: unknown, raw: string} | {ok: false, raw: string | null}>}
 */
export async function askMindForJson(mindClient, prompt, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const first = await mindClient.ask(prompt, { timeoutMs });
  if (first.timedOut) return { ok: false, raw: null };
  const firstParsed = parseFencedJson(first.text);
  if (firstParsed !== null) return { ok: true, data: firstParsed, raw: first.text };

  const stricter = `${prompt}\n\nYour last reply did not contain a single valid fenced JSON block. Reply again with ONLY one fenced JSON block (\`\`\`json ... \`\`\`) and nothing else before or after it.`;
  const second = await mindClient.ask(stricter, { timeoutMs });
  if (second.timedOut) return { ok: false, raw: first.text };
  const secondParsed = parseFencedJson(second.text);
  if (secondParsed !== null) return { ok: true, data: secondParsed, raw: second.text };

  return { ok: false, raw: second.text };
}
