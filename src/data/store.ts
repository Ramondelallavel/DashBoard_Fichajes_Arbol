import { create } from 'zustand';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../domain/settings';
import type { AlertReview, DatasetVersion, ImportBatch, ManualRelation, MappingProfile, ReviewState, Role } from '../domain/types';
import { EMPTY_FILTERS, type FilterState } from '../engine/filters';
import { generateDemo } from '../demo/demoData';
import { autoImport, type PreparedImport } from '../import/pipeline';
import { uid } from '../lib/text';
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
  storageMode: 'indexeddb' | 'memoria';
  repo?: Repository;
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

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  storageMode: 'memoria',
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
    const kv = await openStorage().catch(() => new MemoryKV());
    const repo = new Repository(kv);
    set({ repo, storageMode: kv.mode });
    await get().reload();
    set({ ready: true });
  },

  async reload() {
    const repo = get().repo;
    if (!repo) return;
    const st = await repo.load();
    set({ ...st });
  },

  async commitImport(p) {
    const { repo, settings } = get();
    if (!repo) return;
    await repo.commitImport(p, settings.keepVersions);
    await get().reload();
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
      await repo.resetData();
      await repo.saveSettings(settings);
      const user = 'demo';
      const prod = autoImport('produccion', 'produccion_ficticia.xlsx', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, 'inicial', undefined, user);
      await repo.commitImport(prod, settings.keepVersions);
      const prevDate = new Date(Date.now() - 7 * 86_400_000);
      const o1 = autoImport('ortems', 'ortems_ficticio_semana_anterior.xlsx', [{ grid: demo.ortemsPrev, role: 'filas' }], settings, 'inicial', undefined, user, prevDate);
      await repo.commitImport(o1, settings.keepVersions);
      const o2 = autoImport('ortems', 'ortems_ficticio.xlsx', [{ grid: demo.ortems, role: 'filas' }], settings, 'actualizacion', o1.dataset, user);
      await repo.commitImport(o2, settings.keepVersions);
      await get().reload();
      set({ filters: EMPTY_FILTERS, selectedAparato: undefined });
      get().toast('ok', 'Datos de demostración cargados (ficticios): 2 importaciones de Ortems y 1 de producción.');
    } finally {
      set({ busy: undefined });
    }
  },

  async resetData() {
    const repo = get().repo;
    if (!repo) return;
    await repo.resetData();
    await get().reload();
    set({ selectedAparato: undefined, filters: EMPTY_FILTERS });
  },

  async setSettings(s) {
    const repo = get().repo;
    set({ settings: s });
    await repo?.saveSettings(s);
  },

  async saveProfile(p) {
    await get().repo?.saveProfile(p);
    set({ profiles: [...get().profiles.filter((x) => x.id !== p.id), p] });
  },
  async deleteProfile(id) {
    await get().repo?.deleteProfile(id);
    set({ profiles: get().profiles.filter((x) => x.id !== id) });
  },

  async setReview(alertId, state, note) {
    const prev = get().reviews[alertId];
    const r: AlertReview = {
      alertId,
      state,
      note: note ?? prev?.note,
      user: `${get().user} (${get().role})`,
      updatedAt: new Date().toISOString(),
      firstSeen: prev?.firstSeen ?? new Date().toISOString(),
    };
    await get().repo?.saveReview(r);
    set({ reviews: { ...get().reviews, [alertId]: r } });
  },

  async addManual(m) {
    const full: ManualRelation = { ...m, id: `${m.kind}:${m.ordenId}`, at: new Date().toISOString(), user: `${get().user} (${get().role})` };
    await get().repo?.saveManual(full);
    set({ manual: [...get().manual.filter((x) => x.id !== full.id), full] });
  },
  async removeManual(id) {
    await get().repo?.deleteManual(id);
    set({ manual: get().manual.filter((x) => x.id !== id) });
  },

  setFilters(f) {
    set({ filters: f });
  },
  async saveFilter(name) {
    const f: SavedFilter = { id: uid('filtro'), name, filters: get().filters, createdAt: new Date().toISOString() };
    await get().repo?.saveFilter(f);
    set({ savedFilters: [...get().savedFilters, f] });
  },
  async deleteFilter(id) {
    await get().repo?.deleteFilter(id);
    set({ savedFilters: get().savedFilters.filter((x) => x.id !== id) });
  },

  setRole(r) {
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
}));
