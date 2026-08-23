import { config } from '../config.js';

/** Today's date in America/Los_Angeles, since YouTube's quota resets at Pacific midnight. */
export function pacificDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA gives YYYY-MM-DD directly
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {number} units already spent today
 */
export function getUsedToday(db) {
  const row = db
    .prepare('SELECT units_used FROM quota_ledger WHERE day = ?')
    .get(pacificDayKey());
  return row?.units_used ?? 0;
}

/** @returns {number} units remaining today before the Pacific-midnight reset */
export function getRemainingToday(db) {
  return config.youtube.quotaDailyUnits - getUsedToday(db);
}

/**
 * Records units spent today. Call after every read (1 unit, D-09) and every
 * reply insert (50 units, D-09).
 * @param {import('better-sqlite3').Database} db
 * @param {number} units
 */
export function recordUsage(db, units) {
  const day = pacificDayKey();
  db.prepare(
    `INSERT INTO quota_ledger (day, units_used) VALUES (@day, @units)
     ON CONFLICT(day) DO UPDATE SET units_used = units_used + @units`
  ).run({ day, units });
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} units
 * @returns {boolean} whether spending `units` now would stay within today's budget
 */
export function canAfford(db, units) {
  return getRemainingToday(db) >= units;
}
