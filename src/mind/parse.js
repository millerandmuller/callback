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
