// Compliance end to end through the API: stored transcripts, the audit trail, and who may read it.

import { test, expect } from '@playwright/test';
import { loginAs, resetServer } from '../helpers/api.ts';

test.beforeEach(resetServer);

async function sessionWithTurn(text: string) {
  const ana = await loginAs('nw-rep-ana');
  const { id } = await (await ana.post('/api/sessions', { data: { personaId: 'nw-dr-okafor', focus: 'dosing' } })).json();
  await ana.post(`/api/sessions/${id}/turns`, { data: { text } });
  return { ana, id };
}

test('AUD-01 the stored transcript never contains patient identifiers @P1', async () => {
  const { ana, id } = await sessionWithTurn('My patient Grace Holt, DOB 2/9/1949, asked about dosing.');
  const record = await (await ana.get(`/api/sessions/${id}`)).json();
  const stored = JSON.stringify(record.turns);
  expect(stored).not.toMatch(/Grace|Holt|1949/);
  expect(stored).toContain('[NAME]');
});

test('AUD-02 every AI turn has an audit record a compliance reviewer can read @P1', async () => {
  const { id } = await sessionWithTurn('How should I dose it?');
  const compliance = await loginAs('nw-compliance');
  const audit = await (await compliance.get(`/api/sessions/${id}/audit`)).json();
  expect(audit.turns).toHaveLength(1);
  expect(audit.turns[0]).toMatchObject({
    promptVersion: expect.stringMatching(/^hcp-persona@/),
    retrievedFactIds: expect.arrayContaining(['nw-dos']),
    toolsCalled: expect.arrayContaining(['check_compliance']),
    gateVerdicts: [true],
    outcome: 'answered',
  });
});

test('AUD-03 reps, managers and other customers cannot read the audit trail @P1', async () => {
  const { ana, id } = await sessionWithTurn('How should I dose it?');
  expect((await ana.get(`/api/sessions/${id}/audit`)).status()).toBe(403);
  expect((await (await loginAs('nw-manager-east')).get(`/api/sessions/${id}/audit`)).status()).toBe(403);
  expect((await (await loginAs('hb-manager-north')).get(`/api/sessions/${id}/audit`)).status()).toBe(404);
});
