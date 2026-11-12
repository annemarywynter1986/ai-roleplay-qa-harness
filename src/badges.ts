// Gamification rules (fixed logic, so it's tested exhaustively and automated first).
//
// XP per completed call: 50, plus 50 for a score of 80+ or 25 for a score of 60-79.
// Streak bonus: +20 on the first call of a day when the rep also practiced the day before.
// Levels: 15 levels (5 tiers x 3 sub-tiers), 400 XP apart.
// Weekly goal: a week counts as missed if the rep completed fewer calls than the goal.
// Demotion: 3 missed weeks in a row drops the rep one level (XP resets to that level's minimum).
// Weeks run Monday to Sunday in the rep's own time zone.

import { faultOn } from './faults.ts';

export const TIERS = ['Rookie', 'Associate', 'Specialist', 'Senior', 'Elite'] as const;
export const XP_PER_LEVEL = 400;
export const MAX_LEVEL = TIERS.length * 3 - 1;

export type CallRecord = { at: string | Date; score: number };

export type BadgeState = {
  xp: number;
  level: number;
  label: string;
  demotions: number;
  consecutiveMisses: number;
  weeks: { weekOf: string; calls: number; met: boolean | null }[];
};

export function levelFromXp(xp: number): number {
  return Math.min(MAX_LEVEL, Math.floor(Math.max(0, xp) / XP_PER_LEVEL));
}

export function levelLabel(level: number): string {
  return `${TIERS[Math.floor(level / 3)]} ${['I', 'II', 'III'][level % 3]}`;
}

export function xpForCall(score: number): number {
  return 50 + (score >= 80 ? 50 : score >= 60 ? 25 : 0);
}

// Civil date in the rep's time zone, as a day number since 1970-01-01.
export function localDay(at: string | Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000);
}

export function weekStart(day: number): number {
  const dow = new Date(day * 86_400_000).getUTCDay(); // 0 = Sunday
  return day - ((dow + 6) % 7);
}

export function isoDate(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function evaluate(
  calls: CallRecord[],
  opts: { timeZone: string; weeklyGoal: number; now: string | Date },
): BadgeState {
  const demoteAfter = faultOn('demote-early') ? 2 : 3;
  const sorted = calls
    .map((c) => ({ ...c, day: localDay(c.at, opts.timeZone) }))
    .sort((a, b) => a.day - b.day || new Date(a.at).getTime() - new Date(b.at).getTime());

  const state: BadgeState = { xp: 0, level: 0, label: levelLabel(0), demotions: 0, consecutiveMisses: 0, weeks: [] };
  if (sorted.length === 0) return state;

  const currentWeek = weekStart(localDay(opts.now, opts.timeZone));
  let prevDay: number | null = null;
  let lastBonusDay: number | null = null;

  for (let w = weekStart(sorted[0].day); w <= currentWeek; w += 7) {
    const inWeek = sorted.filter((c) => weekStart(c.day) === w);
    for (const c of inWeek) {
      state.xp += xpForCall(c.score);
      if (prevDay !== null && c.day === prevDay + 1 && lastBonusDay !== c.day) {
        state.xp += 20;
        lastBonusDay = c.day;
      }
      if (prevDay !== c.day) prevDay = c.day;
    }

    const completed = w < currentWeek;
    const met = completed ? inWeek.length >= opts.weeklyGoal : null;
    state.weeks.push({ weekOf: isoDate(w), calls: inWeek.length, met });

    if (completed) {
      state.consecutiveMisses = met ? 0 : state.consecutiveMisses + 1;
      if (state.consecutiveMisses >= demoteAfter) {
        const lvl = levelFromXp(state.xp);
        if (lvl > 0) state.xp = (lvl - 1) * XP_PER_LEVEL;
        state.demotions += 1;
        state.consecutiveMisses = 0;
      }
    }
  }

  state.level = levelFromXp(state.xp);
  state.label = levelLabel(state.level);
  return state;
}
