/**
 * F3 Sunday brief. One-time setup instruction so the Mind schedules its own
 * weekly brief; a separate trigger message lets the service (or the demo)
 * request it on demand. Both use the same three-line format so the acceptance
 * check ("matches the ledger numbers") is comparable either way.
 */

/**
 * Sent once, during F0/M2 setup, to install the Mind's own weekly schedule.
 * @param {{creatorName: string, timezone: string}} args
 */
export function buildSundayBriefSetupInstruction({ creatorName, timezone }) {
  return `From now on, every Sunday at 18:00 ${timezone} time, send ${creatorName} a three-line demand brief on your own, without being asked. Use exactly this shape:
Line 1: the top topic this week and how many people asked about it.
Line 2: of those, how many had asked before (any topic).
Line 3: how many open asks are older than two weeks, across all topics.
Base every number on the people and asks you currently remember. Send it as a normal message in our callback-main conversation.`;
}

/**
 * Sent on demand (service trigger, or the demo) to request the brief right now
 * instead of waiting for Sunday.
 */
export function buildSundayBriefTriggerMessage() {
  return 'Run the Sunday brief now: send the three-line demand brief for this week, based on everyone you currently remember.';
}
