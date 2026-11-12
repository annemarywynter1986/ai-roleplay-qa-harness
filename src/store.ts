// In-memory users and sessions. Reset between test runs via POST /api/test/reset.

import type { Topic } from './data/tenants.ts';
import type { ScoreResult } from './scoring.ts';

export type Role = 'rep' | 'manager' | 'trainer' | 'compliance';

export type User = { username: string; tenantId: string; role: Role; team?: string; timeZone: string };

export type Session = {
  id: string;
  tenantId: string;
  owner: string;
  personaId: string;
  focus: Topic;
  seed: number;
  turns: { speaker: 'rep' | 'hcp'; text: string }[];
  startedAt: string;
  endedAt?: string;
  result?: ScoreResult;
};

export const users: User[] = [
  { username: 'nw-rep-ana', tenantId: 'northwind', role: 'rep', team: 'east', timeZone: 'America/New_York' },
  { username: 'nw-rep-ben', tenantId: 'northwind', role: 'rep', team: 'east', timeZone: 'America/New_York' },
  { username: 'nw-rep-cy', tenantId: 'northwind', role: 'rep', team: 'west', timeZone: 'America/Los_Angeles' },
  { username: 'nw-manager-east', tenantId: 'northwind', role: 'manager', team: 'east', timeZone: 'America/New_York' },
  { username: 'nw-trainer', tenantId: 'northwind', role: 'trainer', timeZone: 'America/New_York' },
  { username: 'nw-compliance', tenantId: 'northwind', role: 'compliance', timeZone: 'America/New_York' },
  { username: 'hb-rep-dee', tenantId: 'harbor', role: 'rep', team: 'north', timeZone: 'America/Chicago' },
  { username: 'hb-manager-north', tenantId: 'harbor', role: 'manager', team: 'north', timeZone: 'America/Chicago' },
];

export const sessions = new Map<string, Session>();

let counter = 0;
export function newSessionId(): string {
  counter += 1;
  return `sess_${Date.now().toString(36)}_${counter}`;
}

export function reset(): void {
  sessions.clear();
}

export function findUser(username: string | undefined): User | undefined {
  return users.find((u) => u.username === username);
}
