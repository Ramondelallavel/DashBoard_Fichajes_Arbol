import { useEffect, useState } from 'react';

/** Rutas por hash simple (#nombre), compatibles con el visor de artefactos. */
export const ROUTES = [
  'dashboard',
  'gantt',
  'gantt-aparato',
  'arbol',
  'aparato',
  'puestos',
  'carga',
  'cuellos',
  'ortems',
  'alertas',
  'importacion',
  'configuracion',
] as const;

export type Route = (typeof ROUTES)[number];

function current(): Route {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'dashboard';
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(current);
  useEffect(() => {
    const h = () => setR(current());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export function go(r: Route) {
  if (location.hash !== `#${r}`) location.hash = r;
}
