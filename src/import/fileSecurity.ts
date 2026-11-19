/**
 * Validación previa de archivos importados. Se ejecuta ANTES de procesar el contenido.
 * - Lista blanca de extensiones.
 * - Límite de tamaño.
 * - Comprobación de la firma binaria (magic bytes) frente a la extensión declarada.
 * Nunca se ejecutan macros ni contenido activo: el lector solo extrae valores de celda,
 * y de las fórmulas se usa únicamente el último resultado calculado guardado en el archivo.
 */

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_ROWS_PER_SHEET = 400_000;
export const MAX_COLUMNS = 400;

export type DetectedFormat = 'xlsx' | 'csv';

export interface FileCheck {
  ok: boolean;
  format?: DetectedFormat;
  error?: string;
  warnings: string[];
}

const ALLOWED = ['xlsx', 'xlsm', 'csv', 'txt'];

export function checkFile(name: string, size: number, head: Uint8Array): FileCheck {
  const warnings: string[] = [];
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'xls') {
    return {
      ok: false,
      warnings,
      error: 'Formato .xls (Excel 97-2003) no admitido por seguridad y fiabilidad. Abra el archivo en Excel y guárdelo como .xlsx.',
    };
  }
  if (!ALLOWED.includes(ext)) {
    return { ok: false, warnings, error: `Extensión .${ext || '(ninguna)'} no admitida. Formatos válidos: .xlsx, .xlsm, .csv.` };
  }
  if (size === 0) return { ok: false, warnings, error: 'El archivo está vacío.' };
  if (size > MAX_FILE_BYTES) {
    return { ok: false, warnings, error: `El archivo supera el tamaño máximo (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).` };
  }
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (ext === 'xlsx' || ext === 'xlsm') {
    if (isOle) {
      return { ok: false, warnings, error: 'El archivo tiene extensión .xlsx pero su contenido es un Excel antiguo (.xls) o un documento cifrado. Guárdelo como .xlsx sin contraseña.' };
    }
    if (!isZip) return { ok: false, warnings, error: 'El contenido del archivo no corresponde a un libro Excel (.xlsx) válido.' };
    if (ext === 'xlsm') warnings.push('El libro admite macros (.xlsm): las macros se ignoran y nunca se ejecutan. Solo se leen los valores de las celdas.');
    return { ok: true, format: 'xlsx', warnings };
  }
  if (isZip || isOle) return { ok: false, warnings, error: 'El archivo tiene extensión de texto pero su contenido es binario.' };
  for (let i = 0; i < Math.min(head.length, 4096); i++) {
    if (head[i] === 0) return { ok: false, warnings, error: 'El archivo de texto contiene caracteres binarios no válidos.' };
  }
  return { ok: true, format: 'csv', warnings };
}

/** Huella SHA-256 del archivo, para identificar versiones e importaciones repetidas. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return 'no-disponible';
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return 'no-disponible';
  }
}
