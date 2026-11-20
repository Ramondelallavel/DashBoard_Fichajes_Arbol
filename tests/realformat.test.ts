import { describe, expect, it } from 'vitest';
import { analyzeSheet, autoImport, DEFAULT_PARSE_OPTIONS } from '../src/import/pipeline';
import { mergeSettings } from '../src/domain/settings';
import { aparatoMatchKey, runAnalysis } from '../src/engine/analysis';
import { applyFilters, EMPTY_FILTERS } from '../src/engine/filters';
import type { SheetGrid } from '../src/import/values';
import { dataset, ort, prod } from './helpers';

/*
 * Ficheros con la MISMA ESTRUCTURA de columnas que los Excel reales de la empresa (fichajes VSM_CargaPpal y
 * Ortems DatosPlan / DatosPlan_Aux), pero con valores FICTICIOS. No contienen ningún dato industrial real.
 */
const VSM = ['FechaFin', 'SECC_CODIGO', 'SECC_NOMBRE', 'preo_codigo', 'preo_est_codigo', 'PreordSiguiente', 'ESTADO_PREO', 'ped_CodControl', 'semana', 'MesFin', 'fechaHora', 'FechaInicio', 'Porcentaje', 'preo_cargaTotal_h'];
const PLAN = ['InicioOrtems', 'FinOrtems', 'PT', 'Grupo_Nesting', 'Grupo_Op', 'Sem', 'CP', 'Mod', 'NT', 'NControl', 'InicioFab', 'SCC', 'SCCNombre', 'TGT', 'TGTNombre', 'PREO', 'EST', 'ORD', 'CARGA', 'DURACION', 'DesfaseSemana'];
const AUX = ['ord_IDplan', 'InicioOrtems', 'FinOrtems', 'PT', 'SCC', 'SCCNombre', 'ord_ped_codigo', 'ord_codigo', 'EST', 'TGT', 'TGTNombre', 'ord_Cantidad', 'ord_spr_codigorevision', 'spr_nombre', 'CARGA', 'Duracion'];

const dt = (d: number, m: number, h = 0) => new Date(2026, m - 1, d, h, 0);

type V = Record<string, unknown>;
const rowOf = (headers: string[], v: V) => headers.map((h) => (v[h] ?? null) as never);

function fichaje(v: { preo: string; sig: string; est: string; pct: number; ap: string; sec: string; ini: Date; fin: Date; h: number }): V {
  return { FechaFin: v.fin, SECC_CODIGO: '9', SECC_NOMBRE: v.sec, preo_codigo: v.preo, preo_est_codigo: '1', PreordSiguiente: v.sig, ESTADO_PREO: v.est, ped_CodControl: v.ap, semana: '1', MesFin: '1', fechaHora: v.fin, FechaInicio: v.ini, Porcentaje: v.pct, preo_cargaTotal_h: v.h };
}

const prodGrid: SheetGrid = {
  name: 'VSM_CargaPpal',
  rows: [
    VSM as never[],
    rowOf(VSM, fichaje({ preo: '9000001', sig: '9000010', est: 'FIN', pct: 100, ap: '0012345', sec: 'SOLD', ini: dt(26, 10, 8), fin: dt(26, 10, 16), h: 40 })),
    rowOf(VSM, fichaje({ preo: '9000002', sig: '9000010', est: 'FIN', pct: 100, ap: '0012345', sec: 'SOLD', ini: dt(2, 11, 8), fin: dt(2, 11, 16), h: 50 })),
    // misma preorden en dos fichajes: se consolida
    rowOf(VSM, fichaje({ preo: '9000003', sig: '9000099', est: 'EC', pct: 40, ap: '0012345', sec: 'SOLD', ini: dt(9, 11, 8), fin: dt(9, 11, 12), h: 60 })),
    rowOf(VSM, fichaje({ preo: '9000003', sig: '9000099', est: 'FIN', pct: 100, ap: '0012345', sec: 'SOLD', ini: dt(10, 11, 8), fin: dt(10, 11, 16), h: 60 })),
    rowOf(VSM, fichaje({ preo: '9000010', sig: '9000777', est: 'EC', pct: 50, ap: '0012345', sec: 'MONT', ini: dt(11, 11, 8), fin: dt(12, 11, 16), h: 10 })),
    rowOf(VSM, fichaje({ preo: '9000004', sig: '9000010', est: 'FIN', pct: 100, ap: '0012345', sec: 'SOLD', ini: dt(12, 11, 8), fin: dt(13, 11, 16), h: 30 })),
  ],
};

function plan(v: { preo: string; ord: string; nc: string; sec: string; pt: string; ini: Date; fin: Date; carga: number }): V {
  return { InicioOrtems: v.ini, FinOrtems: v.fin, PT: v.pt, Grupo_Nesting: '', Grupo_Op: '', Sem: '202648', CP: 'FAM1', Mod: 'M1', NT: '1', NControl: v.nc, InicioFab: v.ini, SCC: '9', SCCNombre: v.sec, TGT: 'ART-1', TGTNombre: 'Artículo de prueba', PREO: v.preo, EST: 'LAN', ORD: v.ord, CARGA: v.carga, DURACION: v.carga, DesfaseSemana: 0 };
}
const planGrid: SheetGrid = {
  name: 'DatosPlan',
  rows: [
    PLAN as never[],
    // ya terminada según los fichajes pero todavía planificada
    rowOf(PLAN, plan({ preo: '9000004', ord: '8000004', nc: '12345', sec: 'SOLD', pt: 'PT01', ini: dt(24, 11, 8), fin: dt(24, 11, 16), carga: 30 })),
    // siguiente de 9000003: solo en Ortems (trabajo futuro)
    rowOf(PLAN, plan({ preo: '9000099', ord: '8000099', nc: '12345', sec: 'SOLD', pt: 'PT01', ini: dt(23, 11, 8), fin: dt(27, 11, 16), carga: 200 })),
    rowOf(PLAN, plan({ preo: '9000500', ord: '8000500', nc: '777', sec: 'SOLD', pt: 'PT01', ini: dt(25, 11, 8), fin: dt(26, 11, 16), carga: 5 })),
    rowOf(PLAN, plan({ preo: '9000098', ord: '8000098', nc: 'V0012345', sec: 'PINT', pt: 'PT03', ini: dt(30, 11, 8), fin: dt(30, 11, 16), carga: 8 })),
  ],
};
const auxGrid: SheetGrid = {
  name: 'DatosPlan_Aux',
  rows: [
    AUX as never[],
    rowOf(AUX, { ord_IDplan: '1', InicioOrtems: dt(24, 11, 8), FinOrtems: dt(24, 11, 12), PT: 'PT02', SCC: '8', SCCNombre: 'MONT', ord_ped_codigo: '1', ord_codigo: '8100001', EST: 'LAN', TGT: 'ART-2', TGTNombre: 'Auxiliar', ord_Cantidad: 1, ord_spr_codigorevision: '', spr_nombre: '', CARGA: 4, Duracion: 4 }),
  ],
};

const settings = mergeSettings({ referenceDate: '2026-11-20' });

function importAll() {
  const p = autoImport('produccion', 'fichajes.xlsx', [{ grid: prodGrid, role: 'filas' }], settings, 'inicial', undefined, 'test');
  const o = autoImport('ortems', 'ortems.xlsx', [{ grid: planGrid, role: 'filas' }, { grid: auxGrid, role: 'filas' }], settings, 'inicial', undefined, 'test');
  return { p, o };
}

describe('Formato real de fichajes y Ortems (datos ficticios)', () => {
  it('reconoce los formatos conocidos por la firma de cabeceras y propone la asignación', () => {
    const an = analyzeSheet(prodGrid, 'produccion', 'filas', DEFAULT_PARSE_OPTIONS, []);
    expect(an.profile?.id).toBe('builtin-fichajes-vsm');
    const f = (h: string) => an.suggestions.find((s) => s.header === h)?.field;
    expect(f('preo_codigo')).toBe('preordenId');
    expect(f('FechaInicio')).toBe('inicioReal');
    expect(f('FechaFin')).toBe('finReal');
    expect(f('PreordSiguiente')).toBe('ordenPadreId');
    expect(analyzeSheet(planGrid, 'ortems', 'filas', DEFAULT_PARSE_OPTIONS, []).profile?.id).toBe('builtin-ortems-datosplan');
    expect(analyzeSheet(auxGrid, 'ortems', 'filas', DEFAULT_PARSE_OPTIONS, []).profile?.id).toBe('builtin-ortems-aux');
  });

  it('consolida las filas repetidas de una preorden sin marcarlas como duplicadas', () => {
    const { p } = importAll();
    const codes = p.result.issueStats.map((s) => s.code);
    expect(codes).toContain('FILAS_CONSOLIDADAS');
    expect(codes).not.toContain('CLAVE_DUPLICADA');
    const a = runAnalysis({ prod: p.dataset, settings, manual: [] });
    const o3 = a.model.ordenes.get('9000003')!;
    expect(o3.tipo).toBe('preorden');
    expect(o3.estado).toBe('terminada'); // estado del fichaje más reciente
    expect(o3.realStart).toBe(dt(9, 11, 8).getTime());
    expect(o3.realEnd).toBe(dt(10, 11, 16).getTime());
    expect(a.model.ops.get(o3.opKeys[0])!.avance).toBe(100);
    expect(a.model.ordenes.size).toBe(5);
    // Fechas de fichaje = ejecución real, nunca previstas
    expect(a.model.has).toMatchObject({ previstas: false, reales: true, puestos: false });
  });

  it('reconoce el padre planificado en Ortems y no inventa el que no existe en ningún fichero', () => {
    const { p, o } = importAll();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [] });
    const o3 = a.model.ordenes.get('9000003')!;
    expect(o3.parentId).toBe('9000099');
    expect(o3.parentExternal).toBe(true);
    expect(a.model.ordenes.get('9000001')!.parentId).toBe('9000010');
    expect(a.model.ordenes.get('9000010')!.childIds.sort()).toEqual(['9000001', '9000002', '9000004']);
    const pnf = a.model.quality.filter((q) => q.code === 'PADRE_NO_ENCONTRADO');
    expect(pnf.map((q) => q.ordenId)).toEqual(['9000010']);
    expect(pnf[0].severity).toBe('informativa');
  });

  it('elige Ortems como base del análisis futuro cuando producción solo trae ejecución real', () => {
    const { p, o } = importAll();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [] });
    expect(a.loadBase).toBe('ortems');
    expect(a.loadBaseReason).toMatch(/ejecución real/);
    expect(a.bottlenecks).toBe(a.bottlenecksBy.ortems);
    // la carga real cuenta en la sección aunque no haya puesto
    const sold = a.loadReal.secciones.get('SOLD')!;
    expect(sold.totalH).toBe(40 + 50 + 60 + 30);
    expect(a.loadReal.sinPuesto).toEqual([]);
    expect(a.load.ortems.secciones.get('SOLD')!.members).toEqual(['PT01']);
    // con la base forzada en Configuración
    const b = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings: mergeSettings({ referenceDate: '2026-11-20', load: { ...settings.load, base: 'produccion' } }), manual: [] });
    expect(b.loadBase).toBe('produccion');
  });

  it('calcula la capacidad demostrada por sección y avisa como ESTIMADO si el plan la supera', () => {
    const { p, o } = importAll();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [] });
    const row = a.demonstrated.rows.find((r) => r.seccion === 'SOLD')!;
    expect(row.history.map((h) => h.week)).toEqual(['2026-S44', '2026-S45', '2026-S46']);
    expect(row.maxH).toBeCloseTo(90); // S46: 60 h (9000003) + 30 h (9000004)
    const f = a.demonstrated.forecasts.find((x) => x.seccion === 'SOLD' && x.week === '2026-S48')!;
    expect(f.plannedH).toBeCloseTo(235);
    expect(f.ratio).toBeCloseTo(235 / 90);
    expect(f.message).toMatch(/Estimado/);
    const al = a.alerts.find((x) => x.type === 'SECCION_SATURADA' && x.seccion === 'SOLD');
    expect(al?.motivo).toMatch(/ESTIMADO/);
    // MONT tiene una sola semana de fichajes: no se afirma nada
    expect(a.demonstrated.forecasts.some((x) => x.seccion === 'MONT')).toBe(false);
  });

  it('empareja por preorden, resuelve el aparato con otra notación y detecta lo terminado aún planificado', () => {
    const { p, o } = importAll();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [] });
    const recs = o.dataset.records as { rid: string; preordenId?: string; ordenId?: string }[];
    const rid = (preo: string) => recs.find((r) => r.preordenId === preo)!.rid;
    expect(a.match.matches.get(rid('9000004'))?.target).toBe('9000004');
    // «12345» en Ortems = «0012345» en producción; «777» no existe en producción
    expect(a.ortemsAparato.get(rid('9000099'))).toBe('0012345');
    expect(a.ortemsAparato.has(rid('9000500'))).toBe(false);
    expect(a.aparatoCheck).toMatchObject({ comparados: 1, coincidentes: 1 });
    const row = a.comparison.byOrtemsRid.get(rid('9000004'))!;
    const d = row.discrepancies.find((x) => x.type === 'terminada_planificada');
    expect(d?.criticidad).toBe('alta'); // el plan es futuro: reserva capacidad para trabajo ya hecho
    // lo que solo está en Ortems es trabajo futuro sin fichajes: informativo, agrupado por aparato
    const only = a.comparison.byOrtemsRid.get(rid('9000099'))!;
    expect(only.level).toBe('solo_ortems');
    expect(only.aparatoId).toBe('0012345');
    expect(only.criticidad).toBe('informativa');
    // el filtro por aparato incluye los registros de Ortems resueltos
    const fr = applyFilters(a, { ...EMPTY_FILTERS, aparatos: ['0012345'] });
    expect(fr.ortemsOnly.has(rid('9000099'))).toBe(true);
    expect(fr.ortemsOnly.has(rid('9000500'))).toBe(false);
  });

  it('agrupa las alertas informativas para no saturar el listado', () => {
    const { p, o } = importAll();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [] });
    const info = a.alerts.filter((x) => x.type === 'ORTEMS_SIN_PRODUCCION');
    // 9000099 y 9000098 (aparato resuelto 0012345) → una sola alerta; 9000500 (aparato 777, solo en Ortems) y la auxiliar, aparte
    expect(info.length).toBe(3);
    const g = info.find((x) => x.aparatoId === '0012345')!;
    expect(g.title).toMatch(/2 registros del aparato 0012345/);
    expect(g.description).toMatch(/9000099/);
    expect(g.description).toMatch(/9000098/);
    expect(g.description).toMatch(/Además: solapamiento en ortems \(1\)/);
  });
});

describe('Clave de comparación del número de aparato', () => {
  it('normaliza sin modificar el original y no asigna si hay ambigüedad', () => {
    expect(aparatoMatchKey('V0012345', 'solo_digitos')).toBe('12345');
    expect(aparatoMatchKey('0012345', 'sin_ceros')).toBe('12345');
    expect(aparatoMatchKey('0012345', 'exacto')).toBe('0012345');
    expect(aparatoMatchKey('ABC', 'solo_digitos')).toBe('ABC');
    const s = mergeSettings({ referenceDate: '2026-11-20' });
    const prodDs = dataset('produccion', [prod({ ordenId: 'OF1', operacionId: '10', aparatoId: 'A12' }), prod({ ordenId: 'OF2', operacionId: '10', aparatoId: '012' })]);
    const ortDs = dataset('ortems', [ort({ ordenId: 'X9', aparatoId: '12', inicio: dt(24, 11, 8).getTime(), fin: dt(24, 11, 16).getTime() })]);
    const a = runAnalysis({ prod: prodDs, ortems: ortDs, settings: s, manual: [] });
    expect(a.ortemsAparato.size).toBe(0);
  });
});
