import { layout, esc } from './layout.js';

function replyPair(reply, batchId) {
  const pointer = reply.timestampPointer ? ` <em>(${esc(reply.timestampPointer)})</em>` : '';
  // Form actions must be absolute: a relative action ("strike/1") resolves
  // against the page URL /approve/<batchId> to /approve/strike/1 — the
  // browser drops the batch id segment — and 404s. Found live at the first
  // real tap; the route tests POST absolute paths directly, so only a
  // browser ever exercises this resolution.
  const skipButton =
    reply.status === 'drafted'
      ? `<form class="inline" method="post" action="/approve/${batchId}/strike/${reply.replyId}"><button class="skip" type="submit">skip</button></form>`
      : `<span class="reply-status">${esc(reply.status)}</span>`;

  return `<div class="reply-pair">
    <div class="original-comment">${esc(reply.askerName)}: "${esc(reply.originalComment?.quote ?? '')}"</div>
    <div class="reply-text">${esc(reply.replyText)}${pointer}</div>
    ${skipButton}
    ${reply.error ? `<div class="reply-status">error: ${esc(reply.error)}</div>` : ''}
  </div>`;
}

/**
 * F5: shows every drafted reply exactly as it will appear, beside the
 * original comment. One tap approves the whole batch; per-row skip strikes
 * one reply first. Nothing posts before the tap (enforced in posting.js,
 * not just by omitting a button here).
 *
 * F6: once approved, the batch can still be waiting on the answering video
 * to go public (unlisted-first flow) — `waitingForPublic` shows that
 * plainly instead of leaving the creator staring at an unexplained
 * "approved" status, and a 30s meta-refresh keeps the page in sync with the
 * posting-poll cron's own 30s re-check.
 * @param {{batch: object, replies: Array, waitingForPublic?: boolean}} args
 */
export function renderApprovePage({ batch, replies, waitingForPublic = false }) {
  const draftedOrApproved = replies.filter((r) => r.status === 'drafted' || r.status === 'approved').length;
  const isPending = batch.status === 'pending';

  let statusLine;
  if (isPending) {
    statusLine = `<form method="post" action="/approve/${batch.id}/approve"><button type="submit">Call back ${draftedOrApproved} people</button></form>`;
  } else if (waitingForPublic) {
    statusLine = `<p class="reply-status">Waiting for the video to go public.</p>`;
  } else {
    statusLine = `<p class="reply-status">Batch status: ${esc(batch.status)}</p>`;
  }

  const body = `
    <h1 class="approval-header">Callback answers ${draftedOrApproved} open ask${draftedOrApproved === 1 ? '' : 's'}. Nothing posts until you tap.</h1>
    ${replies.map((r) => replyPair(r, batch.id)).join('')}
    ${statusLine}
  `;
  return layout({ title: 'Approve', body, head: waitingForPublic ? '<meta http-equiv="refresh" content="30">' : '' });
}
