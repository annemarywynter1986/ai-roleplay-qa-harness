// Badge Center rules. Fixed logic with sharp edges (thresholds, week boundaries,
// time zones), so it's covered with boundary-value tests.

import { test, expect } from '@playwright/test';
import { evaluate, levelFromXp, levelLabel, localDay, weekStart, isoDate, xpForCall, MAX_LEVEL } from '../../src/badges.ts';

const NY = 'America/New_York';

// Helper: n calls on the same morning (no streak bonus), each scoring `score`.
function callsOn(date: string, n: number, score = 85) {
  return Array.from({ length: n }, (_, i) => ({ at: `${date}T1${i % 10}:00:00-05:00`, score }));
}

test.describe('BDG-01 XP per call @P1', () => {
  for (const [score, xp] of [[95, 100], [80, 100], [79, 75], [60, 75], [59, 50], [0, 50]] as const) {
    test(`score ${score} earns ${xp} XP`, () => {
      expect(xpForCall(score)).toBe(xp);
    });
  }

  test('XP adds up across calls', () => {
    const s = evaluate(callsOn('2026-11-09', 3, 85), { timeZone: NY, weeklyGoal: 3, now: '2026-11-12T12:00:00-05:00' });
    expect(s.xp).toBe(300);
  });
});

test.describe('BDG-02 level boundaries @P2', () => {
  for (const [xp, level] of [[0, 0], [399, 0], [400, 1], [401, 1], [799, 1], [800, 2], [5999, 14], [6000, 14], [100000, MAX_LEVEL]] as const) {
    test(`${xp} XP is level ${level}`, () => {
      expect(levelFromXp(xp)).toBe(level);
    });
  }

  test('labels walk through tiers and sub-tiers', () => {
    expect(levelLabel(0)).toBe('Rookie I');
    expect(levelLabel(2)).toBe('Rookie III');
    expect(levelLabel(3)).toBe('Associate I');
    expect(levelLabel(MAX_LEVEL)).toBe('Elite III');
  });

  test('negative XP never produces a negative level', () => {
    expect(levelFromXp(-50)).toBe(0);
  });
});

test.describe('BDG-03 demotion after missed weekly goals @P1', () => {
  // Week of Mon 2026-10-12: 8 strong calls -> 800 XP -> level 2. Weekly goal: 3 calls.
  const strongWeek = callsOn('2026-10-12', 8);

  test('3 missed weeks in a row demotes one level', () => {
    const s = evaluate(strongWeek, { timeZone: NY, weeklyGoal: 3, now: '2026-11-09T12:00:00-05:00' });
    // Weeks of 10/19, 10/26 and 11/02 are missed; 11/09 is still in progress.
    expect(s.demotions).toBe(1);
    expect(s.level).toBe(1);
    expect(s.xp).toBe(400);
  });

  test('2 missed weeks then 1 met week does not demote', () => {
    const calls = [...strongWeek, ...callsOn('2026-11-02', 3)];
    const s = evaluate(calls, { timeZone: NY, weeklyGoal: 3, now: '2026-11-09T12:00:00-05:00' });
    expect(s.demotions).toBe(0);
    expect(s.consecutiveMisses).toBe(0);
  });

  test('2 missed weeks so far does not demote yet', () => {
    const s = evaluate(strongWeek, { timeZone: NY, weeklyGoal: 3, now: '2026-11-02T12:00:00-05:00' });
    expect(s.demotions).toBe(0);
    expect(s.consecutiveMisses).toBe(2);
  });

  test('the current week never counts as missed while it is in progress', () => {
    const s = evaluate(callsOn('2026-11-09', 1), { timeZone: NY, weeklyGoal: 3, now: '2026-11-12T12:00:00-05:00' });
    expect(s.weeks.at(-1)!.met).toBeNull();
  });

  test('a rep at the lowest level is not pushed below it', () => {
    const s = evaluate(callsOn('2026-10-12', 1, 40), { timeZone: NY, weeklyGoal: 3, now: '2026-11-09T12:00:00-05:00' });
    expect(s.level).toBe(0);
    expect(s.xp).toBeGreaterThanOrEqual(0);
  });
});

test.describe('BDG-04 week boundaries follow the rep’s time zone @P2', () => {
  // 04:30 UTC on Monday 2026-11-16 is still Sunday evening in New York.
  const instant = '2026-11-16T04:30:00Z';

  test('same instant falls in different weeks in New York and UTC', () => {
    expect(isoDate(weekStart(localDay(instant, NY)))).toBe('2026-11-09');
    expect(isoDate(weekStart(localDay(instant, 'UTC')))).toBe('2026-11-16');
  });

  test('11:59 PM Sunday and 12:01 AM Monday land in different weeks', () => {
    const sun = localDay('2026-11-15T23:59:00-05:00', NY);
    const mon = localDay('2026-11-16T00:01:00-05:00', NY);
    expect(weekStart(sun)).not.toBe(weekStart(mon));
  });

  test('a late Sunday call counts toward the week it was made in', () => {
    const calls = [...callsOn('2026-11-09', 2), { at: '2026-11-15T23:30:00-05:00', score: 85 }];
    const s = evaluate(calls, { timeZone: NY, weeklyGoal: 3, now: '2026-11-17T12:00:00-05:00' });
    expect(s.weeks[0]).toMatchObject({ weekOf: '2026-11-09', calls: 3, met: true });
  });
});

test.describe('BDG-05 streak bonus @P3', () => {
  test('practicing on consecutive days adds 20 XP once per day', () => {
    const calls = [
      { at: '2026-11-09T10:00:00-05:00', score: 85 },
      { at: '2026-11-10T10:00:00-05:00', score: 85 },
      { at: '2026-11-10T15:00:00-05:00', score: 85 },
    ];
    const s = evaluate(calls, { timeZone: NY, weeklyGoal: 3, now: '2026-11-12T12:00:00-05:00' });
    expect(s.xp).toBe(300 + 20);
  });

  test('a gap day breaks the streak', () => {
    const calls = [
      { at: '2026-11-09T10:00:00-05:00', score: 85 },
      { at: '2026-11-11T10:00:00-05:00', score: 85 },
    ];
    const s = evaluate(calls, { timeZone: NY, weeklyGoal: 3, now: '2026-11-12T12:00:00-05:00' });
    expect(s.xp).toBe(200);
  });
});
