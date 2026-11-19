import { create } from 'zustand';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../domain/settings';
import type { AlertReview, DatasetVersion, ImportBatch, ManualRelation, MappingProfile, ReviewState, Role } from '../domain/types';
import { EMPTY_FILTERS, type FilterState } from '../engine/filters';
import { generateDemo } from '../demo/demoData';
import { autoImport, type PreparedImport } from '../import/pipeline';
import { uid } from '../lib/text';
import { ApiBackend, ApiError, authApi, detectServer, type Backend, type ChangeInfo, type SessionUser } from './backend';
import { Repository, type SavedFilter, type VersionMeta } from './repository';
import { MemoryKV, openStorage } from './storage';

export type Theme = 'system' | 'light' | 'dark';

export interface Toast {
  id: string;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

export interface AppState {
  ready: boolean;
  mode: 'local' | 'servidor';
  storageMode: 'indexeddb' | 'memoria' | 'servidor';
  repo?: Backend;
  sessionUser?: SessionUser;
  needsLogin: boolean;
  revision: number;
  remoteChange?: ChangeInfo;
  batches: ImportBatch[];
  versions: VersionMeta[];
  active: { produccion?: DatasetVersion; ortems?: DatasetVersion; ortemsPrev?: DatasetVersion };
  profiles: MappingProfile[];
  settings: Settings;
  reviews: Record<string, AlertReview>;
  manual: ManualRelation[];
  savedFilters: SavedFilter[];
  filters: FilterState;
  role: Role;
  user: string;
  theme: Theme;
  selectedAparato?: string;
  selectedPuesto?: string;
  toasts: Toast[];
  busy?: string;

  init(): Promise<void>;
  reload(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  applyRemoteChange(): Promise<void>;
  commitImport(p: PreparedImport): Promise<void>;
  loadDemo(): Promise<void>;
  resetData(): Promise<void>;
  setSettings(s: Settings): Promise<void>;
  saveProfile(p: MappingProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  setReview(alertId: string, state: ReviewState, note?: string): Promise<void>;
  addManual(m: Omit<ManualRelation, 'id' | 'at' | 'user'>): Promise<void>;
  removeManual(id: string): Promise<void>;
  setFilters(f: FilterState): void;
  saveFilter(name: string): Promise<void>;
  deleteFilter(id: string): Promise<void>;
  setRole(r: Role): void;
  setTheme(t: Theme): void;
  selectAparato(id?: string): void;
  selectPuesto(id?: string): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: string): void;
}

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* preferencias locales opcionales */
  }
}

/** Intervalo de comprobación de cambios de otros usuarios (modo servidor). */
const POLL_MS = 30_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const EMPTY_DATA = { batches: [], versions: [], active: {}, profiles: [], reviews: {}, manual: [], savedFilters: [] };

export const useApp = create<AppState>((set, get) => {
  /** Ejecuta una operación sobre los datos; en modo servidor gestiona la sesión caducada y los errores. */
  async function guarded<T>(fn: () => Promise<T>, errorPrefix = 'No se pudo guardar'): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ needsLogin: true, sessionUser: undefined });
        get().toast('error', 'La sesión ha caducado. Vuelva a iniciar sesión.');
        return undefined;
      }
      get().toast('error', `${errorPrefix}: ${(e as Error).message}`);
      throw e;
    }
  }
  /** Tras un cambio propio, se actualiza la revisión conocida para no avisar de él como si fuera de otro usuario. */
  async function syncRevision() {
    const repo = get().repo;
    if (repo?.revision) {
      const r = await repo.revision().catch(() => undefined);
      if (r) set({ revision: r.revision, remoteChange: undefined });
    }
  }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const { repo, revision, needsLogin } = get();
      if (!repo?.revision || needsLogin || (typeof document !== 'undefined' && document.hidden)) return;
      try {
        const r = await repo.revision();
        if (r.revision > revision) set({ remoteChange: r });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) set({ needsLogin: true, sessionUser: undefined });
      }
    }, POLL_MS);
  }

  return {
    ready: false,
    mode: 'local',
    storageMode: 'memoria',
    needsLogin: false,
    revision: 0,
    batches: [],
    versions: [],
    active: {},
    profiles: [],
    settings: DEFAULT_SETTINGS,
    reviews: {},
    manual: [],
    savedFilters: [],
    filters: EMPTY_FILTERS,
    role: readPref<Role>('pi.role', 'planificador'),
    user: 'usuario local',
    theme: readPref<Theme>('pi.theme', 'system'),
    toasts: [],

    async init() {
      if (await detectServer()) {
        set({ mode: 'servidor', storageMode: 'servidor', repo: new ApiBackend() });
        try {
          const { user } = await authApi.session();
          if (!user) set({ needsLogin: true });
          else {
            set({ sessionUser: user, role: user.role, user: user.displayName });
            if (!user.mustChange) {
              await get().reload();
              startPolling();
            }
          }
        } catch {
          set({ needsLogin: true });
        }
        set({ ready: true });
        return;
      }
      const kv = await openStorage().catch(() => new MemoryKV());
      const repo = new Repository(kv);
      set({ repo, storageMode: kv.mode, mode: 'local' });
      await get().reload();
      set({ ready: true });
    },

    async reload() {
      const repo = get().repo;
      if (!repo) return;
      const st = await guarded(() => repo.load(), 'No se pudieron cargar los datos');
      if (!st) return;
      set({ ...st, revision: st.revision ?? get().revision, remoteChange: undefined });
    },

    async login(username, password) {
      const { user } = await authApi.login(username, password);
      set({ sessionUser: user, role: user.role, user: user.displayName, needsLogin: false, filters: EMPTY_FILTERS });
      if (!user.mustChange) {
        await get().reload();
        startPolling();
      }
    },

    async logout() {
      await authApi.logout().catch(() => undefined);
      if (pollTimer) clearInterval(pollTimer);
      set({ sessionUser: undefined, needsLogin: true, ...EMPTY_DATA, settings: DEFAULT_SETTINGS, filters: EMPTY_FILTERS, selectedAparato: undefined });
    },

    async changePassword(current, next) {
      const { user } = await authApi.changePassword(current, next);
      const wasForced = get().sessionUser?.mustChange;
      set({ sessionUser: user });
      if (wasForced) {
        await get().reload();
        startPolling();
      }
    },

    async applyRemoteChange() {
      await get().reload();
    },

    async commitImport(p) {
      const { repo, settings, active } = get();
      if (!repo) return;
      const basedOn = active[p.batch.kind]?.version ?? null;
      await guarded(() => repo.commitImport(p, settings.keepVersions, basedOn), 'No se pudo guardar la importación');
      await get().reload();
      await syncRevision();
    },

    async loadDemo() {
      const { repo } = get();
      if (!repo) return;
      set({ busy: 'Generando y cargando datos de demostración…' });
      try {
        await new Promise((r) => setTimeout(r, 30));
        const demo = generateDemo();
        const base = mergeSettings(get().settings);
        const settings: Settings = {
          ...base,
          referenceDate: null,
          capacities: { ...demo.capacities },
          calendar: { ...base.calendar, holidays: [...new Set([...base.calendar.holidays, ...demo.holidays])].sort() },
        };
        await guarded(async () => {
          await repo.resetData();
          await repo.saveSettings(settings);
          const user = get().sessionUser ? `${get().user} (${get().role})` : 'demo';
          const prod = autoImport('produccion', 'produccion_ficticia.xlsx', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, 'inicial', undefined, user);
          await repo.commitImport(prod, settings.keepVersions, null);
          const prevDate = new Date(Date.now() - 7 * 86_400_000);
          const o1 = autoImport('ortems', 'ortems_ficticio_semana_anterior.xlsx', [{ grid: demo.ortemsPrev, role: 'filas' }], settings, 'inicial', undefined, user, prevDate);
          await repo.commitImport(o1, settings.keepVersions, null);
          const o2 = autoImport('ortems', 'ortems_ficticio.xlsx', [{ grid: demo.ortems, role: 'filas' }], settings, 'actualizacion', o1.dataset, user);
          await repo.commitImport(o2, settings.keepVersions, o1.dataset.version);
        }, 'No se pudieron cargar los datos de demostración');
        await get().reload();
        await syncRevision();
        set({ filters: EMPTY_FILTERS, selectedAparato: undefined });
        get().toast('ok', 'Datos de demostración cargados (ficticios): 2 importaciones de Ortems y 1 de producción.');
      } catch {
        /* el error ya se ha notificado */
      } finally {
        set({ busy: undefined });
      }
    },

    async resetData() {
      const repo = get().repo;
      if (!repo) return;
      await guarded(() => repo.resetData(), 'No se pudieron borrar los datos');
      await get().reload();
      await syncRevision();
      set({ selectedAparato: undefined, filters: EMPTY_FILTERS });
    },

    async setSettings(s) {
      const { repo, settings: prev } = get();
      set({ settings: s });
      try {
        await guarded(() => repo!.saveSettings(s), 'No se pudo guardar la configuración');
        await syncRevision();
      } catch {
        set({ settings: prev });
      }
    },

    async saveProfile(p) {
      await guarded(() => get().repo!.saveProfile(p), 'No se pudo guardar el perfil');
      set({ profiles: [...get().profiles.filter((x) => x.id !== p.id), p] });
    },
    async deleteProfile(id) {
      await guarded(() => get().repo!.deleteProfile(id), 'No se pudo eliminar el perfil');
      set({ profiles: get().profiles.filter((x) => x.id !== id) });
    },

    async setReview(alertId, state, note) {
      const prev = get().reviews[alertId];
      const draft: AlertReview = {
        alertId,
        state,
        note: note ?? prev?.note,
        user: `${get().user} (${get().role})`,
        updatedAt: new Date().toISOString(),
        firstSeen: prev?.firstSeen ?? new Date().toISOString(),
      };
      const saved = await guarded(() => get().repo!.saveReview(draft), 'No se pudo guardar la revisión').catch(() => undefined);
      if (saved) {
        set({ reviews: { ...get().reviews, [alertId]: saved } });
        await syncRevision();
      }
    },

    async addManual(m) {
      const full: ManualRelation = { ...m, id: `${m.kind}:${m.ordenId}`, at: new Date().toISOString(), user: `${get().user} (${get().role})` };
      const saved = await guarded(() => get().repo!.saveManual(full), 'No se pudo guardar la validación').catch(() => undefined);
      if (saved) {
        set({ manual: [...get().manual.filter((x) => x.id !== saved.id), saved] });
        await syncRevision();
      }
    },
    async removeManual(id) {
      await guarded(() => get().repo!.deleteManual(id), 'No se pudo deshacer la validación').catch(() => undefined);
      set({ manual: get().manual.filter((x) => x.id !== id) });
      await syncRevision();
    },

    setFilters(f) {
      set({ filters: f });
    },
    async saveFilter(name) {
      const f: SavedFilter = { id: uid('filtro'), name, filters: get().filters, createdAt: new Date().toISOString() };
      await guarded(() => get().repo!.saveFilter(f), 'No se pudo guardar el filtro').catch(() => undefined);
      set({ savedFilters: [...get().savedFilters, f] });
    },
    async deleteFilter(id) {
      await guarded(() => get().repo!.deleteFilter(id), 'No se pudo eliminar el filtro').catch(() => undefined);
      set({ savedFilters: get().savedFilters.filter((x) => x.id !== id) });
    },

    setRole(r) {
      // En modo servidor el perfil lo determina la sesión: no se puede cambiar desde la interfaz
      if (get().mode === 'servidor') return;
      writePref('pi.role', r);
      set({ role: r });
    },
    setTheme(t) {
      writePref('pi.theme', t);
      set({ theme: t });
    },
    selectAparato(id) {
      set({ selectedAparato: id });
    },
    selectPuesto(id) {
      set({ selectedPuesto: id });
    },
    toast(kind, text) {
      const id = uid('t');
      set({ toasts: [...get().toasts, { id, kind, text }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
});
