import { useState, type FormEvent, type ReactNode } from 'react';
import { useApp } from '../../data/store';
import { BrandMark } from '../components/Icon';
import { Modal, Notice } from '../components/common';

function Frame({ children, title, lead }: { children: ReactNode; title: string; lead: string }) {
  return (
    <div className="login-wrap">
      <div className="login-card panel">
        <div className="panel-body stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <BrandMark />
            <div>
              <strong style={{ fontFamily: 'var(--font-cond)', fontSize: 17 }}>Planificación industrial</strong>
              <div className="small muted">Gantt · Ortems · Capacidad</div>
            </div>
          </div>
          <div>
            <h1 style={{ fontSize: 20 }}>{title}</h1>
            <p className="small muted" style={{ marginTop: 4 }}>
              {lead}
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const login = useApp((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Iniciar sesión" lead="Acceda con su usuario. Los datos de planificación son compartidos por todos los usuarios del servidor.">
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="lg-user">Usuario</label>
          <input id="lg-user" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="lg-pass">Contraseña</label>
          <input id="lg-pass" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </Frame>
  );
}

function PasswordForm({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const changePassword = useApp((s) => s.changePassword);
  const toast = useApp((s) => s.toast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await changePassword(current, next);
      toast('ok', 'Contraseña cambiada.');
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="pw-cur">Contraseña actual</label>
        <input id="pw-cur" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="pw-new">Nueva contraseña</label>
        <input id="pw-new" type="password" className="input" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        <span className="small muted">Al menos 10 caracteres, con letras y números.</span>
      </div>
      <div className="field">
        <label htmlFor="pw-rep">Repita la nueva contraseña</label>
        <input id="pw-rep" type="password" className="input" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !current || !next || !repeat}>
          Cambiar contraseña
        </button>
      </div>
    </form>
  );
}

export function ForcePasswordPage() {
  const logout = useApp((s) => s.logout);
  return (
    <Frame title="Cambie su contraseña" lead="Es su primer acceso o un administrador ha restablecido su contraseña. Elija una contraseña personal para continuar.">
      <PasswordForm />
      <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
        Cerrar sesión
      </button>
    </Frame>
  );
}

export function PasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      <PasswordForm onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}
