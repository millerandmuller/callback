/**
 * F3 Sunday brief. One-time setup instruction so the Mind schedules its own
 * weekly brief; a separate trigger message lets the service (or the demo)
 * request it on demand. Both use the same three-line format so the acceptance
 * check ("matches the ledger numbers") is comparable either way.
 *
 * Both prompts are scoped to the creator's own channel: the shared
 * `callback-main` conversation has seen other channels' comments (the Aug 23
 * test run), and unscoped memory questions leak those askers into the brief,
 * while scoped questions come back clean (found live 2026-08-25). The scope
 * sentence is load-bearing — do not remove it.
 */

/**
 * The channel-scope sentence shared by both prompts, so the wording (which the
 * live probe showed keeps answers clean) stays identical in each.
 * @param {{creatorName: string, channelTitle: string}} args
 */
function channelScopeSentence({ creatorName, channelTitle }) {
  return `Count only people who commented on ${creatorName}'s own YouTube channel "${channelTitle}"; ignore every asker you remember from any other channel or creator.`;
}

/**
 * Sent once, during F0/M2 setup, to install the Mind's own weekly schedule.
 * @param {{creatorName: string, channelTitle: string, timezone: string}} args
 */
export function buildSundayBriefSetupInstruction({ creatorName, channelTitle, timezone }) {
  return `From now on, every Sunday at 18:00 ${timezone} time, send ${creatorName} a three-line demand brief on your own, without being asked. Use exactly this shape:
Line 1: the top topic this week and how many people asked about it.
Line 2: of those, how many had asked before (any topic).
Line 3: how many open asks are older than two weeks, across all topics.
${channelScopeSentence({ creatorName, channelTitle })}
Base every number on the people and asks you currently remember. Send it as a normal message in our callback-main conversation.`;
}

/**
 * Sent on demand (service trigger, or the demo) to request the brief right now
 * instead of waiting for Sunday.
 * @param {{creatorName: string, channelTitle: string}} args
 */
export function buildSundayBriefTriggerMessage({ creatorName, channelTitle }) {
  return `Run the Sunday brief now: send the three-line demand brief for this week. ${channelScopeSentence({ creatorName, channelTitle })} Base it on everyone you currently remember from that channel.`;
}
