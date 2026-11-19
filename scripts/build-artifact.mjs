/**
 * Convierte la build de un solo fichero (dist-artifact/index.html, generada con `vite build --mode artifact`)
 * en el formato de publicación de artefactos: sin <!doctype>/<html>/<head>/<body> propios
 * (el visor añade su propio esqueleto), con <title> al principio y todo el JS/CSS en línea.
 * Resultado: dist-artifact/planificacion-industrial.html
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'dist-artifact');
const html = readFileSync(join(dir, 'index.html'), 'utf8');

const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? 'Planificación Industrial Gantt';
const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
const fontLinks = [...html.matchAll(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0]);
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('No se ha encontrado el script de la aplicación en dist-artifact/index.html');
for (const s of scripts) {
  // Evitar que un "</script" dentro del código cierre la etiqueta antes de tiempo
  if (/<\/script/i.test(s)) throw new Error('El código contiene "</script": no se puede incrustar con seguridad');
}

const out = [
  `<title>${title}</title>`,
  description ? `<meta name="description" content="${description}">` : '',
  ...fontLinks,
  ...styles.map((s) => `<style>${s}</style>`),
  '<div id="root"></div>',
  ...scripts.map((s) => `<script type="module">${s}</script>`),
]
  .filter(Boolean)
  .join('\n');

const target = join(dir, 'planificacion-industrial.html');
writeFileSync(target, out);
const kb = Math.round(statSync(target).size / 1024);
console.log(`Artefacto generado: ${target} (${kb} KB)`);
if (kb > 15 * 1024) throw new Error('El artefacto supera el tamaño máximo permitido');
