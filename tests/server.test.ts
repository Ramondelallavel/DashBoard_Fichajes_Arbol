import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import { generateDemo } from '../src/demo/demoData';
import { autoImport } from '../src/import/pipeline';
import { mergeSettings } from '../src/domain/settings';
import type { DatasetVersion } from '../src/domain/types';
import { D } from './helpers';

const ADMIN_PW = 'Admin-clave-2026';
const H = { 'x-requested-with': 'planificacion', 'content-type': 'application/json' };
/** Peticiones sin cuerpo: sin content-type (como hace el cliente). */
const HX = { 'x-requested-with': 'planificacion' };

let app: FastifyInstance;

function newApp() {
  const built = buildApp({ dbPath: ':memory:', sessionHours: 12, cookieSecure: 'false', maxUploadMb: 100, trustProxy: false, logLevel: 'silent', adminUsername: 'admin', adminPassword: ADMIN_PW });
  return built;
}

async function login(username: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password } });
  expect(r.statusCode, r.body).toBe(200);
  const c = String(r.headers['set-cookie']);
  return c.split(';')[0];
}

const demo = generateDemo({ base: D(2026, 11, 19) });
const settings = mergeSettings({ capacities: demo.capacities });
function payload(kind: 'produccion' | 'ortems', mode: 'inicial' | 'actualizacion', previous?: DatasetVersion) {
  const p =
    kind === 'produccion'
      ? autoImport('produccion', 'p.xlsx', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, mode, previous, 'cliente-falso')
      : autoImport('ortems', 'o.xlsx', [{ grid: demo.ortems, role: 'filas' }], settings, mode, previous, 'cliente-falso');
  return { batch: p.batch, dataset: p.dataset, rawSheets: p.result.rawSheets, basedOnVersion: previous?.version ?? null };
}

describe('Servidor: autenticación y seguridad', () => {
  beforeEach(async () => {
    app = newApp().app;
    await app.ready();
  });

  it('crea el administrador inicial desde variables de entorno y exige sesión en la API', async () => {
    expect((await app.inject({ url: '/api/health' })).json()).toMatchObject({ ok: true, mode: 'servidor' });
    expect((await app.inject({ url: '/api/state' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/session' })).json()).toEqual({ user: null });
    const cookie = await login('admin', ADMIN_PW);
    const s = await app.inject({ url: '/api/auth/session', headers: { cookie } });
    expect(s.json().user).toMatchObject({ username: 'admin', role: 'administrador' });
  });

  it('cookie de sesión HttpOnly y SameSite=Strict; cabeceras de seguridad', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'admin', password: ADMIN_PW } });
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rechaza contraseñas incorrectas y bloquea tras 5 intentos', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'admin', password: 'mala' } });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'admin', password: ADMIN_PW } });
    expect(blocked.statusCode).toBe(429);
  });

  it('protege contra CSRF: exige la cabecera propia y el mismo origen en peticiones que modifican', async () => {
    const cookie = await login('admin', ADMIN_PW);
    const noHeader = await app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie, 'content-type': 'application/json' }, payload: {} });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, cookie, origin: 'https://atacante.example', host: 'localhost:80' }, payload: {} });
    expect(foreign.statusCode).toBe(403);
  });

  it('cierre de sesión invalida la cookie en el servidor', async () => {
    const cookie = await login('admin', ADMIN_PW);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...HX, cookie } });
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('Servidor: usuarios, permisos e importaciones compartidas', () => {
  let admin: string;
  beforeEach(async () => {
    app = newApp().app;
    await app.ready();
    admin = await login('admin', ADMIN_PW);
  });

  async function createUser(username: string, role: string) {
    const r = await app.inject({ method: 'POST', url: '/api/users', headers: { ...H, cookie: admin }, payload: { username, displayName: username.toUpperCase(), role, password: 'Inicial-2026x' } });
    expect(r.statusCode, r.body).toBe(200);
    const c = await login(username, 'Inicial-2026x');
    // primer acceso: debe cambiar la contraseña antes de modificar nada
    const blocked = await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, cookie: c }, payload: {} });
    expect(blocked.statusCode).toBe(403);
    const ch = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...H, cookie: c }, payload: { current: 'Inicial-2026x', next: 'Nueva-clave-2026' } });
    expect(ch.statusCode, ch.body).toBe(200);
    return c;
  }

  it('aplica los permisos en el servidor según el perfil', async () => {
    const consulta = await createUser('lectura', 'consulta');
    const plan = await createUser('plani', 'planificador');
    const p1 = payload('produccion', 'inicial');
    expect((await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: consulta }, payload: p1 })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: plan }, payload: p1 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/data', headers: { ...HX, cookie: plan } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/users', headers: { cookie: plan } })).statusCode).toBe(403);
    // configuración: el planificador puede cambiar capacidad, pero no las reglas de correspondencia
    const st = (await app.inject({ url: '/api/state', headers: { cookie: plan } })).json();
    const cap = await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, cookie: plan }, payload: { ...st.settings, riskThreshold: 0.9 } });
    expect(cap.statusCode).toBe(200);
    const rules = await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, cookie: plan }, payload: { ...st.settings, matching: { ...st.settings.matching, stripLeadingZeros: true } } });
    expect(rules.statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/reviews/al_1', headers: { ...H, cookie: consulta }, payload: { state: 'revisada' } })).statusCode).toBe(403);
  });

  it('el usuario de la importación lo fija el servidor, no el cliente; el estado se comparte', async () => {
    const plan = await createUser('plani', 'planificador');
    await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: plan }, payload: payload('produccion', 'inicial') });
    const st = (await app.inject({ url: '/api/state', headers: { cookie: admin } })).json();
    expect(st.batches[0].user).toBe('PLANI (planificador)');
    expect(st.active.produccion.version).toBe(1);
    expect(st.active.produccion.records.length).toBeGreaterThan(400);
  });

  it('control de concurrencia: rechaza una importación basada en una versión desactualizada', async () => {
    const o1 = payload('ortems', 'inicial');
    expect((await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: admin }, payload: o1 })).statusCode).toBe(200);
    const st = (await app.inject({ url: '/api/state', headers: { cookie: admin } })).json();
    const o2 = payload('ortems', 'actualizacion', st.active.ortems);
    const o2stale = { ...payload('ortems', 'actualizacion', st.active.ortems) };
    expect((await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: admin }, payload: o2 })).statusCode).toBe(200);
    const conflict = await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: admin }, payload: o2stale });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatch(/Otro usuario/);
    const st2 = (await app.inject({ url: '/api/state', headers: { cookie: admin } })).json();
    expect(st2.active.ortems.version).toBe(2);
    expect(st2.active.ortemsPrev.version).toBe(1);
    expect(st2.batches.map((b: { status: string }) => b.status).sort()).toEqual(['activa', 'historica']);
  });

  it('valida la estructura de lo que envía el cliente', async () => {
    const bad = payload('produccion', 'inicial');
    (bad.dataset.records[0] as unknown as Record<string, unknown>).ordenId = { $ne: 1 };
    const r = await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: admin }, payload: bad });
    expect(r.statusCode).toBe(400);
  });

  it('revisiones y validaciones manuales registran usuario y fecha en el servidor', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/reviews/al_abc123', headers: { ...H, cookie: admin }, payload: { state: 'revisada', note: 'ok', user: 'falso' } });
    expect(r.json()).toMatchObject({ state: 'revisada', user: 'Administrador (administrador)' });
    const m = await app.inject({ method: 'PUT', url: '/api/manual', headers: { ...H, cookie: admin }, payload: { kind: 'orden-padre', ordenId: 'A', targetId: 'B', decision: 'confirmada' } });
    expect(m.json()).toMatchObject({ id: 'orden-padre:A', user: 'Administrador (administrador)' });
    const rev = (await app.inject({ url: '/api/revision', headers: { cookie: admin } })).json();
    expect(rev.revision).toBe(2);
    expect(rev.user).toBe('Administrador (administrador)');
  });

  it('mantiene al menos un administrador y revoca sesiones al desactivar un usuario', async () => {
    const users = (await app.inject({ url: '/api/users', headers: { cookie: admin } })).json().users;
    const me = users[0];
    const demote = await app.inject({ method: 'PATCH', url: `/api/users/${me.id}`, headers: { ...H, cookie: admin }, payload: { role: 'consulta' } });
    expect(demote.statusCode).toBe(400);
    const plan = await createUser('plani', 'planificador');
    const pid = (await app.inject({ url: '/api/users', headers: { cookie: admin } })).json().users.find((u: { username: string }) => u.username === 'plani').id;
    await app.inject({ method: 'PATCH', url: `/api/users/${pid}`, headers: { ...H, cookie: admin }, payload: { active: false } });
    expect((await app.inject({ url: '/api/state', headers: { cookie: plan } })).statusCode).toBe(401);
    const audit = (await app.inject({ url: '/api/audit', headers: { cookie: admin } })).json().entries.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['usuario.crear', 'usuario.modificar', 'sesion.inicio', 'usuario.cambio_contrasena']));
  });

  it('el borrado de datos requiere administrador y deja el historial vacío', async () => {
    await app.inject({ method: 'POST', url: '/api/imports', headers: { ...H, cookie: admin }, payload: payload('produccion', 'inicial') });
    expect((await app.inject({ method: 'DELETE', url: '/api/data', headers: { ...HX, cookie: admin } })).statusCode).toBe(200);
    const st = (await app.inject({ url: '/api/state', headers: { cookie: admin } })).json();
    expect(st.batches).toHaveLength(0);
    expect(st.active.produccion).toBeNull();
  });
});
