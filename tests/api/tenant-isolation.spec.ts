// Competing pharma customers share one platform. Nothing may cross between them.

import { test, expect } from '@playwright/test';
import { completeSession, loginAs, resetServer } from '../helpers/api.ts';

test.beforeEach(resetServer);

test('TEN-01 a rep sees only their own customer’s personas @P1', async () => {
  const nw = await loginAs('nw-rep-ana');
  const personas: { id: string }[] = await (await nw.get('/api/personas')).json();
  expect(personas.length).toBeGreaterThan(0);
  expect(personas.every((p) => p.id.startsWith('nw-'))).toBe(true);
});

test('TEN-01 the AI never discusses another customer’s product, end to end @P1', async () => {
  const nw = await loginAs('nw-rep-ana');
  const { id } = await (await nw.post('/api/sessions', { data: { personaId: 'nw-dr-okafor', focus: 'efficacy' } })).json();
  const reply = await (await nw.post(`/api/sessions/${id}/turns`, { data: { text: 'What do you know about Dermavel?' } })).json();
  expect(reply.text).not.toMatch(/psoriasis|PASI|CLEARSKIN|160 mg/i);
});

test('TEN-01 a session from one customer is invisible to every user at another @P1', async () => {
  const ana = await loginAs('nw-rep-ana');
  const { id } = await completeSession(ana, { personaId: 'nw-dr-okafor', focus: 'efficacy', lines: ['Tell me about the data.'] });

  for (const outsider of ['hb-rep-dee', 'hb-manager-north']) {
    const ctx = await loginAs(outsider);
    const res = await ctx.get(`/api/sessions/${id}`);
    expect(res.status(), `${outsider} reading ${id}`).toBe(404);
  }
});

test('TEN-02 a rep cannot start a session with another customer’s persona @P1', async () => {
  const dee = await loginAs('hb-rep-dee');
  const res = await dee.post('/api/sessions', { data: { personaId: 'nw-dr-okafor', focus: 'efficacy' } });
  expect(res.status()).toBe(400);
});

test('FOC-03 each customer gets its own Call Focus list @P1', async () => {
  const nw = await (await (await loginAs('nw-rep-ana')).get('/api/focus-areas')).json();
  const hb = await (await (await loginAs('hb-rep-dee')).get('/api/focus-areas')).json();
  expect(nw).toEqual(['efficacy', 'safety', 'dosing', 'competitive']);
  expect(hb).toEqual(['efficacy', 'safety', 'access']);
});

test('FOC-03 a focus area the customer has not enabled is rejected @P2', async () => {
  const dee = await loginAs('hb-rep-dee');
  const res = await dee.post('/api/sessions', { data: { personaId: 'hb-dr-reyes', focus: 'dosing' } });
  expect(res.status()).toBe(400);
});
