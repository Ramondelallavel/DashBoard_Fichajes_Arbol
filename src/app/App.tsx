import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../data/store';
import { ROLE_LABEL } from '../auth/roles';
import type { Role } from '../domain/types';
import { fmtDateTime } from '../lib/dates';
import { AnalysisProvider, useAnalysis } from './AnalysisContext';
import { useRoute, type Route } from './router';
import { BrandMark, Icon } from '../ui/components/Icon';
import { Busy, Notice, Toasts } from '../ui/components/common';
import { FilterPanel } from '../ui/filters/FilterPanel';
import { DashboardPage } from '../ui/pages/Dashboard';
import { GanttGeneralPage, GanttAparatoPage } from '../ui/pages/GanttPages';
import { ArbolPage, FichaAparatoPage } from '../ui/pages/Aparatos';
import { PuestosPage } from '../ui/pages/Puestos';
import { CargaPage } from '../ui/pages/Carga';
import { CuellosPage } from '../ui/pages/Cuellos';
import { ComparadorPage } from '../ui/pages/Comparador';
import { AlertasPage } from '../ui/pages/Alertas';
import { ConfiguracionPage } from '../ui/pages/Configuracion';
import { ForcePasswordPage, LoginPage, PasswordModal } from '../ui/pages/Login';

const ImportacionPage = lazy(() => import('../ui/pages/Importacion').then((m) => ({ default: m.ImportacionPage })));

const NAV: { route: Route; label: string; icon: string; group?: string }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Visión general' },
  { route: 'gantt', label: 'Gantt general', icon: 'gantt' },
  { route: 'gantt-aparato', label: 'Gantt por aparato', icon: 'aparato' },
  { route: 'arbol', label: 'Árbol de procesos', icon: 'tree', group: 'Fabricación' },
  { route: 'puestos', label: 'Puestos de trabajo', icon: 'puesto' },
  { route: 'carga', label: 'Análisis de carga', icon: 'load', group: 'Análisis' },
  { route: 'cuellos', label: 'Cuellos de botella', icon: 'bottleneck' },
  { route: 'ortems', label: 'Comparador de Ortems', icon: 'compare' },
  { route: 'alertas', label: 'Alertas e incidencias', icon: 'alert' },
  { route: 'importacion', label: 'Importación de Excel', icon: 'import', group: 'Datos' },
  { route: 'configuracion', label: 'Configuración', icon: 'settings' },
];

function applyTheme(t: 'system' | 'light' | 'dark') {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

export function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const theme = useApp((s) => s.theme);
  const needsLogin = useApp((s) => s.needsLogin);
  const mustChange = useApp((s) => s.sessionUser?.mustChange);
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => applyTheme(theme), [theme]);
  if (!ready)
    return (
      <div className="busy" style={{ background: 'var(--bg)' }}>
        <div>
          <span className="spinner" /> Conectando…
        </div>
      </div>
    );
  if (needsLogin || mustChange)
    return (
      <>
        {needsLogin ? <LoginPage /> : <ForcePasswordPage />}
        <Toasts />
      </>
    );
  return (
    <AnalysisProvider>
      <Shell />
    </AnalysisProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { analysis, error } = useAnalysis();
  const hasData = useApp((s) => !!(s.active.produccion || s.active.ortems));
  const waiting = hasData && !analysis && !error;
  const critical = analysis?.alerts.filter((a) => a.criticidad === 'critica').length ?? 0;
  useEffect(() => setNavOpen(false), [route]);
  useEffect(() => {
    document.querySelector('.content')?.scrollTo({ top: 0 });
  }, [route]);
  const pages: Record<Route, ReactNode> = {
    dashboard: <DashboardPage onFilters={() => setFiltersOpen(true)} />,
    gantt: <GanttGeneralPage onFilters={() => setFiltersOpen(true)} />,
    'gantt-aparato': <GanttAparatoPage />,
    arbol: <ArbolPage />,
    aparato: <FichaAparatoPage />,
    puestos: <PuestosPage onFilters={() => setFiltersOpen(true)} />,
    carga: <CargaPage onFilters={() => setFiltersOpen(true)} />,
    cuellos: <CuellosPage />,
    ortems: <ComparadorPage onFilters={() => setFiltersOpen(true)} />,
    alertas: <AlertasPage />,
    importacion: <ImportacionPage />,
    configuracion: <ConfiguracionPage />,
  };
  return (
    <div className="app">
      <nav className={`nav${navOpen ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="nav-brand">
          <BrandMark />
          <div>
            <strong>Planificación industrial</strong>
            <span>Gantt · Ortems · Capacidad</span>
          </div>
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.route}>
              {n.group && <div className="nav-group">{n.group}</div>}
              <a href={`#${n.route}`} aria-current={route === n.route || (route === 'aparato' && n.route === 'arbol') ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
                {n.route === 'alertas' && critical > 0 && <span className="nav-num" title={`${critical} alertas críticas`}>{critical}</span>}
              </a>
            </li>
          ))}
        </ul>
        <NavFoot />
      </nav>
      {navOpen && <div className="overlay" style={{ zIndex: 45 }} onClick={() => setNavOpen(false)} />}
      <div className="main">
        <TopBar onMenu={() => setNavOpen(true)} onFilters={() => setFiltersOpen(true)} />
        <RemoteChangeBanner />
        <main className="content" id="contenido">
          {error && (
            <div style={{ marginBottom: 16 }}>
              <Notice kind="error">Error al calcular el análisis: {error}. Revise la configuración o vuelva a importar los datos.</Notice>
            </div>
          )}
          <Suspense
            fallback={
              <div className="empty">
                <span className="spinner" />
              </div>
            }
          >
            {waiting && route !== 'importacion' && route !== 'configuracion' ? (
              <div className="empty" role="status">
                <span className="spinner" />
                <span className="big">Calculando el análisis…</span>
                Relacionando órdenes, comparando con Ortems y calculando la carga.
              </div>
            ) : (
              pages[route]
            )}
          </Suspense>
        </main>
      </div>
      {filtersOpen && <FilterPanel onClose={() => setFiltersOpen(false)} />}
      <Toasts />
      <Busy />
    </div>
  );
}

function NavFoot() {
  const storageMode = useApp((s) => s.storageMode);
  return (
    <div className="nav-foot">
      {storageMode === 'servidor'
        ? 'Modo servidor: datos compartidos por todos los usuarios y guardados en la base de datos del servidor.'
        : storageMode === 'indexeddb'
          ? 'Modo local: datos guardados solo en este navegador (IndexedDB). No se envían a ningún servidor.'
          : 'Almacenamiento no disponible: los datos se perderán al cerrar la página.'}
    </div>
  );
}

function RemoteChangeBanner() {
  const change = useApp((s) => s.remoteChange);
  const apply = useApp((s) => s.applyRemoteChange);
  if (!change) return null;
  return (
    <div className="remote-banner" role="status">
      <Icon name="info" />
      <span>
        {change.user ?? 'Otro usuario'} {change.action ?? 'ha modificado los datos'}
        {change.at ? ` (${fmtDateTime(new Date(change.at).getTime())})` : ''}. Lo que ve puede estar desactualizado.
      </span>
      <button className="btn btn-sm btn-primary" onClick={() => void apply()}>
        Actualizar ahora
      </button>
    </div>
  );
}

function UserMenu() {
  const user = useApp((s) => s.sessionUser);
  const logout = useApp((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  if (!user) return null;
  return (
    <div className="ms" style={{ position: 'relative' }}>
      <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{user.displayName}</span> <span className="pill pill-neutral">{ROLE_LABEL[user.role]}</span>
      </button>
      {open && (
        <div className="ms-pop" role="menu" style={{ left: 'auto', right: 0, minWidth: 220 }}>
          <span className="small muted" style={{ padding: '2px 6px' }}>
            Sesión iniciada como <strong>{user.username}</strong>
          </span>
          <button className="btn btn-ghost btn-sm" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => { setPw(true); setOpen(false); }}>
            Cambiar contraseña
          </button>
          <button className="btn btn-ghost btn-sm" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
      )}
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

function TopBar({ onMenu, onFilters }: { onMenu: () => void; onFilters: () => void }) {
  const active = useApp((s) => s.active);
  const batches = useApp((s) => s.batches);
  const role = useApp((s) => s.role);
  const setRole = useApp((s) => s.setRole);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const mode = useApp((s) => s.mode);
  const { analysis, stale, computing } = useAnalysis();
  const chip = (kind: 'produccion' | 'ortems') => {
    const ds = active[kind];
    const b = ds ? batches.find((x) => x.id === ds.batchId) : undefined;
    return (
      <span className="src-chip" title={b ? `${b.fileName} · importado ${fmtDateTime(new Date(b.importedAt).getTime())} por ${b.user}` : 'Sin datos importados'}>
        <span className={`sw ${kind === 'produccion' ? 'sw-prod' : 'sw-ortems'}`} />
        {kind === 'produccion' ? 'Producción' : 'Ortems'}
        <strong className="mono">{ds ? `v${ds.version}` : '—'}</strong>
        <span className="muted">{b ? fmtDateTime(new Date(b.importedAt).getTime()) : 'sin importar'}</span>
      </span>
    );
  };
  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-sm menu-btn" onClick={onMenu} aria-label="Abrir menú">
        <Icon name="menu" />
      </button>
      <div className="data-status">
        {chip('produccion')}
        {chip('ortems')}
        {analysis && (
          <span className="src-chip" title="Fecha usada para retrasos y análisis futuro (configurable)">
            <Icon name="calendar" style={{ width: 13, height: 13 }} /> Referencia {fmtDateTime(analysis.refMs).slice(0, 10)}
          </span>
        )}
        {(stale || computing) && (
          <span className="src-chip" role="status">
            <span className="spinner" style={{ width: 12, height: 12 }} /> {computing ? 'Recalculando…' : 'Filtrando…'}
          </span>
        )}
      </div>
      <div className="spacer" />
      <div className="topbar-tools">
        {analysis && (
          <button className="btn btn-sm" onClick={onFilters}>
            <Icon name="filter" /> Filtros
          </button>
        )}
        {mode === 'servidor' ? (
          <UserMenu />
        ) : (
          <label className="row small" style={{ gap: 6 }} title="Modo local sin servidor: el perfil se elige aquí solo para probar los permisos">
            <span className="muted">Perfil (local)</span>
            <select className="input input-sm" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Perfil de usuario (modo local)">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')}
          aria-label={`Tema: ${theme === 'system' ? 'según el sistema' : theme === 'dark' ? 'oscuro' : 'claro'}. Cambiar`}
          title={`Tema: ${theme === 'system' ? 'sistema' : theme === 'dark' ? 'oscuro' : 'claro'}`}
        >
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'eye'} />
        </button>
      </div>
    </header>
  );
}
