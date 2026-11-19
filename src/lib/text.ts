/** Normaliza texto de cabecera para comparaciones: minúsculas, sin acentos, sin puntuación. */
export function normalizeHeader(input: string): string {
  let s = String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // "nº", "n.º", "no.", "núm.", "número" -> "n"
  s = s.replace(/n\s*[.]?\s*[ºo°]\s*\.?/g, 'n ');
  s = s.replace(/\bnum(ero)?\b\.?/g, 'n ');
  s = s.replace(/\bno\.\s/g, 'n ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokens(s: string): string[] {
  return normalizeHeader(s).split(' ').filter(Boolean);
}

/** Normalización de texto libre para búsquedas (sin acentos, minúsculas). */
export function searchable(s: string | undefined | null): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export interface IdNormalization {
  caseInsensitive: boolean;
  stripLeadingZeros: boolean;
}

/**
 * Clave de correspondencia para identificadores. El identificador ORIGINAL nunca se modifica;
 * esta clave solo se usa para emparejar fuentes según las reglas configuradas.
 */
export function idKey(id: string | undefined, norm: IdNormalization): string | undefined {
  if (id === undefined || id === null) return undefined;
  let s = String(id).trim();
  if (!s) return undefined;
  if (norm.caseInsensitive) s = s.toUpperCase();
  if (norm.stripLeadingZeros) s = s.replace(/^0+(?=.)/, '');
  return s;
}

/** Comparación "natural" de identificadores: 0010 < 0020 < 0100, A2 < A10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

/** Hash FNV-1a de 32 bits en hexadecimal, para identificadores estables de alertas. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function uid(prefix = 'id'): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}
