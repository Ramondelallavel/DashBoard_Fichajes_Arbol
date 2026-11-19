import { mergeSettings, type Settings } from '../domain/settings';
import type { AlertReview, DatasetVersion, ImportBatch, ManualRelation, MappingProfile, RawSheet, SourceKind } from '../domain/types';
import type { FilterState } from '../engine/filters';
import type { PreparedImport } from '../import/pipeline';
import type { KV } from './storage';

export interface VersionMeta {
  id: string;
  kind: SourceKind;
  version: number;
  createdAt: string;
  batchId: string;
  mode: DatasetVersion['mode'];
  records: number;
  purged?: boolean;
}

export interface ActivePointers {
  produccion?: string;
  ortems?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

export interface PersistedState {
  batches: ImportBatch[];
  versions: VersionMeta[];
  active: { produccion?: DatasetVersion; ortems?: DatasetVersion; ortemsPrev?: DatasetVersion };
  profiles: MappingProfile[];
  settings: Settings;
  reviews: Record<string, AlertReview>;
  manual: ManualRelation[];
  savedFilters: SavedFilter[];
}

/** Repositorio: única puerta de acceso a datos persistidos (separado de la interfaz y del cálculo). */
export class Repository {
  constructor(public kv: KV) {}

  async load(): Promise<PersistedState> {
    const [batches, versions, profiles, reviewsList, manual, savedFilters] = await Promise.all([
      this.kv.getAll<ImportBatch>('batches'),
      this.kv.get<VersionMeta[]>('meta', 'versions'),
      this.kv.getAll<MappingProfile>('profiles'),
      this.kv.getAll<AlertReview>('reviews'),
      this.kv.getAll<ManualRelation>('manual'),
      this.kv.getAll<SavedFilter>('filters'),
    ]);
    const settings = mergeSettings(await this.kv.get<Partial<Settings>>('settings', 'current'));
    const pointers = (await this.kv.get<ActivePointers>('meta', 'active')) ?? {};
    const active = await this.loadActive(pointers, versions ?? []);
    const reviews: Record<string, AlertReview> = {};
    for (const r of reviewsList) reviews[r.alertId] = r;
    batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    return { batches, versions: versions ?? [], active, profiles, settings, reviews, manual, savedFilters };
  }

  private async loadActive(p: ActivePointers, versions: VersionMeta[]) {
    const produccion = p.produccion ? await this.kv.get<DatasetVersion>('datasets', p.produccion) : undefined;
    const ortems = p.ortems ? await this.kv.get<DatasetVersion>('datasets', p.ortems) : undefined;
    let ortemsPrev: DatasetVersion | undefined;
    if (ortems) {
      const prev = versions.filter((v) => v.kind === 'ortems' && v.version < ortems.version && !v.purged).sort((a, b) => b.version - a.version)[0];
      if (prev) ortemsPrev = await this.kv.get<DatasetVersion>('datasets', prev.id);
    }
    return { produccion, ortems, ortemsPrev };
  }

  async getDataset(id: string) {
    return this.kv.get<DatasetVersion>('datasets', id);
  }

  async getRaw(batchId: string) {
    return this.kv.get<RawSheet[]>('raw', batchId);
  }

  /** Confirma una importación: guarda lote, datos originales y nueva versión; actualiza el historial. */
  async commitImport(prep: PreparedImport, keepVersions: number): Promise<void> {
    const { batch, dataset, result } = prep;
    const versions = (await this.kv.get<VersionMeta[]>('meta', 'versions')) ?? [];
    const pointers = (await this.kv.get<ActivePointers>('meta', 'active')) ?? {};
    const batches = await this.kv.getAll<ImportBatch>('batches');
    for (const b of batches) {
      if (b.kind !== batch.kind || b.status !== 'activa') continue;
      b.status = batch.mode === 'sustitucion' ? 'sustituida' : batch.mode === 'incremental' ? 'fusionada' : 'historica';
      await this.kv.set('batches', b.id, b);
    }
    await this.kv.set('raw', batch.id, result.rawSheets);
    await this.kv.set('datasets', dataset.id, dataset);
    await this.kv.set('batches', batch.id, batch);
    versions.push({ id: dataset.id, kind: dataset.kind, version: dataset.version, createdAt: dataset.createdAt, batchId: batch.id, mode: dataset.mode, records: dataset.records.length });
    // Conservar solo las últimas N versiones completas (los metadatos del historial se mantienen)
    const ofKind = versions.filter((v) => v.kind === batch.kind && !v.purged).sort((a, b) => b.version - a.version);
    for (const old of ofKind.slice(Math.max(1, keepVersions))) {
      await this.kv.del('datasets', old.id);
      old.purged = true;
    }
    pointers[batch.kind] = dataset.id;
    await this.kv.set('meta', 'versions', versions);
    await this.kv.set('meta', 'active', pointers);
  }

  async saveSettings(s: Settings) {
    await this.kv.set('settings', 'current', s);
  }
  async saveProfile(p: MappingProfile) {
    await this.kv.set('profiles', p.id, p);
  }
  async deleteProfile(id: string) {
    await this.kv.del('profiles', id);
  }
  async saveReview(r: AlertReview) {
    await this.kv.set('reviews', r.alertId, r);
  }
  async saveManual(m: ManualRelation) {
    await this.kv.set('manual', m.id, m);
  }
  async deleteManual(id: string) {
    await this.kv.del('manual', id);
  }
  async saveFilter(f: SavedFilter) {
    await this.kv.set('filters', f.id, f);
  }
  async deleteFilter(id: string) {
    await this.kv.del('filters', id);
  }
  /** Borra los datos importados y sus versiones (mantiene configuración y perfiles). */
  async resetData() {
    for (const s of ['batches', 'raw', 'datasets', 'reviews', 'manual'] as const) await this.kv.clear(s);
    await this.kv.del('meta', 'versions');
    await this.kv.del('meta', 'active');
  }
}
