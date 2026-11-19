# Arquitectura

## Estado inicial del repositorio

El repositorio solo contenía un `README.md` (commit inicial). No había código, dependencias ni configuración
que respetar, así que se ha definido una arquitectura nueva.

## Pila técnica

| Capa | Tecnología | Motivo |
|---|---|---|
| Interfaz | React 19 + TypeScript (estricto) | Componentes tipados, ecosistema estable |
| Build | Vite 7 (+ `vite-plugin-singlefile` para el artefacto) | Build rápida; un único HTML autocontenido para la vista previa |
| Estado | Zustand | Estado global pequeño y explícito |
| Excel | ExcelJS 4.4 (lectura y escritura) + PapaParse (CSV) | Sin vulnerabilidades conocidas; no ejecuta macros. El paquete `xlsx` de npm (0.18.5) tiene vulnerabilidades de lectura de archivos manipulados y no se usa |
| Persistencia (modo local) | IndexedDB (con alternativa en memoria) | Los datos industriales no salen del navegador |
| Servidor (modo multiusuario) | Node 22 + Fastify 5 + SQLite integrado (`node:sqlite`) | Sin dependencias nativas; un único proceso sirve web y API |
| Cálculo | Web Worker (con alternativa en el hilo principal) | La interfaz no se bloquea con grandes volúmenes |
| Pruebas | Vitest 4 (unitarias e integración) + Playwright (extremo a extremo) | |

`npm audit` no informa de vulnerabilidades (se fuerza `uuid@11.1.1`, dependencia de ExcelJS, mediante `overrides`).

## Capas y carpetas

```
src/
  domain/    Tipos del dominio, catálogo de campos importables, configuración y reglas por defecto
  lib/       Utilidades puras: fechas y semanas ISO, normalización de texto, formato numérico
  import/    Lectura segura de archivos, detección de cabecera, propuesta de columnas, interpretación
             de valores, normalización/validación, versionado (inicial/actualización/sustitución/incremental)
  engine/    Cálculo de planificación, independiente de la interfaz:
               model.ts        árbol aparato → órdenes → operaciones, relaciones y dependencias
               matching.ts     correspondencia producción ↔ Ortems por reglas
               comparison.ts   desfases, prioridades, discrepancias y criticidad
               calendar.ts     calendario laboral y capacidad por puesto
               load.ts         carga por puesto/sección y día/semana/mes
               overlaps.ts     solapamientos y su clasificación
               bottlenecks.ts  saturaciones, ranking y previsiones
               alerts.ts       alertas centralizadas
               filters.ts      filtros combinables
               aparato.ts      análisis individual de un aparato
               analysis.ts     orquestador (un único cálculo compartido por todas las vistas)
  data/      Acceso a datos: interfaz Backend con dos implementaciones (repositorio local IndexedDB
             y cliente de la API del servidor), sesión y estado global
  export/    Generación de informes Excel y entrega del archivo
  demo/      Generador determinista de datos ficticios
  auth/      Perfiles y matriz de permisos
  ui/        Componentes, Gantt, filtros, asistente de importación y páginas
  app/       Navegación, contexto de análisis y aplicación
server/      Servidor multiusuario: base de datos, autenticación, validación y API (ver docs/SERVIDOR.md)
tests/       Pruebas Vitest
e2e/         Prueba de extremo a extremo (Playwright)
scripts/     Generación de Excel de ejemplo y del artefacto
```

### Separación de responsabilidades

- **Interfaz ↔ lógica**: las páginas no calculan; consumen `Analysis` (de `engine/analysis.ts`) a través de
  `AnalysisContext`. El cálculo se ejecuta una vez por cambio de datos, configuración o validación manual.
- **Lógica ↔ datos**: el motor recibe versiones de datos (`DatasetVersion`) y configuración (`Settings`);
  no sabe de dónde vienen. La interfaz `Backend` (`src/data/backend.ts`) tiene dos implementaciones:
  `Repository` (IndexedDB, modo local) y `ApiBackend` (API del servidor). La aplicación detecta el modo al arrancar.
- **Servidor**: no recalcula el análisis (lo hace cada cliente con el mismo motor); guarda las versiones de
  datos, aplica permisos, controla la concurrencia y registra la actividad. El código compartido
  (tipos, configuración, matriz de permisos) está en `src/` y lo usan ambos lados.
- **Cálculo ↔ representación gráfica**: el Gantt recibe filas y barras ya calculadas (`ui/gantt/rows.ts`) y
  una escala temporal pura (`ui/gantt/timeScale.ts`).

## Rendimiento

- Tabla y Gantt **virtualizados**: solo se pintan las filas visibles y, en el Gantt, solo las barras del
  rango horizontal visible.
- Los filtros se aplican sobre el análisis ya calculado (`useDeferredValue` para no bloquear la escritura).
- Medido en pruebas: **13.394 operaciones** → importación 0,4 s, análisis completo 1,4 s, filtro 5-50 ms.
- La diferencia en días laborables se calcula en O(1) (semanas completas + resto + festivos con búsqueda binaria).
- ExcelJS y el asistente de importación se cargan de forma diferida en la build normal.

- `runAnalysis` se ejecuta en un **Web Worker** (`src/engine/analysis.worker.ts`); el resultado llega por
  clonado estructurado y el calendario se reconstruye en el hilo principal (`rehydrateAnalysis`). Mientras se
  recalcula, la interfaz sigue mostrando el análisis anterior.

### Evolución prevista

- Inicio de sesión corporativo (OIDC/SSO) sobre la sesión ya existente del servidor.
- Base de datos corporativa (PostgreSQL/SQL Server) reimplementando `server/db.ts` si el volumen o la política de TI lo requieren.

## Dos builds

- `npm run build` → `dist/` multi-fichero para desplegar en cualquier servidor web estático.
- `npm run build:artifact` → un único HTML sin dependencias externas (salvo las fuentes de Google Fonts,
  con alternativa del sistema), que es lo que se publica como artefacto visualizable. Dentro del visor de
  artefactos, las descargas de Excel usan la capacidad `downloads` del visor; fuera de él, una descarga normal.
