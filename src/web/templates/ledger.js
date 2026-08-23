import { layout, esc } from './layout.js';
import { formatSubscriberCount } from '../../creatorFlag/creatorFlag.js';

/** "Sun Aug 23" style, no year (Section 5 examples never show one). */
function shortDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function sameDay(a, b) {
  return a?.slice(0, 10) === b?.slice(0, 10);
}

export function openAskRow(ask) {
  const dates = `asked ${shortDate(ask.first_asked_at)}${sameDay(ask.first_asked_at, ask.last_asked_at) ? '' : ` · again ${shortDate(ask.last_asked_at)}`}`;
  const creatorLabel = ask.isCreator
    ? `<span class="creator-label">creator · ${formatSubscriberCount(ask.creatorSubscriberCount)}</span>`
    : '';
  const originalCommentUrl = ask.events?.at(-1)?.commentId
    ? `https://www.youtube.com/watch?v=${esc(ask.events.at(-1).videoId)}&lc=${esc(ask.events.at(-1).commentId)}`
    : null;
  return `<div class="row">
    <div class="row-name">${esc(ask.askerName)}${creatorLabel}</div>
    <div class="row-dates">${dates}</div>
    <div class="row-quote">"${esc(ask.events?.at(-1)?.quote ?? '')}"</div>
    ${originalCommentUrl ? `<a href="${originalCommentUrl}" target="_blank" rel="noopener">original comment</a>` : ''}
  </div>`;
}

function answeredRow(ask) {
  return `<div class="row">
    <div class="row-name">${esc(ask.askerName)}</div>
    <div class="row-dates">answered ${shortDate(ask.repliedAt)}</div>
    <div class="row-quote">${ask.topic ? esc(ask.topic) : ''}</div>
    ${ask.replyUrl ? `<a href="${esc(ask.replyUrl)}" target="_blank" rel="noopener">reply</a>` : ''}
  </div>`;
}

/**
 * E1 / F2: the ledger page. Default view is open asks; answered asks are a
 * secondary section below (never the default filter).
 * @param {{openAsks: Array, answeredAsks: Array, namespace: string}} args
 */
export function renderLedgerPage({ openAsks, answeredAsks, namespace }) {
  const body = `
    <h1>Open asks (${openAsks.length})</h1>
    <p class="subtitle">${esc(namespace)}</p>
    ${openAsks.length === 0 ? '<p class="empty">No open asks. Your comment section is caught up.</p>' : openAsks.map(openAskRow).join('')}
    <h2 class="section-heading">Answered (${answeredAsks.length})</h2>
    ${answeredAsks.length === 0 ? '<p class="empty">Nothing answered yet.</p>' : answeredAsks.map(answeredRow).join('')}
  `;
  return layout({ title: `Open asks (${openAsks.length})`, body });
}
