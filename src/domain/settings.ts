import type { EstadoCanonico } from './types';

/** Capacidad de un puesto de trabajo. Las horas son por unidad (máquina/operario) y día. */
export interface ResourceCapacity {
  puestoId: string;
  /** Horas disponibles por unidad para cada día de la semana ISO (1 = lunes ... 7 = domingo). */
  hoursPerWeekday: Record<number, number>;
  /** Número de unidades equivalentes en paralelo (máquinas, operarios). */
  units: number;
  /** Eficiencia/rendimiento (0-1). 1 = 100 %. */
  efficiency: number;
  /** Paradas planificadas (rangos de días inclusive, 'YYYY-MM-DD'). */
  stops: { from: string; to: string; note?: string }[];
  /** Horarios especiales: horas por unidad para un día concreto. */
  specialDays: { date: string; hours: number; note?: string }[];
  note?: string;
}

export interface CalendarConfig {
  /** Días laborables ISO (1 = lunes ... 7 = domingo). */
  workingWeekdays: number[];
  /** Festivos 'YYYY-MM-DD'. */
  holidays: string[];
}

export interface MatchRule {
  id: string;
  label: string;
  /** Campos que deben coincidir exactamente (tras la normalización configurada). */
  fields: ('ordenId' | 'preordenId' | 'operacionId' | 'aparatoId' | 'articuloRef' | 'puestoId')[];
  enabled: boolean;
}

export interface Settings {
  /** Fecha de referencia para retrasos y análisis futuro. null = hoy. */
  referenceDate: string | null;
  calendar: CalendarConfig;
  capacities: Record<string, ResourceCapacity>;
  /**
   * Capacidad supuesta para puestos sin capacidad configurada. Desactivada por defecto:
   * sin capacidad conocida no se calculan ocupaciones. Si se activa, todo resultado
   * derivado se etiqueta como ESTIMADO.
   */
  assumedCapacity: { enabled: boolean; hoursPerDay: number; units: number };
  /** Umbral de ocupación a partir del cual se marca riesgo (0-1). */
  riskThreshold: number;
  /** Semanas hacia delante para el análisis de cuellos de botella futuros. */
  horizonWeeks: number;

  matching: {
    rules: MatchRule[];
    caseInsensitive: boolean;
    stripLeadingZeros: boolean;
  };

  tolerance: { value: number; unit: 'horas' | 'dias_laborables' };
  /** Desfase (días laborables) a partir del cual una diferencia de fechas es de criticidad alta. */
  highDeviationDays: number;

  priority: {
    /** Cómo interpretar el valor numérico de prioridad de Ortems. */
    direction: 'menor_mas_prioritario' | 'mayor_mas_prioritario';
    /** Valores con esta prioridad o mejor se consideran "prioridad alta". */
    highThreshold: number;
    /** Traducción de prioridades textuales a valor numérico. */
    textMap: Record<string, number>;
  };

  dependencies: {
    /** Inferir secuencia por el número de operación dentro de la orden (dependencia INFERIDA). */
    sequenceByOperationNumber: boolean;
    /** La orden hija (componente) debe terminar antes de empezar la orden padre (INFERIDA). */
    childBeforeParent: boolean;
    /** Heredar el aparato de la orden padre cuando la orden no lo indica (relación INFERIDA). */
    inheritAparatoFromParent: boolean;
    /** Espera (días laborables) entre operaciones consecutivas a partir de la cual se señala. */
    waitThresholdDays: number;
  };

  load: {
    /** Si falta la duración, estimarla a partir de las fechas (marcado como ESTIMADO). */
    estimateDurationFromDates: boolean;
  };

  /** Traducción de textos de estado a estado canónico (claves normalizadas). */
  stateMap: Record<string, EstadoCanonico>;

  /** Número máximo de versiones de datos que se conservan por fuente. */
  keepVersions: number;
}

export const DEFAULT_STATE_MAP: Record<string, EstadoCanonico> = {
  pendiente: 'pendiente',
  planificada: 'pendiente',
  planificado: 'pendiente',
  'no iniciada': 'pendiente',
  abierta: 'pendiente',
  lanzada: 'pendiente',
  liberada: 'pendiente',
  'en curso': 'en_curso',
  'en proceso': 'en_curso',
  iniciada: 'en_curso',
  iniciado: 'en_curso',
  'en fabricacion': 'en_curso',
  'en marcha': 'en_curso',
  terminada: 'terminada',
  terminado: 'terminada',
  finalizada: 'terminada',
  finalizado: 'terminada',
  cerrada: 'terminada',
  cerrado: 'terminada',
  completada: 'terminada',
  completado: 'terminada',
  bloqueada: 'bloqueada',
  bloqueado: 'bloqueada',
  parada: 'bloqueada',
  retenida: 'bloqueada',
};

export const DEFAULT_SETTINGS: Settings = {
  referenceDate: null,
  calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: [] },
  capacities: {},
  assumedCapacity: { enabled: false, hoursPerDay: 8, units: 1 },
  riskThreshold: 0.85,
  horizonWeeks: 8,
  matching: {
    rules: [
      { id: 'orden-operacion', label: 'Orden + operación', fields: ['ordenId', 'operacionId'], enabled: true },
      { id: 'orden', label: 'Orden', fields: ['ordenId'], enabled: true },
      { id: 'preorden', label: 'Preorden', fields: ['preordenId'], enabled: true },
    ],
    caseInsensitive: true,
    stripLeadingZeros: false,
  },
  tolerance: { value: 1, unit: 'dias_laborables' },
  highDeviationDays: 5,
  priority: {
    direction: 'menor_mas_prioritario',
    highThreshold: 2,
    textMap: { urgente: 1, critica: 1, 'muy alta': 1, alta: 2, media: 3, normal: 3, baja: 4, 'muy baja': 5 },
  },
  dependencies: {
    sequenceByOperationNumber: true,
    childBeforeParent: true,
    inheritAparatoFromParent: true,
    waitThresholdDays: 3,
  },
  load: { estimateDurationFromDates: true },
  stateMap: DEFAULT_STATE_MAP,
  keepVersions: 10,
};

export function mergeSettings(partial: Partial<Settings> | undefined): Settings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    calendar: { ...DEFAULT_SETTINGS.calendar, ...(p.calendar ?? {}) },
    assumedCapacity: { ...DEFAULT_SETTINGS.assumedCapacity, ...(p.assumedCapacity ?? {}) },
    matching: { ...DEFAULT_SETTINGS.matching, ...(p.matching ?? {}) },
    tolerance: { ...DEFAULT_SETTINGS.tolerance, ...(p.tolerance ?? {}) },
    priority: { ...DEFAULT_SETTINGS.priority, ...(p.priority ?? {}) },
    dependencies: { ...DEFAULT_SETTINGS.dependencies, ...(p.dependencies ?? {}) },
    load: { ...DEFAULT_SETTINGS.load, ...(p.load ?? {}) },
    capacities: { ...(p.capacities ?? {}) },
    stateMap: { ...DEFAULT_STATE_MAP, ...(p.stateMap ?? {}) },
  };
}

export function referenceMs(settings: Settings, now = Date.now()): number {
  if (settings.referenceDate) {
    const [y, m, d] = settings.referenceDate.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d).getTime();
  }
  return now;
}

/** Interpreta la prioridad: devuelve un "rango" donde menor = más prioritario. */
export function priorityRank(value: number | undefined, settings: Settings): number | undefined {
  if (value === undefined) return undefined;
  return settings.priority.direction === 'menor_mas_prioritario' ? value : -value;
}

export function isHighPriority(value: number | undefined, settings: Settings): boolean {
  if (value === undefined) return false;
  return settings.priority.direction === 'menor_mas_prioritario' ? value <= settings.priority.highThreshold : value >= settings.priority.highThreshold;
}
