/**
 * Entrega de archivos al usuario.
 * - Dentro del visor de artefactos de claude.ai se usa la capacidad `downloads`
 *   (el visor muestra una confirmación; el usuario puede rechazarla).
 * - Desplegada como aplicación web normal se usa una descarga estándar del navegador.
 */
export type SaveOutcome = 'guardado' | 'rechazado' | 'no_disponible' | 'error';

interface DownloadsNs {
  save(req: { filename: string; data: Blob | ArrayBuffer | string }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use?: (name: string) => Promise<unknown>;
}

let downloadsPromise: Promise<DownloadsNs | null> | undefined;

function hostDownloads(): Promise<DownloadsNs | null> {
  const claude = (globalThis as unknown as { claude?: ClaudeHost }).claude;
  if (!claude?.use) return Promise.resolve(null);
  downloadsPromise ??= claude.use('downloads').then((ns) => (ns as DownloadsNs) ?? null).catch(() => null);
  return downloadsPromise;
}

/** true si la página está dentro del visor de artefactos (la descarga directa estaría bloqueada). */
export function isArtifactHost(): boolean {
  return !!(globalThis as unknown as { claude?: ClaudeHost }).claude?.use;
}

export async function saveFile(filename: string, data: ArrayBuffer | Blob, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'): Promise<{ outcome: SaveOutcome; message: string }> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (isArtifactHost()) {
    const dl = await hostDownloads();
    if (!dl) return { outcome: 'no_disponible', message: 'La descarga de archivos no está disponible en esta vista.' };
    try {
      await dl.save({ filename, data: blob });
      return { outcome: 'guardado', message: `Archivo ${filename} entregado.` };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return { outcome: 'rechazado', message: 'Descarga cancelada.' };
      if (code === 'rate_limited') return { outcome: 'error', message: 'Ya hay una descarga pendiente de confirmar. Inténtelo de nuevo en unos segundos.' };
      return { outcome: 'no_disponible', message: 'La descarga no está disponible en esta vista.' };
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { outcome: 'guardado', message: `Archivo ${filename} descargado.` };
  } catch {
    return { outcome: 'error', message: 'No se ha podido generar la descarga.' };
  }
}

export function timestampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
