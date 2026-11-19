import type { SheetRole, SourceKind } from './types';

/**
 * Catálogo de campos internos (canónicos) a los que se asignan las columnas de los Excel.
 * No se presupone ningún nombre de columna: los sinónimos solo sirven para PROPONER
 * una asignación que el usuario confirma o corrige en el asistente.
 */
export type FieldType = 'id' | 'text' | 'date' | 'number' | 'duration' | 'state' | 'priority';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  description: string;
  synonyms: string[];
}

const F = (key: string, label: string, type: FieldType, description: string, synonyms: string[]): FieldDef => ({
  key,
  label,
  type,
  description,
  synonyms,
});

export const PROD_FIELDS: FieldDef[] = [
  F('aparatoId', 'Número de aparato', 'id', 'Identificador del aparato (entidad principal).', [
    'n aparato', 'num aparato', 'numero aparato', 'aparato', 'cod aparato', 'id aparato', 'equipo', 'n equipo', 'num equipo', 'n serie', 'numero de serie', 'aparato principal',
  ]),
  F('articuloRef', 'Referencia de artículo', 'id', 'Código/referencia del artículo fabricado.', [
    'referencia', 'ref', 'ref articulo', 'articulo', 'cod articulo', 'codigo articulo', 'material', 'cod material', 'item', 'producto', 'referencia articulo',
  ]),
  F('articuloDesc', 'Descripción del artículo', 'text', 'Texto descriptivo del artículo o aparato.', [
    'descripcion', 'desc', 'descripcion articulo', 'denominacion', 'nombre articulo', 'texto articulo', 'designacion',
  ]),
  F('familia', 'Familia de aparato', 'text', 'Familia o tipo de aparato.', ['familia', 'familia aparato', 'tipo aparato', 'gama', 'linea producto', 'grupo producto', 'tipo']),
  F('ordenId', 'Número de orden', 'id', 'Orden de fabricación (OF).', [
    'n orden', 'num orden', 'numero orden', 'orden', 'of', 'n of', 'orden fabricacion', 'orden de fabricacion', 'ot', 'n ot', 'orden trabajo', 'work order', 'wo',
  ]),
  F('preordenId', 'Número de preorden', 'id', 'Preorden asociada a la orden (si existe).', ['preorden', 'n preorden', 'num preorden', 'pre orden', 'orden prevista', 'orden planificada', 'opl']),
  F('ordenPadreId', 'Orden padre', 'id', 'Orden de nivel superior (estructura). Si existe, la relación se considera confirmada.', [
    'orden padre', 'of padre', 'n orden padre', 'orden superior', 'padre', 'orden nivel superior', 'orden montaje',
  ]),
  F('operacionId', 'Identificador de operación', 'id', 'Número/código de operación o fase dentro de la orden.', [
    'operacion', 'op', 'n operacion', 'num operacion', 'cod operacion', 'fase', 'n fase', 'paso', 'secuencia operacion', 'n op',
  ]),
  F('operacionDesc', 'Descripción de operación', 'text', 'Texto de la operación (corte, mecanizado...).', [
    'descripcion operacion', 'desc operacion', 'texto operacion', 'nombre operacion', 'desc op', 'descripcion fase', 'operacion descripcion',
  ]),
  F('secuencia', 'Secuencia', 'number', 'Orden de ejecución explícito dentro de la orden.', ['secuencia', 'sec', 'orden secuencia', 'posicion', 'n secuencia']),
  F('operacionPrecedenteId', 'Operación precedente', 'id', 'Operación que debe terminar antes (dependencia explícita).', [
    'operacion precedente', 'precedente', 'predecesora', 'op anterior', 'operacion anterior', 'depende de',
  ]),
  F('puestoId', 'Puesto de trabajo', 'id', 'Recurso donde se ejecuta la operación.', [
    'puesto', 'puesto trabajo', 'puesto de trabajo', 'puesto trab', 'pt', 'recurso', 'maquina', 'cod puesto', 'n puesto', 'work center', 'workcenter', 'centro de coste',
  ]),
  F('puestoDesc', 'Descripción del puesto', 'text', 'Nombre del puesto de trabajo.', ['descripcion puesto', 'desc puesto', 'nombre puesto', 'denominacion puesto', 'nombre recurso', 'denominacion', 'nombre']),
  F('seccion', 'Sección', 'text', 'Sección productiva.', ['seccion', 'departamento', 'taller', 'nave', 'linea']),
  F('area', 'Área de producción', 'text', 'Área de producción.', ['area', 'area produccion', 'zona', 'area de produccion']),
  F('centroTrabajo', 'Centro de trabajo', 'text', 'Centro de trabajo / planta.', ['centro', 'centro trabajo', 'centro de trabajo', 'planta', 'fabrica', 'site']),
  F('inicioPrevisto', 'Fecha prevista de inicio', 'date', 'Inicio planificado internamente.', [
    'f inicio prev', 'fecha inicio prevista', 'inicio previsto', 'fecha inicio', 'inicio', 'f inicio', 'inicio planificado', 'fecha inicio plan', 'f ini prev', 'comienzo', 'start',
  ]),
  F('finPrevisto', 'Fecha prevista de finalización', 'date', 'Fin planificado internamente.', [
    'f fin prev', 'fecha fin prevista', 'fin previsto', 'fecha fin', 'fin', 'f fin', 'fin planificado', 'fecha fin plan', 'finalizacion', 'end',
  ]),
  F('inicioReal', 'Fecha real de inicio', 'date', 'Inicio real registrado (solo si existe en el Excel).', ['f inicio real', 'inicio real', 'fecha inicio real', 'comienzo real']),
  F('finReal', 'Fecha real de finalización', 'date', 'Fin real registrado (solo si existe en el Excel).', ['f fin real', 'fin real', 'fecha fin real', 'finalizacion real']),
  F('fechaObjetivo', 'Fecha objetivo', 'date', 'Fecha comprometida / de entrega.', ['fecha objetivo', 'f objetivo', 'fecha entrega', 'f entrega', 'fecha compromiso', 'due date', 'fecha necesidad']),
  F('duracion', 'Duración prevista', 'duration', 'Tiempo de trabajo previsto de la operación (horas/minutos según opción).', [
    'tiempo h', 'tiempo', 'duracion', 'horas', 'horas previstas', 'tiempo previsto', 'tiempo operacion', 'carga', 'carga h', 'horas estandar', 'tiempo estandar', 'duracion h',
  ]),
  F('cantidad', 'Cantidad', 'number', 'Cantidad a fabricar.', ['cantidad', 'cant', 'uds', 'unidades', 'qty', 'cantidad prevista', 'cantidad orden']),
  F('estado', 'Estado de fabricación', 'state', 'Estado de la orden/operación.', ['estado', 'situacion', 'status', 'estado op', 'estado orden', 'estado fabricacion']),
  F('prioridad', 'Prioridad interna', 'priority', 'Prioridad en la planificación interna (si existe).', ['prioridad', 'prio', 'urgencia', 'prioridad interna']),
];

export const ORTEMS_FIELDS: FieldDef[] = [
  F('ordenId', 'Identificador de orden', 'id', 'Orden de fabricación según Ortems.', ['of', 'orden', 'n orden', 'num orden', 'numero orden', 'orden fabricacion', 'n of', 'ordre', 'of ortems']),
  F('preordenId', 'Identificador de preorden', 'id', 'Preorden (orden aún no lanzada).', ['preorden', 'n preorden', 'pre orden', 'orden prevista', 'preordre', 'propuesta']),
  F('aparatoId', 'Número de aparato', 'id', 'Aparato, si Ortems lo proporciona.', ['aparato', 'n aparato', 'num aparato', 'equipo', 'n serie']),
  F('articuloRef', 'Referencia de artículo', 'id', 'Artículo, si Ortems lo proporciona.', ['articulo', 'referencia', 'ref', 'cod articulo', 'material', 'article']),
  F('operacionId', 'Operación / fase', 'id', 'Operación o fase planificada.', ['operacion', 'fase', 'op', 'n operacion', 'n fase', 'phase', 'operation']),
  F('puestoId', 'Puesto / recurso asignado', 'id', 'Recurso asignado por Ortems.', ['recurso', 'puesto', 'puesto trabajo', 'maquina', 'ressource', 'resource', 'pt', 'puesto trab']),
  F('prioridad', 'Prioridad de planificación', 'priority', 'Prioridad asignada por Ortems.', ['prioridad', 'prio', 'priorite', 'priority', 'prioridad ortems', 'nivel prioridad']),
  F('inicio', 'Fecha prevista de inicio (Ortems)', 'date', 'Inicio planificado por Ortems.', [
    'inicio planificado', 'fecha inicio', 'inicio', 'debut', 'f inicio', 'inicio ortems', 'fecha inicio planificada', 'start', 'comienzo',
  ]),
  F('fin', 'Fecha prevista de finalización (Ortems)', 'date', 'Fin planificado por Ortems.', ['fin planificado', 'fecha fin', 'fin', 'f fin', 'fin ortems', 'fecha fin planificada', 'end', 'finalizacion']),
  F('periodo', 'Periodo previsto', 'text', 'Periodo de ejecución textual (p. ej. semana), se conserva tal cual.', ['periodo', 'semana', 'periodo ejecucion', 'semana plan', 'periode']),
  F('duracion', 'Duración (Ortems)', 'duration', 'Duración planificada por Ortems.', ['duracion', 'tiempo', 'horas', 'duree', 'carga']),
  F('cantidad', 'Cantidad prevista', 'number', 'Cantidad planificada.', ['cantidad', 'cant', 'qty', 'quantite', 'cantidad prevista', 'uds']),
  F('estadoPlanificacion', 'Estado de planificación', 'text', 'Estado de la planificación en Ortems.', ['estado', 'estado plan', 'estado planificacion', 'etat', 'status', 'situacion']),
];

export function fieldsFor(kind: SourceKind): FieldDef[] {
  return kind === 'produccion' ? PROD_FIELDS : ORTEMS_FIELDS;
}

export function fieldDef(kind: SourceKind, key: string): FieldDef | undefined {
  return fieldsFor(kind).find((f) => f.key === key);
}

/** Campos de unión permitidos para hojas complementarias. */
export const ROLE_JOIN_FIELD: Record<Exclude<SheetRole, 'filas'>, string> = {
  ordenes: 'ordenId',
  puestos: 'puestoId',
  aparatos: 'aparatoId',
};

export const ROLE_LABEL: Record<SheetRole, string> = {
  filas: 'Filas de planificación (órdenes / operaciones)',
  ordenes: 'Datos complementarios de órdenes (se unen por nº de orden)',
  puestos: 'Datos complementarios de puestos (se unen por puesto)',
  aparatos: 'Datos complementarios de aparatos (se unen por nº de aparato)',
};

/** Campos que una hoja complementaria puede aportar (los demás se ignoran). */
export const ROLE_FIELDS: Record<Exclude<SheetRole, 'filas'>, string[]> = {
  ordenes: ['ordenId', 'aparatoId', 'articuloRef', 'articuloDesc', 'familia', 'preordenId', 'ordenPadreId', 'fechaObjetivo', 'cantidad', 'estado', 'prioridad'],
  puestos: ['puestoId', 'puestoDesc', 'seccion', 'area', 'centroTrabajo'],
  aparatos: ['aparatoId', 'articuloRef', 'articuloDesc', 'familia'],
};

export interface RequiredRule {
  /** Al menos uno de estos campos debe estar asignado. */
  anyOf: string[];
  message: string;
}

export function requiredRules(kind: SourceKind, role: SheetRole): RequiredRule[] {
  if (kind === 'ortems') return [{ anyOf: ['ordenId', 'preordenId'], message: 'Asigne la columna de orden o de preorden.' }];
  if (role === 'filas') return [{ anyOf: ['ordenId'], message: 'Asigne la columna del número de orden.' }];
  const join = ROLE_JOIN_FIELD[role];
  return [{ anyOf: [join], message: `Asigne la columna de unión (${join}).` }];
}

export const RECOMMENDED_FIELDS: Record<SourceKind, string[]> = {
  produccion: ['aparatoId', 'operacionId', 'puestoId', 'inicioPrevisto', 'finPrevisto', 'duracion', 'seccion', 'estado'],
  ortems: ['prioridad', 'inicio', 'fin', 'operacionId', 'puestoId'],
};
