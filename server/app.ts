/**
 * API del servidor (modo multiusuario). Expone las mismas operaciones que el repositorio local del
 * cliente, añadiendo autenticación, permisos aplicados en el servidor, control de concurrencia,
 * registro de actividad y aviso de cambios a los demás usuarios.
 */
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { can, type Permission } from '../src/auth/roles';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../src/domain/settings';
import type { AlertReview, ImportBatch, ManualRelation, Role } from '../src/domain/types';
import {
  bootstrapAdmin,
  countActiveAdmins,
  createSession,
  createUser,
  destroySession,
  destroyUserSessions,
  findUser,
  findUserByName,
  hashPassword,
  listUsers,
  LoginThrottle,
  publicUser,
  purgeExpiredSessions,
  ROLES,
  sessionUser,
  validatePassword,
  verifyPassword,
  type SessionUser,
} from './auth';
import { allJson, audit, bumpRevision, getJson, openDb, revisionInfo, tx, type Db } from './db';
import { BadRequest, Conflict, Forbidden, isObj, str, validateId, validateImport, validateJsonObject } from './validate';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken?: string;
  }
}

export interface AppConfig {
  dbPath: string;
  staticDir?: string;
  sessionHours: number;
  cookieSecure: 'auto' | 'true' | 'false';
  maxUploadMb: number;
  trustProxy: boolean;
  logLevel: string;
  adminUsername?: string;
  adminPassword?: string;
}

export const APP_VERSION = '0.2.0';
const COOKIE = 'pi_session';
const CLIENT_HEADER = 'planificacion';
/** Claves de configuración que puede cambiar quien tiene «configurar_capacidad»; el resto exige «configurar». */
const CAPACITY_KEYS = new Set(['referenceDate', 'calendar', 'capacities', 'assumedCapacity', 'riskThreshold', 'horizonWeeks', 'tolerance', 'highDeviationDays', 'load']);

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      /* cookie mal formada: se ignora */
    }
  }
  return out;
}

function who(u: SessionUser) {
  return `${u.displayName} (${u.role})`;
}

function loadSettings(db: Db): Settings {
  return mergeSettings(getJson<Partial<Settings>>(db, 'SELECT data FROM settings WHERE id = 1'));
}

export function buildApp(cfg: AppConfig): { app: FastifyInstance; db: Db; bootstrap: ReturnType<typeof bootstrapAdmin> } {
  const db = openDb(cfg.dbPath);
  const bootstrap = bootstrapAdmin(db, { ADMIN_USERNAME: cfg.adminUsername, ADMIN_PASSWORD: cfg.adminPassword });
  purgeExpiredSessions(db);
  const throttle = new LoginThrottle();
  const app = Fastify({
    logger: cfg.logLevel === 'silent' ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
    bodyLimit: 1024 * 1024,
    trustProxy: cfg.trustProxy,
  });
  app.decorateRequest('user', null);

  void app.register(fastifyCompress, { global: true, threshold: 2048 });

  // Cabeceras de seguridad en todas las respuestas
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return payload;
  });

  // Autenticación y protección CSRF de la API
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating) {
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try {
          ok = new URL(origin).host === req.headers.host;
        } catch {
          ok = false;
        }
        if (!ok) return reply.code(403).send({ error: 'Origen de la petición no permitido.' });
      }
      if (req.headers['x-requested-with'] !== CLIENT_HEADER) return reply.code(403).send({ error: 'Petición no permitida.' });
    }
    if (req.url === '/api/health' || req.url === '/api/auth/login' || req.url === '/api/auth/logout') return;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const user = sessionUser(db, token, cfg.sessionHours);
    if (!user) return reply.code(401).send({ error: 'Sesión no iniciada o caducada.' });
    req.user = user;
    req.sessionToken = token;
    if (mutating && user.mustChange && req.url !== '/api/auth/password' && req.url !== '/api/auth/logout') {
      return reply.code(403).send({ error: 'Debe cambiar su contraseña antes de continuar.' });
    }
  });

  app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, req, reply) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Error interno del servidor.' : err.message });
  });

  const requirePerm = (req: FastifyRequest, p: Permission) => {
    if (!req.user || !can(req.user.role, p)) throw new Forbidden('Su perfil no tiene permiso para esta acción.');
    return req.user;
  };

  const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string, maxAge: number) => {
    const secure = cfg.cookieSecure === 'true' || (cfg.cookieSecure === 'auto' && req.protocol === 'https');
    reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  };

  /* ---------------- Salud y sesión ---------------- */

  app.get('/api/health', async () => ({ ok: true, mode: 'servidor', version: APP_VERSION }));

  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body;
    if (!isObj(b) || !str(b.username, 100) || !str(b.password, 200)) throw new BadRequest('Usuario y contraseña obligatorios.');
    const username = (b.username as string).trim();
    const key = `${username.toLowerCase()}|${req.ip}`;
    const wait = throttle.blockedFor(key);
    if (wait > 0) return reply.code(429).send({ error: `Demasiados intentos fallidos. Inténtelo de nuevo en ${Math.ceil(wait / 60000)} min.` });
    const row = findUserByName(db, username);
    const ok = row && row.active && verifyPassword(b.password as string, row.password_hash);
    if (!ok) {
      throttle.fail(key);
      audit(db, { username }, 'sesion.fallo', { ip: req.ip });
      return reply.code(401).send({ error: 'Usuario o contraseña incorrectos.' });
    }
    throttle.success(key);
    const token = createSession(db, row.id, cfg.sessionHours);
    setCookie(req, reply, token, cfg.sessionHours * 3600);
    audit(db, { id: row.id, username: row.username }, 'sesion.inicio', { ip: req.ip });
    return { user: sessionUser(db, token, cfg.sessionHours) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(db, parseCookies(req.headers.cookie)[COOKIE]);
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  app.get('/api/auth/session', async (req) => ({ user: req.user }));

  app.post('/api/auth/password', async (req) => {
    const b = req.body;
    const u = req.user!;
    if (!isObj(b) || !str(b.current, 200)) throw new BadRequest('Indique la contraseña actual.');
    const row = findUser(db, u.id)!;
    if (!verifyPassword(b.current as string, row.password_hash)) throw new Forbidden('La contraseña actual no es correcta.');
    const err = validatePassword(b.next);
    if (err) throw new BadRequest(err);
    if (b.next === b.current) throw new BadRequest('La nueva contraseña debe ser distinta de la actual.');
    db.prepare('UPDATE users SET password_hash = ?, must_change = 0, updated_at = ? WHERE id = ?').run(hashPassword(b.next as string), new Date().toISOString(), u.id);
    destroyUserSessions(db, u.id, req.sessionToken);
    audit(db, u, 'usuario.cambio_contrasena');
    return { user: { ...u, mustChange: false } };
  });

  /* ---------------- Estado compartido ---------------- */

  app.get('/api/revision', async () => revisionInfo(db));

  app.get('/api/state', async (req, reply) => {
    const datasetRaw = (id: string | undefined) => (id ? ((db.prepare('SELECT data FROM datasets WHERE id = ? AND purged = 0').get(id) as { data: string } | undefined)?.data ?? 'null') : 'null');
    const act = db.prepare('SELECT kind, dataset_id FROM active').all() as { kind: string; dataset_id: string }[];
    const pointer = Object.fromEntries(act.map((r) => [r.kind, r.dataset_id]));
    const ortemsVersion = pointer.ortems ? (db.prepare('SELECT version FROM datasets WHERE id = ?').get(pointer.ortems) as { version: number } | undefined)?.version : undefined;
    const prevId = ortemsVersion
      ? (db.prepare('SELECT id FROM datasets WHERE kind = ? AND version < ? AND purged = 0 ORDER BY version DESC LIMIT 1').get('ortems', ortemsVersion) as { id: string } | undefined)?.id
      : undefined;
    const versions = (db.prepare('SELECT id, kind, version, created_at, batch_id, mode, records, purged FROM datasets ORDER BY kind, version').all() as Record<string, unknown>[]).map((v) => ({
      id: v.id,
      kind: v.kind,
      version: v.version,
      createdAt: v.created_at,
      batchId: v.batch_id,
      mode: v.mode,
      records: v.records,
      purged: !!v.purged,
    }));
    const reviews: Record<string, AlertReview> = {};
    for (const r of allJson<AlertReview>(db, 'SELECT data FROM reviews')) reviews[r.alertId] = r;
    const head = {
      batches: allJson<ImportBatch>(db, 'SELECT data FROM batches ORDER BY imported_at DESC'),
      versions,
      profiles: allJson(db, 'SELECT data FROM profiles'),
      settings: loadSettings(db),
      reviews,
      manual: allJson(db, 'SELECT data FROM manual'),
      savedFilters: allJson(db, 'SELECT data FROM saved_filters WHERE user_id = ?', req.user!.id),
      revision: revisionInfo(db).revision,
    };
    // Los conjuntos de datos se envían tal como están guardados (sin volver a serializarlos)
    const body = `${JSON.stringify(head).slice(0, -1)},"active":{"produccion":${datasetRaw(pointer.produccion)},"ortems":${datasetRaw(pointer.ortems)},"ortemsPrev":${datasetRaw(prevId)}}}`;
    reply.type('application/json; charset=utf-8');
    return body;
  });

  app.get('/api/datasets/:id', async (req, reply) => {
    const id = validateId((req.params as { id: string }).id);
    const row = db.prepare('SELECT data FROM datasets WHERE id = ? AND purged = 0').get(id) as { data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'Versión no disponible.' });
    reply.type('application/json; charset=utf-8');
    return row.data;
  });

  app.get('/api/raw/:batchId', async (req, reply) => {
    const id = validateId((req.params as { batchId: string }).batchId);
    const row = db.prepare('SELECT data FROM raw_sheets WHERE batch_id = ?').get(id) as { data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'Datos originales no disponibles.' });
    reply.type('application/json; charset=utf-8');
    return row.data;
  });

  /* ---------------- Importaciones ---------------- */

  app.post('/api/imports', { bodyLimit: cfg.maxUploadMb * 1024 * 1024 }, async (req) => {
    const u = requirePerm(req, 'importar');
    const p = validateImport(req.body);
    const kind = p.batch.kind;
    const label = kind === 'produccion' ? 'producción' : 'Ortems';
    return tx(db, () => {
      const cur = db.prepare('SELECT d.version AS v FROM active a JOIN datasets d ON d.id = a.dataset_id WHERE a.kind = ?').get(kind) as { v: number } | undefined;
      const current = cur?.v ?? null;
      if (p.basedOnVersion !== current) {
        throw new Conflict(`Otro usuario ha importado la versión ${current ?? 'inicial'} de ${label} mientras preparaba esta importación. Vuelva a cargar los datos y repita la importación para no perder sus cambios.`);
      }
      if (p.batch.mode === 'inicial' && current !== null) throw new BadRequest(`Ya existen datos de ${label}: elija actualización, sustitución o incremental.`);
      if (p.batch.mode !== 'inicial' && current === null) throw new BadRequest(`No hay datos previos de ${label}: use la importación inicial.`);
      const version = (current ?? 0) + 1;
      if (p.dataset.version !== version) throw new Conflict('La versión preparada no coincide con la del servidor. Vuelva a cargar los datos.');
      const datasetId = `${kind}-v${version}`;
      if (db.prepare('SELECT 1 FROM datasets WHERE id = ?').get(datasetId)) throw new Conflict('Ya existe esa versión en el servidor.');
      const now = new Date().toISOString();
      // datos de auditoría establecidos por el servidor, no por el cliente
      const batch: ImportBatch = { ...p.batch, user: who(u), importedAt: now, status: 'activa', datasetVersion: version };
      const dataset = { ...p.dataset, id: datasetId, createdAt: now };
      const prevBatches = allJson<ImportBatch>(db, 'SELECT data FROM batches WHERE kind = ?', kind).filter((b) => b.status === 'activa');
      for (const b of prevBatches) {
        b.status = batch.mode === 'sustitucion' ? 'sustituida' : batch.mode === 'incremental' ? 'fusionada' : 'historica';
        db.prepare('UPDATE batches SET data = ? WHERE id = ?').run(JSON.stringify(b), b.id);
      }
      db.prepare('INSERT INTO raw_sheets (batch_id, data) VALUES (?, ?)').run(batch.id, JSON.stringify(p.rawSheets));
      db.prepare('INSERT INTO datasets (id, kind, version, created_at, batch_id, mode, records, purged, data) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
        datasetId,
        kind,
        version,
        now,
        batch.id,
        batch.mode,
        dataset.records.length,
        JSON.stringify(dataset),
      );
      db.prepare('INSERT INTO batches (id, kind, imported_at, data) VALUES (?, ?, ?, ?)').run(batch.id, kind, now, JSON.stringify(batch));
      const keep = Math.max(2, loadSettings(db).keepVersions);
      const live = db.prepare('SELECT id FROM datasets WHERE kind = ? AND purged = 0 ORDER BY version DESC').all(kind) as { id: string }[];
      for (const old of live.slice(keep)) db.prepare('UPDATE datasets SET purged = 1, data = NULL WHERE id = ?').run(old.id);
      db.prepare('INSERT INTO active (kind, dataset_id) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET dataset_id = excluded.dataset_id').run(kind, datasetId);
      audit(db, u, 'importacion', { kind, fileName: batch.fileName, mode: batch.mode, version, registros: dataset.records.length });
      const revision = bumpRevision(db, who(u), `importó ${batch.fileName} (${label} v${version})`);
      return { ok: true, version, datasetId, batchId: batch.id, revision };
    });
  });

  app.delete('/api/data', async (req) => {
    const u = requirePerm(req, 'borrar_datos');
    tx(db, () => {
      for (const t of ['batches', 'raw_sheets', 'datasets', 'active', 'reviews', 'manual']) db.exec(`DELETE FROM ${t}`);
      audit(db, u, 'datos.borrar');
      bumpRevision(db, who(u), 'borró los datos importados');
    });
    return { ok: true };
  });

  /* ---------------- Configuración y perfiles ---------------- */

  app.put('/api/settings', async (req) => {
    const u = req.user!;
    const body = validateJsonObject(req.body, 5 * 1024 * 1024, 'Configuración');
    const next = mergeSettings(body as Partial<Settings>);
    const cur = loadSettings(db);
    const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k]));
    const needsFull = changed.some((k) => !CAPACITY_KEYS.has(k));
    requirePerm(req, needsFull ? 'configurar' : 'configurar_capacidad');
    if (!changed.length) return { ok: true, settings: cur };
    db.prepare('INSERT INTO settings (id, data, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by').run(
      JSON.stringify(next),
      new Date().toISOString(),
      who(u),
    );
    audit(db, u, 'configuracion', { cambios: changed });
    bumpRevision(db, who(u), `modificó la configuración (${changed.join(', ')})`);
    return { ok: true, settings: next };
  });

  app.put('/api/profiles/:id', async (req) => {
    const u = requirePerm(req, 'importar');
    const id = validateId((req.params as { id: string }).id, 'Perfil');
    const p = validateJsonObject(req.body, 1024 * 1024, 'Perfil');
    if (!isObj(p.mapping) || !str(p.name, 200) || !['produccion', 'ortems'].includes(p.kind as string)) throw new BadRequest('Perfil no válido.');
    db.prepare('INSERT INTO profiles (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, JSON.stringify({ ...p, id }));
    audit(db, u, 'perfil.guardar', { id, name: p.name });
    return { ok: true };
  });

  app.delete('/api/profiles/:id', async (req) => {
    const u = requirePerm(req, 'importar');
    const id = validateId((req.params as { id: string }).id, 'Perfil');
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    audit(db, u, 'perfil.eliminar', { id });
    return { ok: true };
  });

  /* ---------------- Revisiones y validaciones manuales ---------------- */

  app.put('/api/reviews/:alertId', async (req) => {
    const u = requirePerm(req, 'revisar_alertas');
    const alertId = validateId((req.params as { alertId: string }).alertId, 'Alerta');
    const b = req.body;
    if (!isObj(b) || !['pendiente', 'revisada', 'descartada'].includes(b.state as string) || !(b.note === undefined || str(b.note, 4000))) throw new BadRequest('Revisión no válida.');
    const prev = getJson<AlertReview>(db, 'SELECT data FROM reviews WHERE alert_id = ?', alertId);
    const now = new Date().toISOString();
    const r: AlertReview = { alertId, state: b.state as AlertReview['state'], note: (b.note as string | undefined) ?? prev?.note, user: who(u), updatedAt: now, firstSeen: prev?.firstSeen ?? now };
    db.prepare('INSERT INTO reviews (alert_id, data) VALUES (?, ?) ON CONFLICT(alert_id) DO UPDATE SET data = excluded.data').run(alertId, JSON.stringify(r));
    bumpRevision(db, who(u), `marcó una alerta como ${r.state}`);
    return r;
  });

  app.put('/api/manual', async (req) => {
    const u = requirePerm(req, 'validar_relaciones');
    const b = req.body;
    if (!isObj(b) || !['orden-padre', 'orden-aparato'].includes(b.kind as string) || !str(b.ordenId, 200) || !str(b.targetId, 200) || !['confirmada', 'rechazada'].includes(b.decision as string)) {
      throw new BadRequest('Validación manual no válida.');
    }
    const m: ManualRelation = {
      id: `${b.kind}:${b.ordenId}`,
      kind: b.kind as ManualRelation['kind'],
      ordenId: b.ordenId as string,
      targetId: b.targetId as string,
      decision: b.decision as ManualRelation['decision'],
      note: str(b.note, 2000) ? (b.note as string) : undefined,
      user: who(u),
      at: new Date().toISOString(),
    };
    db.prepare('INSERT INTO manual (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(m.id, JSON.stringify(m));
    audit(db, u, 'relacion.validar', m);
    bumpRevision(db, who(u), `validó la relación de la orden ${m.ordenId}`);
    return m;
  });

  app.delete('/api/manual/:id', async (req) => {
    const u = requirePerm(req, 'validar_relaciones');
    const id = (req.params as { id: string }).id;
    if (!str(id, 300)) throw new BadRequest('Identificador no válido.');
    db.prepare('DELETE FROM manual WHERE id = ?').run(id);
    audit(db, u, 'relacion.deshacer', { id });
    bumpRevision(db, who(u), 'deshizo una validación manual');
    return { ok: true };
  });

  /* ---------------- Filtros guardados (por usuario) ---------------- */

  app.put('/api/filters/:id', async (req) => {
    const id = validateId((req.params as { id: string }).id, 'Filtro');
    const f = validateJsonObject(req.body, 256 * 1024, 'Filtro');
    const owner = db.prepare('SELECT user_id FROM saved_filters WHERE id = ?').get(id) as { user_id: string } | undefined;
    if (owner && owner.user_id !== req.user!.id) throw new Forbidden('El filtro pertenece a otro usuario.');
    db.prepare('INSERT INTO saved_filters (id, user_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, req.user!.id, JSON.stringify({ ...f, id }));
    return { ok: true };
  });

  app.delete('/api/filters/:id', async (req) => {
    const id = validateId((req.params as { id: string }).id, 'Filtro');
    db.prepare('DELETE FROM saved_filters WHERE id = ? AND user_id = ?').run(id, req.user!.id);
    return { ok: true };
  });

  /* ---------------- Usuarios y actividad (administración) ---------------- */

  app.get('/api/users', async (req) => {
    requirePerm(req, 'administrar_usuarios');
    return { users: listUsers(db).map(publicUser) };
  });

  app.post('/api/users', async (req) => {
    const u = requirePerm(req, 'administrar_usuarios');
    const b = req.body;
    if (!isObj(b) || !str(b.username, 60) || !/^[A-Za-z0-9._-]{3,60}$/.test(b.username as string)) throw new BadRequest('Nombre de usuario no válido (3-60 caracteres: letras, números, punto, guion).');
    if (!ROLES.includes(b.role as Role)) throw new BadRequest('Perfil no válido.');
    const err = validatePassword(b.password);
    if (err) throw new BadRequest(err);
    if (findUserByName(db, b.username as string)) throw new Conflict('Ya existe un usuario con ese nombre.');
    const row = createUser(db, { username: b.username as string, displayName: str(b.displayName, 120) && (b.displayName as string).trim() ? (b.displayName as string).trim() : (b.username as string), role: b.role as Role, password: b.password as string, mustChange: true });
    audit(db, u, 'usuario.crear', { username: row.username, role: row.role });
    return { user: publicUser(row) };
  });

  app.patch('/api/users/:id', async (req) => {
    const u = requirePerm(req, 'administrar_usuarios');
    const id = (req.params as { id: string }).id;
    const row = typeof id === 'string' ? findUser(db, id) : undefined;
    if (!row) throw new BadRequest('Usuario no encontrado.');
    const b = req.body;
    if (!isObj(b)) throw new BadRequest('Petición no válida.');
    const role = b.role === undefined ? row.role : (b.role as Role);
    const active = b.active === undefined ? !!row.active : !!b.active;
    if (!ROLES.includes(role)) throw new BadRequest('Perfil no válido.');
    if ((role !== 'administrador' || !active) && row.role === 'administrador' && row.active && countActiveAdmins(db, row.id) === 0) {
      throw new BadRequest('Debe quedar al menos un administrador activo.');
    }
    const now = new Date().toISOString();
    const displayName = str(b.displayName, 120) && (b.displayName as string).trim() ? (b.displayName as string).trim() : row.display_name;
    db.prepare('UPDATE users SET role = ?, active = ?, display_name = ?, updated_at = ? WHERE id = ?').run(role, active ? 1 : 0, displayName, now, row.id);
    if (b.password !== undefined) {
      const err = validatePassword(b.password);
      if (err) throw new BadRequest(err);
      db.prepare('UPDATE users SET password_hash = ?, must_change = 1, updated_at = ? WHERE id = ?').run(hashPassword(b.password as string), now, row.id);
    }
    if (!active || b.password !== undefined || role !== row.role) destroyUserSessions(db, row.id);
    audit(db, u, 'usuario.modificar', { username: row.username, role, active, resetPassword: b.password !== undefined });
    return { user: publicUser(findUser(db, row.id)!) };
  });

  app.get('/api/audit', async (req) => {
    requirePerm(req, 'administrar_usuarios');
    const limit = Math.min(1000, Math.max(1, Number((req.query as { limit?: string }).limit ?? 200) || 200));
    return { entries: db.prepare('SELECT id, at, username, action, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit) };
  });

  app.all('/api/*', async (_req, reply) => reply.code(404).send({ error: 'Ruta no encontrada.' }));

  /* ---------------- Aplicación web ---------------- */

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    void app.register(fastifyStatic, {
      root: cfg.staticDir,
      index: 'index.html',
      setHeaders: (res, path) => {
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return { app, db, bootstrap };
}
