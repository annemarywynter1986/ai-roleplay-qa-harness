import { request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export const BASE_URL = 'http://localhost:4317';

// One logged-in API client per user, each with its own cookie jar.
export async function loginAs(username: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/login', { data: { username } });
  if (!res.ok()) throw new Error(`login failed for ${username}: ${res.status()}`);
  return ctx;
}

export async function resetServer(): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  await ctx.post('/api/test/reset');
  await ctx.dispose();
}

// Runs a short session for a rep and returns the ended session.
export async function completeSession(
  rep: APIRequestContext,
  opts: { personaId: string; focus: string; lines: string[] },
): Promise<{ id: string; score: number }> {
  const start = await rep.post('/api/sessions', { data: { personaId: opts.personaId, focus: opts.focus } });
  const { id } = await start.json();
  for (const text of opts.lines) await rep.post(`/api/sessions/${id}/turns`, { data: { text } });
  const end = await (await rep.post(`/api/sessions/${id}/end`)).json();
  return { id, score: end.result.score };
}
