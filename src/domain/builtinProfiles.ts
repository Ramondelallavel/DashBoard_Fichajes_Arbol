import type { MappingProfile } from './types';
import { normalizeHeader } from '../lib/text';

/**
 * Perfiles de columnas incluidos para los formatos de Excel reales de la empresa.
 * Solo contienen NOMBRES DE COLUMNA y su significado (nunca datos). Se reconocen por la firma de
 * cabeceras y se aplican automáticamente; el usuario puede corregir cualquier asignación en el asistente.
 * La interpretación de cada columna está documentada en docs/DATOS_REALES.md.
 */
const sig = (headers: string[]) => headers.map(normalizeHeader).sort();
const map = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([h, f]) => [normalizeHeader(h), f]));

const VSM_HEADERS = ['FechaFin', 'SECC_CODIGO', 'SECC_NOMBRE', 'preo_codigo', 'preo_est_codigo', 'PreordSiguiente', 'ESTADO_PREO', 'ped_CodControl', 'semana', 'MesFin', 'fechaHora', 'FechaInicio', 'Porcentaje', 'preo_cargaTotal_h'];
const PLAN_HEADERS = ['InicioOrtems', 'FinOrtems', 'PT', 'Grupo_Nesting', 'Grupo_Op', 'Sem', 'CP', 'Mod', 'NT', 'NControl', 'InicioFab', 'SCC', 'SCCNombre', 'TGT', 'TGTNombre', 'PREO', 'EST', 'ORD', 'CARGA', 'DURACION', 'DesfaseSemana'];
const AUX_HEADERS = ['ord_IDplan', 'InicioOrtems', 'FinOrtems', 'PT', 'SCC', 'SCCNombre', 'ord_ped_codigo', 'ord_codigo', 'EST', 'TGT', 'TGTNombre', 'ord_Cantidad', 'ord_spr_codigorevision', 'spr_nombre', 'CARGA', 'Duracion'];

const BASE_OPTS = { dateOrder: 'DMY' as const, durationUnit: 'h' as const, decimalSeparator: 'auto' as const };

export const BUILTIN_PROFILES: MappingProfile[] = [
  {
    id: 'builtin-fichajes-vsm',
    name: 'Fichajes de preórdenes (VSM_CargaPpal)',
    builtin: true,
    kind: 'produccion',
    role: 'filas',
    headerSignature: sig(VSM_HEADERS),
    mapping: map({
      // Fechas de fichaje: ejecución REAL, no planificación
      FechaInicio: 'inicioReal',
      FechaFin: 'finReal',
      SECC_NOMBRE: 'seccion',
      preo_codigo: 'preordenId',
      PreordSiguiente: 'ordenPadreId',
      ESTADO_PREO: 'estado',
      ped_CodControl: 'aparatoId',
      Porcentaje: 'avance',
      preo_cargaTotal_h: 'duracion',
    }),
    options: { ...BASE_OPTS, repeatedKeys: 'consolidar' },
    updatedAt: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'builtin-ortems-datosplan',
    name: 'Ortems · DatosPlan',
    builtin: true,
    kind: 'ortems',
    role: 'filas',
    headerSignature: sig(PLAN_HEADERS),
    mapping: map({
      InicioOrtems: 'inicio',
      FinOrtems: 'fin',
      PT: 'puestoId',
      Sem: 'periodo',
      CP: 'familia',
      Mod: 'modelo',
      NControl: 'aparatoId',
      SCCNombre: 'seccion',
      TGT: 'articuloRef',
      TGTNombre: 'articuloDesc',
      PREO: 'preordenId',
      EST: 'estadoPlanificacion',
      ORD: 'ordenId',
      CARGA: 'duracion',
    }),
    options: BASE_OPTS,
    updatedAt: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'builtin-ortems-aux',
    name: 'Ortems · DatosPlan_Aux (órdenes auxiliares)',
    builtin: true,
    kind: 'ortems',
    role: 'filas',
    headerSignature: sig(AUX_HEADERS),
    mapping: map({
      InicioOrtems: 'inicio',
      FinOrtems: 'fin',
      PT: 'puestoId',
      SCCNombre: 'seccion',
      ord_codigo: 'ordenId',
      EST: 'estadoPlanificacion',
      TGT: 'articuloRef',
      TGTNombre: 'articuloDesc',
      ord_Cantidad: 'cantidad',
      CARGA: 'duracion',
    }),
    options: BASE_OPTS,
    updatedAt: '2026-11-20T00:00:00.000Z',
  },
];
