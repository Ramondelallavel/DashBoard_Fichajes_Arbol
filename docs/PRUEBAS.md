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

```bash
npm run build:all && npm run e2e:server
```

## Resultados de la última ejecución (20/11/2026, adaptación a los Excel reales)

- Comprobación de tipos (`tsc -b`, modo estricto, interfaz + servidor): **sin errores**.
- Vitest: **69 de 69 pruebas superadas** en 11 archivos. Nuevas: `realformat.test.ts` (8), con ficheros que
  tienen las columnas reales y valores ficticios: reconocimiento de formatos, consolidación de fichajes, padre
  planificado en Ortems, base automática, capacidad demostrada, aparato con otra notación, terminada
  planificada, agrupación de alertas y guarda de ambigüedad del aparato.
- Extremo a extremo, modo local (`e2e/smoke.mjs`): **26 de 26**, sin errores de JavaScript ni de consola.
- Extremo a extremo, modo servidor (`e2e/server.mjs`): **13 de 13**.
- **Validación local con los Excel reales** (no versionados; prueba fuera del repositorio): importación con el
  asistente de ambos ficheros (≈ 100 000 filas de fichajes y ≈ 32 000 registros de Ortems), recorrido de todas
  las secciones sin errores de JavaScript ni de consola. Análisis completo ≈ 5 s en Node y ≈ 8-10 s en el
  navegador (en segundo plano, mostrando el análisis anterior mientras tanto).
- Rendimiento corregido durante la validación: la comparación de textos creaba un `Collator` en cada llamada
  (análisis 7,5 s → 4,8 s) y la tabla virtual reordenaba todas las filas en cada desplazamiento.

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
| **Modo servidor** | | |
| Inicio de sesión, cookie HttpOnly/SameSite, cabeceras de seguridad | `server.test.ts`, e2e servidor | ✔ |
| Bloqueo tras 5 intentos fallidos | `server.test.ts` | ✔ |
| Protección CSRF (cabecera propia y mismo origen) | `server.test.ts` | ✔ |
| Permisos aplicados en el servidor (consulta, planificador, administrador; configuración por apartados) | `server.test.ts`, e2e servidor | ✔ |
| Cambio de contraseña obligatorio en el primer acceso | `server.test.ts`, e2e servidor | ✔ |
| Usuario y fecha de importaciones y revisiones fijados por el servidor | `server.test.ts`, e2e servidor | ✔ |
| Conflicto de versiones entre dos importaciones simultáneas (409) | `server.test.ts` | ✔ |
| Validación de los datos enviados por el cliente | `server.test.ts` | ✔ |
| Datos compartidos y aviso de cambios de otro usuario | e2e servidor | ✔ |
| Al menos un administrador activo; sesiones revocadas al desactivar | `server.test.ts` | ✔ |
| Registro de actividad | `server.test.ts`, e2e servidor | ✔ |
| Cálculo en Web Worker equivalente al cálculo directo | `worker.test.ts`, ambos e2e | ✔ |

## Errores encontrados por las pruebas y corregidos

- **Desfase horario al leer fechas de un Excel real**: las fechas se desplazaban 1-2 horas en la zona horaria de
  España. Lo detectó la prueba de ida y vuelta con un `.xlsx` real; corregido en `src/import/readers.ts`.
- **Escape cerraba el panel de filtros** al cerrar una lista desplegable; corregido.
- **Rendimiento de la comparación** con grandes volúmenes (3,3 s → 0,5 s): cálculo de días laborables en O(1)
  y ventana de 14 días para la prioridad invertida, con una prueba que verifica la equivalencia con el
  recuento día a día en 2.000 casos.

- **Ruido en la consola en modo local**: la detección del servidor pasaba por el proxy de la vista previa y
  generaba un error 500; ahora la vista previa no usa el proxy y en el visor de artefactos no se hace la petición.
- **Prueba de servidor intermitente** (1 fallo en 5 ejecuciones): la prueba navegaba antes de que terminara la
  recarga de datos tras «Actualizar ahora». Era un fallo de la prueba, no de la aplicación; ahora espera a que
  desaparezca el aviso.

## Limitaciones de las pruebas

- Los Excel reales se han validado localmente, pero no forman parte de las pruebas automáticas (son datos
  privados): las pruebas usan su estructura con valores ficticios. Ver [DATOS_REALES.md](DATOS_REALES.md).
- Las pruebas de extremo a extremo se ejecutan en Chromium; no se ha probado en Firefox ni Safari (no están
  disponibles en el entorno de desarrollo).
- No se ha probado el despliegue detrás de un proxy HTTPS real ni en Windows Server.
