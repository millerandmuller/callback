import { layout, esc } from './layout.js';

function replyPair(reply) {
  const pointer = reply.timestampPointer ? ` <em>(${esc(reply.timestampPointer)})</em>` : '';
  const skipButton =
    reply.status === 'drafted'
      ? `<form class="inline" method="post" action="strike/${reply.replyId}"><button class="skip" type="submit">skip</button></form>`
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
 * @param {{batch: object, replies: Array}} args
 */
export function renderApprovePage({ batch, replies }) {
  const draftedOrApproved = replies.filter((r) => r.status === 'drafted' || r.status === 'approved').length;
  const isPending = batch.status === 'pending';

  const body = `
    <h1 class="approval-header">Callback answers ${draftedOrApproved} open ask${draftedOrApproved === 1 ? '' : 's'}. Nothing posts until you tap.</h1>
    ${replies.map(replyPair).join('')}
    ${
      isPending
        ? `<form method="post" action="approve"><button type="submit">Call back ${draftedOrApproved} people</button></form>`
        : `<p class="reply-status">Batch status: ${esc(batch.status)}</p>`
    }
  `;
  return layout({ title: 'Approve', body });
}
