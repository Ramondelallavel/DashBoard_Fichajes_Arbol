# Pruebas

Todas las pruebas usan **datos ficticios** (generador determinista `src/demo/demoData.ts` y casos construidos a mano).
Zona horaria fija en las pruebas: `Europe/Madrid` (incluye cambios de horario).

## Cómo ejecutarlas

```bash
npm test
```

```bash
npm run build && npm run samples && npm run e2e
```

## Resultados de la última ejecución (19/11/2026)

- Comprobación de tipos (`tsc -b`, modo estricto): **sin errores**.
- Vitest: **48 de 48 pruebas superadas** en 8 archivos.
- Extremo a extremo en Chromium (`e2e/smoke.mjs`): **26 de 26 comprobaciones superadas**, sin errores de JavaScript ni de consola.
- Rendimiento: 13.394 operaciones → importación 0,5 s · análisis completo 1,6 s · filtro 5 ms.
- `npm audit`: 0 vulnerabilidades.

## Escenarios de aceptación

| Escenario | Prueba | Estado |
|---|---|---|
| **1. Importación** | | |
| Importar un Excel de producción | `integration.test.ts` (Excel real escrito y leído), e2e (demo) | ✔ |
| Importar un Excel de Ortems | e2e: asistente completo con `samples/ejemplo_ortems_ficticio.xlsx` | ✔ |
| Detectar columnas desconocidas | `import.test.ts` («Columna rara») | ✔ |
| Detectar registros incompletos | `import.test.ts` (sin orden, sin puesto, fecha inexistente, inicio > fin) | ✔ |
| Detectar duplicados | `import.test.ts` (duplicado exacto rechazado, clave duplicada en revisión), `model.test.ts` | ✔ |
| Cabecera bajo filas de título | `import.test.ts`, e2e (fila 4 en el Excel de Ortems) | ✔ |
| Ceros a la izquierda y fechas locales tras un Excel real | `integration.test.ts` | ✔ |
| Validación previa del archivo (extensión, firma, macros) | `import.test.ts` | ✔ |
| **2. Árbol de procesos** | | |
| Seleccionar un aparato y encontrar sus órdenes y operaciones | `model.test.ts`, e2e (árbol y ficha) | ✔ |
| Identificar dependencias disponibles (confirmadas e inferidas) | `model.test.ts`, e2e (7 flechas en el Gantt por aparato) | ✔ |
| Detectar relaciones que no se pueden resolver | `model.test.ts` (pendientes, precedente inexistente, ciclos, orden sin aparato) | ✔ |
| Validación manual en capa separada | `model.test.ts` | ✔ |
| **3. Filtros** | | |
| Aparato, puesto, sección, semana (con año ISO), fecha, familia y combinación | `integration.test.ts` (familia + sección + puesto + semanas), e2e (familia + semana 49 de 2026) | ✔ |
| Aviso de lo que ocultan los filtros | e2e («1 alertas críticas quedan fuera del filtro») | ✔ |
| **4. Gantt** | | |
| Visualizar operaciones; distinguir producción y Ortems | e2e | ✔ |
| Cambiar escalas (día, semana, mes, trimestre, año) | e2e | ✔ |
| Consultar detalles (información contextual y trazabilidad) | e2e | ✔ |
| Identificar operaciones solapadas | `capacity.test.ts`; marca «⧉» en el Gantt | ✔ |
| **5. Comparación con Ortems** | | |
| Relacionar una misma orden en ambos archivos | `comparison.test.ts` (operación y orden) | ✔ |
| Diferencias de fechas con tolerancia (días laborables y horas) | `comparison.test.ts` | ✔ |
| Cambios de prioridad | `comparison.test.ts` | ✔ |
| Órdenes ausentes en una fuente; ambiguas sin emparejar | `comparison.test.ts` | ✔ |
| Prioridad invertida; saturación al combinar ambas planificaciones | `comparison.test.ts` | ✔ |
| **6. Cuellos de botella** | | |
| Operaciones simultáneas en un mismo recurso (08:00–12:00 frente a 10:00–14:00) | `capacity.test.ts` | ✔ |
| Ocupación con capacidad conocida (112 % en la semana 43) | `capacity.test.ts` | ✔ |
| Excesos de carga y capacidad parcial de sección | `capacity.test.ts` | ✔ |
| Diferenciar confirmado, estimado y sin capacidad | `capacity.test.ts`, `integration.test.ts` | ✔ |
| **7. Actualizaciones** | | |
| Importar una nueva versión e identificar cambios | `versioning.test.ts`, e2e (nueva versión de Ortems) | ✔ |
| Evitar duplicaciones (incremental) | `versioning.test.ts` | ✔ |
| Trazabilidad de versiones anteriores | `versioning.test.ts`, historial en e2e | ✔ |
| **Exportación** | `integration.test.ts` (metadatos, filtros, escape de fórmulas), e2e (descarga) | ✔ |
| **Vista móvil (390 px) sin desplazamiento horizontal** | e2e | ✔ |

## Errores encontrados por las pruebas y corregidos

- **Desfase horario al leer fechas de un Excel real**: las fechas se desplazaban 1-2 horas en la zona horaria de
  España. Lo detectó la prueba de ida y vuelta con un `.xlsx` real; corregido en `src/import/readers.ts`.
- **Escape cerraba el panel de filtros** al cerrar una lista desplegable; corregido.
- **Rendimiento de la comparación** con grandes volúmenes (3,3 s → 0,5 s): cálculo de días laborables en O(1)
  y ventana de 14 días para la prioridad invertida, con una prueba que verifica la equivalencia con el
  recuento día a día en 2.000 casos.

## Limitaciones de las pruebas

- No se ha probado con los Excel reales de la empresa (no disponibles): la asignación de columnas y las reglas
  deberán validarse con ellos.
- La prueba de extremo a extremo se ejecuta en Chromium; no se ha probado en Firefox ni Safari.
