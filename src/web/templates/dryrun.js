import { layout, esc } from './layout.js';
import { openAskRow } from './ledger.js';

/**
 * E5: paste a public channel handle, see real open asks, read-only.
 * @param {{result?: {ok: boolean, reason?: string, channelTitle?: string, openAsks?: Array}, handle?: string}} args
 */
export function renderDryRunPage({ result, handle } = {}) {
  const form = `<form method="post" action="/dryrun">
    <input type="text" name="handle" placeholder="channel handle, e.g. somehowtocreator" value="${esc(handle ?? '')}">
    <button type="submit">Run dry run</button>
  </form>`;

  let resultBlock = '';
  if (result?.ok) {
    resultBlock = `
      <h2>${esc(result.channelTitle)}</h2>
      <p class="subtitle">Open asks (${result.openAsks.length})</p>
      ${result.openAsks.length === 0 ? '<p class="empty">No open asks found.</p>' : result.openAsks.map(openAskRow).join('')}
    `;
  } else if (result && !result.ok) {
    resultBlock = `<p class="empty">${esc(result.reason)}</p>`;
  }

  const body = `
    <h1>Dry run</h1>
    <p class="readonly-note">Read-only. Callback never posts on a channel you don't own.</p>
    ${form}
    ${resultBlock}
  `;
  return layout({ title: 'Dry run', body });
}
