import type { Settings } from '../domain/settings';
import type {
  DatasetVersion,
  ImportBatch,
  ImportMode,
  MappingProfile,
  ParseOptions,
  RecordDiff,
  DiffSummary,
  SheetImportConfig,
  SheetRole,
  SourceKind,
} from '../domain/types';
import { uid } from '../lib/text';
import { BUILTIN_PROFILES } from '../domain/builtinProfiles';
import { detectHeaderRow, headersAt, type HeaderDetection } from './header';
import { findProfile, headerSignature, mappingToProfileMapping, suggestMapping, type ColumnSuggestion } from './mapping';
import { normalizeImport, type NormalizeResult } from './normalize';
import { toRawCell, type SheetGrid } from './values';
import { buildDatasetVersion, diffRecords } from './versioning';

export const DEFAULT_PARSE_OPTIONS: ParseOptions = { dateOrder: 'DMY', durationUnit: 'h', decimalSeparator: 'auto' };

export interface SheetAnalysis {
  grid: SheetGrid;
  header: HeaderDetection;
  headerIndex: number;
  headers: string[];
  dataRows: number;
  suggestions: ColumnSuggestion[];
  profile?: MappingProfile;
}

export function analyzeSheet(
  grid: SheetGrid,
  kind: SourceKind,
  role: SheetRole,
  opts: ParseOptions,
  profiles: MappingProfile[],
  headerIndex?: number,
): SheetAnalysis {
  const header = detectHeaderRow(grid);
  const idx = headerIndex ?? header.index;
  const headers = headersAt(grid, idx);
  // Primero los perfiles del usuario; si ninguno encaja, los formatos conocidos incluidos en la aplicación
  const profile = findProfile(profiles, kind, role, headers) ?? findProfile(BUILTIN_PROFILES, kind, role, headers);
  const samples = grid.rows.slice(idx + 1, idx + 41).map((r) => r.map(toRawCell));
  const suggestions = suggestMapping(headers, samples, kind, role, profile?.options ?? opts, profile);
  const dataRows = grid.rows.slice(idx + 1).filter((r) => r.some((c) => c !== null && c !== '')).length;
  return { grid, header, headerIndex: idx, headers, dataRows, suggestions, profile };
}

export function suggestionsToMapping(s: ColumnSuggestion[]): Record<number, string> {
  const m: Record<number, string> = {};
  for (const x of s) if (x.field) m[x.col] = x.field;
  return m;
}

export interface PrepareInput {
  kind: SourceKind;
  fileName: string;
  fileSize: number;
  fileHash: string;
  sheets: { grid: SheetGrid; config: SheetImportConfig }[];
  options: ParseOptions;
  mode: ImportMode;
  previous?: DatasetVersion;
  settings: Settings;
  user: string;
  profileId?: string;
  now?: Date;
}

export interface PreparedImport {
  batch: ImportBatch;
  result: NormalizeResult;
  dataset: DatasetVersion;
  diff?: { diffs: RecordDiff[]; summary: DiffSummary };
}

/** Normaliza, valida y construye la nueva versión. No guarda nada: eso lo hace el repositorio al confirmar. */
export function prepareImport(input: PrepareInput): PreparedImport {
  const now = input.now ?? new Date();
  const batchId = uid('imp');
  const result = normalizeImport({ kind: input.kind, batchId, sheets: input.sheets, options: input.options, settings: input.settings });
  const dataset = buildDatasetVersion(input.kind, input.mode, batchId, result.records, input.previous, result.masters, now);
  const diff = input.previous && input.mode !== 'sustitucion' ? diffRecords(input.kind, input.previous.records, dataset.records) : undefined;
  const batch: ImportBatch = {
    id: batchId,
    kind: input.kind,
    fileName: input.fileName,
    fileSize: input.fileSize,
    fileHash: input.fileHash,
    importedAt: now.toISOString(),
    user: input.user,
    mode: input.mode,
    sheets: input.sheets.map((s) => s.config),
    options: input.options,
    profileId: input.profileId,
    counts: result.counts,
    status: 'activa',
    datasetVersion: dataset.version,
    unknownColumns: result.unknownColumns,
    diffSummary: diff?.summary,
  };
  return { batch, result, dataset, diff };
}

export function buildProfile(name: string, kind: SourceKind, role: SheetRole, headers: string[], mapping: Record<number, string>, options: ParseOptions, existing?: MappingProfile): MappingProfile {
  return {
    id: existing?.id ?? uid('perfil'),
    name,
    kind,
    role,
    headerSignature: headerSignature(headers),
    mapping: mappingToProfileMapping(headers, mapping),
    options,
    updatedAt: new Date().toISOString(),
  };
}

/** Importación automática completa (asignación propuesta sin intervención). Se usa para los datos de demostración. */
export function autoImport(
  kind: SourceKind,
  fileName: string,
  sheets: { grid: SheetGrid; role: SheetRole }[],
  settings: Settings,
  mode: ImportMode,
  previous: DatasetVersion | undefined,
  user: string,
  now?: Date,
): PreparedImport {
  let options: ParseOptions = DEFAULT_PARSE_OPTIONS;
  const configured = sheets.map(({ grid, role }) => {
    const an = analyzeSheet(grid, kind, role, DEFAULT_PARSE_OPTIONS, []);
    if (an.profile) options = { ...options, ...an.profile.options };
    const config: SheetImportConfig = { sheet: grid.name, role, headerRow: an.headerIndex + 1, mapping: suggestionsToMapping(an.suggestions) };
    return { grid, config };
  });
  return prepareImport({ kind, fileName, fileSize: 0, fileHash: 'demo', sheets: configured, options, mode, previous, settings, user, now });
}
