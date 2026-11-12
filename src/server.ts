// Mock role-play platform: JSON API + a small web UI, no dependencies.
// Typed text stands in for transcribed speech, so tests exercise the same
// pipeline a voice session would after speech-to-text.
// Login is a demo cookie with no password. This is a test fixture, not real auth.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tenants } from './data/tenants.ts';
import type { Topic } from './data/tenants.ts';
import { respond } from './persona.ts';
import { scoreSession } from './scoring.ts';
import { evaluate } from './badges.ts';
import { seeded } from './rng.ts';
import { faultOn } from './faults.ts';
import { findUser, newSessionId, reset, sessions, users } from './store.ts';
import type { Session, User } from './store.ts';

const PORT = Number(process.env.PORT ?? 4317);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function currentUser(req: IncomingMessage): User | undefined {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)user=([^;]+)/);
  return findUser(match ? decodeURIComponent(match[1]) : undefined);
}

// Who may read a session. Anything else gets 404 so a session's existence never leaks.
function canRead(user: User, s: Session): boolean {
  if (user.tenantId !== s.tenantId) return false;
  if (user.role === 'trainer' || user.role === 'compliance') return true;
  if (user.role === 'rep') return s.owner === user.username;
  const owner = findUser(s.owner);
  return user.role === 'manager' && owner?.team === user.team;
}

function summary(s: Session) {
  return {
    id: s.id,
    owner: s.owner,
    personaId: s.personaId,
    focus: s.focus,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    score: s.result?.score ?? null,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/' || path === '/index.html') {
    const html = await readFile(new URL('../public/index.html', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
    return;
  }
  if (path === '/health') return send(res, 200, { ok: true });
  if (path === '/api/users' && method === 'GET') {
    return send(res, 200, users.map((u) => ({ username: u.username, role: u.role, tenantId: u.tenantId })));
  }
  if (path === '/api/test/reset' && method === 'POST') {
    reset();
    return send(res, 200, { ok: true });
  }
  if (path === '/api/login' && method === 'POST') {
    const { username } = await readJson(req);
    const user = findUser(String(username));
    if (!user) return send(res, 401, { error: 'Unknown user' });
    return send(res, 200, user, { 'set-cookie': `user=${encodeURIComponent(user.username)}; Path=/; HttpOnly; SameSite=Lax` });
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Log in first' });
  const tenant = tenants[user.tenantId];

  if (path === '/api/me') return send(res, 200, user);

  if (path === '/api/personas') {
    const list = faultOn('leak') ? Object.values(tenants).flatMap((t) => t.personas) : tenant.personas;
    return send(res, 200, list);
  }
  if (path === '/api/focus-areas') return send(res, 200, tenant.focusAreas);

  if (path === '/api/sessions' && method === 'POST') {
    if (user.role !== 'rep') return send(res, 403, { error: 'Only reps can start role-plays' });
    const { personaId, focus } = await readJson(req);
    if (!tenant.personas.some((p) => p.id === personaId)) return send(res, 400, { error: 'Unknown persona' });
    if (!tenant.focusAreas.includes(focus as Topic)) return send(res, 400, { error: 'Focus area not enabled' });
    const s: Session = {
      id: newSessionId(),
      tenantId: tenant.id,
      owner: user.username,
      personaId: String(personaId),
      focus: focus as Topic,
      seed: Math.floor(Math.random() * 2 ** 31),
      turns: [],
      startedAt: new Date().toISOString(),
    };
    sessions.set(s.id, s);
    return send(res, 201, summary(s));
  }

  if (path === '/api/sessions' && method === 'GET') {
    const mine = [...sessions.values()].filter((s) => s.owner === user.username);
    return send(res, 200, mine.map(summary));
  }

  const m = path.match(/^\/api\/sessions\/([\w-]+)(\/turns|\/end)?$/);
  if (m) {
    const s = sessions.get(m[1]);
    if (!s || !canRead(user, s)) return send(res, 404, { error: 'Session not found' });

    if (!m[2] && method === 'GET') return send(res, 200, { ...summary(s), turns: s.turns, result: s.result ?? null });
    if (s.owner !== user.username) return send(res, 403, { error: 'Only the rep who started this session can change it' });
    if (s.endedAt) return send(res, 409, { error: 'Session already ended' });

    if (m[2] === '/turns' && method === 'POST') {
      const { text } = await readJson(req);
      const persona = tenant.personas.find((p) => p.id === s.personaId)!;
      const rng = seeded(s.seed + s.turns.length);
      const reply = respond(tenant, persona, String(text), rng, s.focus);
      s.turns.push({ speaker: 'rep', text: String(text) }, { speaker: 'hcp', text: reply.text });
      return send(res, 200, reply);
    }
    if (m[2] === '/end' && method === 'POST') {
      const repTurns = s.turns.filter((t) => t.speaker === 'rep').map((t) => t.text);
      s.result = scoreSession(tenant, s.focus, repTurns, seeded(s.seed));
      s.endedAt = new Date().toISOString();
      return send(res, 200, { ...summary(s), result: s.result });
    }
  }

  if (path === '/api/team/sessions') {
    if (user.role !== 'manager') return send(res, 403, { error: 'Managers only' });
    const team = users.filter((u) => u.tenantId === user.tenantId && u.team === user.team).map((u) => u.username);
    return send(res, 200, [...sessions.values()].filter((s) => team.includes(s.owner)).map(summary));
  }

  if (path === '/api/compliance/report') {
    if (user.role !== 'compliance') return send(res, 403, { error: 'Compliance only' });
    const own = [...sessions.values()].filter((s) => s.tenantId === user.tenantId);
    return send(res, 200, {
      tenantId: user.tenantId,
      completedSessions: own.filter((s) => s.endedAt).length,
      offLabelFlags: own.filter((s) => s.result?.complianceFlags.includes('off-label')).length,
    });
  }

  if (path === '/api/badges') {
    if (user.role !== 'rep') return send(res, 403, { error: 'Reps only' });
    const calls = [...sessions.values()]
      .filter((s) => s.owner === user.username && s.result)
      .map((s) => ({ at: s.endedAt!, score: s.result!.score }));
    return send(res, 200, evaluate(calls, { timeZone: user.timeZone, weeklyGoal: 3, now: new Date() }));
  }

  send(res, 404, { error: 'Not found' });
}

createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 500, { error: String(err) }));
}).listen(PORT, () => console.log(`Mock role-play platform on http://localhost:${PORT}`));
