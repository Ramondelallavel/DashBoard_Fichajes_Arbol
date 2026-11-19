import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABEL } from '../../auth/roles';
import { useApp } from '../../data/store';
import { adminApi, type AdminUser } from '../../data/backend';
import type { Role } from '../../domain/types';
import { fmtDateTime } from '../../lib/dates';
import { Modal, Notice, Panel } from '../components/common';

const ACTION_LABEL: Record<string, string> = {
  'sesion.inicio': 'Inicio de sesión',
  'sesion.fallo': 'Intento de acceso fallido',
  importacion: 'Importación',
  configuracion: 'Cambio de configuración',
  'datos.borrar': 'Borrado de datos',
  'perfil.guardar': 'Perfil de columnas guardado',
  'perfil.eliminar': 'Perfil de columnas eliminado',
  'relacion.validar': 'Relación validada',
  'relacion.deshacer': 'Validación deshecha',
  'usuario.crear': 'Usuario creado',
  'usuario.crear_admin_inicial': 'Administrador inicial',
  'usuario.modificar': 'Usuario modificado',
  'usuario.cambio_contrasena': 'Cambio de contraseña',
};

const DETAIL_LABEL: Record<string, string> = {
  kind: 'fuente',
  fileName: 'archivo',
  mode: 'modo',
  version: 'versión',
  registros: 'registros',
  username: 'usuario',
  role: 'perfil',
  active: 'activo',
  resetPassword: 'contraseña restablecida',
  cambios: 'cambios',
  ip: 'IP',
  ordenId: 'orden',
  targetId: 'destino',
  decision: 'decisión',
  name: 'nombre',
};

/** Detalle legible de una entrada del registro (el servidor lo guarda como JSON). */
function detailText(d: string | null): string {
  if (!d) return '';
  try {
    const o = JSON.parse(d) as Record<string, unknown>;
    if (typeof o !== 'object' || o === null) return String(o);
    return Object.entries(o)
      .filter(([k]) => DETAIL_LABEL[k])
      .map(([k, v]) => `${DETAIL_LABEL[k]}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v)}`)
      .join(' · ');
  } catch {
    return d;
  }
}

/** Administración de usuarios y registro de actividad (modo servidor, perfil administrador). */
export function UsuariosPanel() {
  const me = useApp((s) => s.sessionUser);
  const toast = useApp((s) => s.toast);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof adminApi.audit>>['entries']>([]);
  const [error, setError] = useState<string>();
  const [create, setCreate] = useState(false);
  const [reset, setReset] = useState<AdminUser>();
  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([adminApi.users(), adminApi.audit(150)]);
      setUsers(u.users);
      setAudit(a.entries);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function update(u: AdminUser, patch: Partial<{ role: Role; active: boolean }>) {
    try {
      await adminApi.update(u.id, patch);
      toast('ok', `Usuario ${u.username} actualizado.`);
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }
  return (
    <>
      <Panel
        id="usuarios"
        title="Usuarios"
        sub="Los permisos de cada perfil se aplican en el servidor. Los usuarios nuevos deben cambiar su contraseña en el primer acceso."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setCreate(true)}>
            Nuevo usuario
          </button>
        }
        flush
      >
        {error && (
          <div className="panel-body">
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Perfil</th>
                <th>Estado</th>
                <th>Alta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="id">{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <select className="input input-sm" style={{ width: 'auto' }} value={u.role} onChange={(e) => void update(u, { role: e.target.value as Role })} aria-label={`Perfil de ${u.username}`}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {u.active ? <span className="pill pill-good">Activo</span> : <span className="pill pill-neutral">Desactivado</span>}
                    {u.mustChange && <span className="small muted"> · debe cambiar la contraseña</span>}
                  </td>
                  <td className="small nowrap">{fmtDateTime(new Date(u.createdAt).getTime())}</td>
                  <td className="nowrap">
                    <button className="btn btn-ghost btn-sm" onClick={() => setReset(u)}>
                      Restablecer contraseña
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={u.id === me?.id} onClick={() => void update(u, { active: !u.active })}>
                      {u.active ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Registro de actividad" sub="Últimas 150 acciones: accesos, importaciones, cambios de configuración y validaciones" flush>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap small">{fmtDateTime(new Date(a.at).getTime())}</td>
                  <td className="id">{a.username ?? '—'}</td>
                  <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td className="small muted" style={{ maxWidth: 560 }}>
                    {detailText(a.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {create && <UserForm onClose={() => setCreate(false)} onSaved={() => void load()} />}
      {reset && <ResetForm user={reset} onClose={() => setReset(undefined)} onSaved={() => void load()} />}
    </>
  );
}

function UserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast);
  const [f, setF] = useState({ username: '', displayName: '', role: 'planificador' as Role, password: '' });
  const [error, setError] = useState<string>();
  async function save() {
    try {
      await adminApi.create(f);
      toast('ok', `Usuario ${f.username} creado. Deberá cambiar la contraseña en su primer acceso.`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="Nuevo usuario"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!f.username || !f.password} onClick={() => void save()}>
            Crear usuario
          </button>
        </>
      }
    >
      <div className="fgrid">
        <div className="field">
          <label htmlFor="nu-user">Usuario</label>
          <input id="nu-user" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="nu-name">Nombre visible</label>
          <input id="nu-name" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="nu-role">Perfil</label>
          <select id="nu-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nu-pass">Contraseña inicial</label>
          <input id="nu-pass" type="password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          <span className="small muted">Al menos 10 caracteres, con letras y números.</span>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}

function ResetForm({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast);
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string>();
  async function save() {
    try {
      await adminApi.update(user.id, { password: pw });
      toast('ok', `Contraseña de ${user.username} restablecida. Se han cerrado sus sesiones.`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={`Restablecer contraseña de ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!pw} onClick={() => void save()}>
            Restablecer
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rs-pass">Contraseña temporal</label>
        <input id="rs-pass" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <span className="small muted">El usuario deberá cambiarla en su próximo acceso. Sus sesiones abiertas se cierran.</span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </Modal>
  );
}
