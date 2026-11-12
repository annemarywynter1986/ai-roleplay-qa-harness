// Role-based access: rep, manager, trainer, compliance.

import { test, expect } from '@playwright/test';
import { completeSession, loginAs, resetServer } from '../helpers/api.ts';

test.beforeEach(resetServer);

const lines = ['Corvexa lowered systolic pressure by 12 mmHg in VALOR-1.'];

test('ROLE-01 a rep can read their own session but not a teammate’s @P1', async () => {
  const ana = await loginAs('nw-rep-ana');
  const ben = await loginAs('nw-rep-ben');
  const { id } = await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines });

  expect((await ana.get(`/api/sessions/${id}`)).status()).toBe(200);
  expect((await ben.get(`/api/sessions/${id}`)).status()).toBe(404);
});

test('ROLE-01 only the owner can add turns to or end a session @P1', async () => {
  const ana = await loginAs('nw-rep-ana');
  const { id } = await (await ana.post('/api/sessions', { data: { personaId: 'nw-dr-okafor', focus: 'efficacy' } })).json();
  const manager = await loginAs('nw-manager-east');
  expect((await manager.post(`/api/sessions/${id}/turns`, { data: { text: 'hi' } })).status()).toBe(403);
  expect((await manager.post(`/api/sessions/${id}/end`)).status()).toBe(403);
});

test('ROLE-02 a manager sees their own team only @P1', async () => {
  const ana = await loginAs('nw-rep-ana'); // team east
  const cy = await loginAs('nw-rep-cy'); // team west
  const east = await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines });
  const west = await completeSession(cy, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines });

  const manager = await loginAs('nw-manager-east');
  const team: { id: string }[] = await (await manager.get('/api/team/sessions')).json();
  expect(team.map((s) => s.id)).toContain(east.id);
  expect(team.map((s) => s.id)).not.toContain(west.id);
  expect((await manager.get(`/api/sessions/${west.id}`)).status()).toBe(404);
});

test('ROLE-02 reps cannot open manager views @P1', async () => {
  const ana = await loginAs('nw-rep-ana');
  expect((await ana.get('/api/team/sessions')).status()).toBe(403);
  expect((await ana.get('/api/compliance/report')).status()).toBe(403);
});

test('ROLE-03 a trainer can review any session at their own customer @P2', async () => {
  const cy = await loginAs('nw-rep-cy');
  const { id } = await completeSession(cy, { personaId: 'nw-dr-lindqvist', focus: 'safety', lines });
  const trainer = await loginAs('nw-trainer');
  expect((await trainer.get(`/api/sessions/${id}`)).status()).toBe(200);
});

test('ROLE-04 compliance report counts off-label flags for its own customer only @P2', async () => {
  const ana = await loginAs('nw-rep-ana');
  await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines: [...lines, 'It also works in children.'] });
  await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines });

  const compliance = await loginAs('nw-compliance');
  const report = await (await compliance.get('/api/compliance/report')).json();
  expect(report).toEqual({ tenantId: 'northwind', completedSessions: 2, offLabelFlags: 1 });
});

test('SCR-05 the score is identical in the result, the session record, and history @P1', async () => {
  const ana = await loginAs('nw-rep-ana');
  const { id, score } = await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines });
  const record = await (await ana.get(`/api/sessions/${id}`)).json();
  const history: { id: string; score: number }[] = await (await ana.get('/api/sessions')).json();
  expect(record.score).toBe(score);
  expect(history.find((s) => s.id === id)?.score).toBe(score);
});

test('ROLE-01 unauthenticated requests are refused @P1', async ({ request }) => {
  expect((await request.get('/api/personas')).status()).toBe(401);
});
