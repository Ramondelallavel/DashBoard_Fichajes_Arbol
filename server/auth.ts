/**
 * Autenticación local con sesiones.
 * - Contraseñas: scrypt con sal aleatoria (nunca se guardan ni se registran en claro).
 * - Sesiones: token aleatorio de 256 bits en cookie HttpOnly + SameSite=Strict; en la base de datos solo
 *   se guarda su huella SHA-256.
 * - Bloqueo temporal tras intentos fallidos.
 * La interfaz SessionUser es independiente del proveedor: un proveedor OIDC/SSO podría crear la misma sesión.
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../src/domain/types';
import { audit, type Db } from './db';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChange: boolean;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
  active: number;
  must_change: number;
  created_at: string;
  updated_at: string;
}

export const ROLES: Role[] = ['administrador', 'planificador', 'consulta'];
export const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function validatePassword(pw: unknown): string | undefined {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe combinar letras y números.';
  return undefined;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function toUser(r: UserRow): SessionUser {
  return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, mustChange: !!r.must_change };
}

export function publicUser(r: UserRow) {
  return { ...toUser(r), active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function findUserByName(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function findUser(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function listUsers(db: Db): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY username').all() as unknown as UserRow[];
}

export function createUser(db: Db, u: { username: string; displayName: string; role: Role; password: string; mustChange?: boolean }): UserRow {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, display_name, role, password_hash, active, must_change, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').run(
    id,
    u.username,
    u.displayName,
    u.role,
    hashPassword(u.password),
    u.mustChange ? 1 : 0,
    now,
    now,
  );
  return findUser(db, id)!;
}

export function countActiveAdmins(db: Db, exceptId?: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'administrador' AND active = 1 AND id != ?").get(exceptId ?? '') as { n: number };
  return Number(r.n);
}

/** Crea el primer administrador si no hay usuarios. Devuelve la contraseña generada si no se proporcionó. */
export function bootstrapAdmin(db: Db, env: { ADMIN_USERNAME?: string; ADMIN_PASSWORD?: string }): { created: boolean; username?: string; generatedPassword?: string } {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (Number(n) > 0) return { created: false };
  const username = (env.ADMIN_USERNAME || 'admin').trim();
  let password = env.ADMIN_PASSWORD;
  let generated: string | undefined;
  if (!password || validatePassword(password)) {
    generated = `${randomBytes(9).toString('base64url')}7a`;
    password = generated;
  }
  createUser(db, { username, displayName: 'Administrador', role: 'administrador', password, mustChange: !!generated });
  audit(db, { username: 'sistema' }, 'usuario.crear_admin_inicial', { username });
  return { created: true, username, generatedPassword: generated };
}

/* ---------------- Sesiones ---------------- */

export function createSession(db: Db, userId: string, hours: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + hours * 3_600_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(sha256(token), userId, now.toISOString(), exp.toISOString(), now.toISOString());
  return token;
}

/** Valida la sesión y renueva su caducidad (sesión deslizante). */
export function sessionUser(db: Db, token: string | undefined, hours: number): SessionUser | undefined {
  if (!token || token.length > 100) return undefined;
  const h = sha256(token);
  const row = db.prepare('SELECT s.expires_at AS exp, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(h) as (UserRow & { exp: string }) | undefined;
  if (!row) return undefined;
  const now = Date.now();
  if (new Date(row.exp).getTime() < now || !row.active) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return undefined;
  }
  db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), new Date(now + hours * 3_600_000).toISOString(), h);
  return toUser(row);
}

export function destroySession(db: Db, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(db: Db, userId: string, exceptToken?: string) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db: Db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

/* ---------------- Limitación de intentos ---------------- */

export class LoginThrottle {
  private fails = new Map<string, { n: number; until: number; first: number }>();
  constructor(
    private maxFails = 5,
    private lockMs = 15 * 60_000,
    private windowMs = 15 * 60_000,
  ) {}
  blockedFor(key: string): number {
    const f = this.fails.get(key);
    if (!f) return 0;
    const now = Date.now();
    if (f.until > now) return f.until - now;
    if (now - f.first > this.windowMs) this.fails.delete(key);
    return 0;
  }
  fail(key: string) {
    const now = Date.now();
    const f = this.fails.get(key);
    if (!f || now - f.first > this.windowMs) {
      this.fails.set(key, { n: 1, until: 0, first: now });
      return;
    }
    f.n++;
    if (f.n >= this.maxFails) f.until = now + this.lockMs;
  }
  success(key: string) {
    this.fails.delete(key);
  }
}
