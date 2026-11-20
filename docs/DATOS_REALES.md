# Formato de los Excel reales de la empresa

Este documento describe la **estructura** de los dos Excel reales y cómo los interpreta la aplicación.
No contiene datos: los ficheros reales **no están en el repositorio** y las pruebas automáticas usan ficheros
con las mismas columnas y valores ficticios (`tests/realformat.test.ts`).

La aplicación reconoce ambos formatos por sus cabeceras y aplica automáticamente un perfil incluido
(`src/domain/builtinProfiles.ts`). El asistente muestra la asignación propuesta y el usuario puede corregirla.

## Excel de producción: fichajes (`VSM_CargaPpal`)

Una fila por **fichaje** de una **preorden** (una preorden puede aparecer en varias filas, una por fichaje).
Las fechas son de **ejecución real**: este Excel **no** contiene planificación futura.

| Columna | Campo de la aplicación | Interpretación |
|---|---|---|
| `preo_codigo` | Preorden (nodo del árbol) | Identificador de la preorden. |
| `PreordSiguiente` | Orden/preorden padre | Preorden **siguiente** en el proceso: la relación hijo → padre del árbol (**confirmada**, procede del dato). |
| `ped_CodControl` | Aparato | Número de control del pedido / aparato. |
| `SECC_NOMBRE` | Sección | Sección que ficha. No hay puesto de trabajo. |
| `FechaInicio` / `FechaFin` | Inicio / fin **reales** | Nunca se presentan como fechas previstas. |
| `ESTADO_PREO` | Estado | `FIN` → terminada · `EC` → en curso · `ANU` → anulada. `ABO`: **sin equivalencia** (pendiente de confirmar). |
| `Porcentaje` | Avance (0-100) | 100 % se considera terminada. |
| `preo_cargaTotal_h` | Duración (horas) | Carga total de la preorden. |
| `semana`, `MesFin`, `fechaHora`, `SECC_CODIGO`, `preo_est_codigo` | (sin asignar) | Se conservan en los datos originales. |

**Filas repetidas**: el perfil activa la consolidación. Las filas de una misma preorden se agregan
(inicio real mínimo, fin real máximo, estado del fichaje más reciente, mayor avance) y se informa con la
incidencia `FILAS_CONSOLIDADAS`, en lugar de marcarlas como duplicadas. Se puede desactivar en el asistente.

## Excel de Ortems

### Hoja `DatosPlan`
Una fila por preorden planificada.

| Columna | Campo | Interpretación |
|---|---|---|
| `PREO` | Preorden | Clave de correspondencia con `preo_codigo`. |
| `ORD` | Orden de fabricación | Número de OF (una OF agrupa varias preórdenes). |
| `PT` | Puesto de trabajo | Recurso planificado por Ortems. |
| `SCCNombre` | Sección | Mismos nombres de sección que en producción. |
| `NControl` | Aparato | Mismo aparato que `ped_CodControl`, **con otra notación** (sin ceros, a veces con prefijo de letras). |
| `InicioOrtems` / `FinOrtems` | Inicio / fin planificados | |
| `CARGA` | Duración (horas) | Carga planificada. |
| `CP`, `Mod` | Familia, modelo | |
| `TGT`, `TGTNombre` | Artículo y descripción | |
| `EST` | Estado de planificación | Se muestra tal cual. |
| `Sem` | Periodo | Texto de semana (AAAASS); se conserva tal cual. Significado exacto pendiente de confirmar. |
| `NT`, `DesfaseSemana`, `InicioFab`, `Grupo_Nesting`, `Grupo_Op`, `SCC`, `DURACION` | (sin asignar) | Significado pendiente de confirmar. |

### Hoja `DatosPlan_Aux`
Órdenes auxiliares sin preorden (`ord_codigo` → orden; mismas columnas de fechas, puesto, sección y carga).

## Cómo se combinan

1. **Correspondencia**: por preorden (`preo_codigo` = `PREO`), con identificadores exactos.
2. **Aparato de los registros de Ortems**: si la preorden está emparejada, el de producción; si no, se compara
   el número de aparato normalizado (por defecto, solo dígitos y sin ceros a la izquierda; configurable). Si dos
   aparatos de producción dan la misma clave, **no se asigna** (no se adivina). En la importación de prueba,
   todas las preórdenes emparejadas tenían el mismo aparato por las dos vías.
3. **Árbol**: preorden → preorden siguiente. Si la siguiente no tiene fichajes pero está planificada en Ortems,
   la relación se considera confirmada y se indica «planificada en Ortems». Si no está en ningún fichero, queda
   pendiente (`PADRE_NO_ENCONTRADO`, informativa): habitualmente son preórdenes de pedidos anteriores al
   periodo exportado.
4. **Base del análisis futuro**: como producción solo contiene ejecución real, la carga y los cuellos de botella
   se calculan sobre **Ortems** (selección automática, configurable en *Configuración*).
5. **Capacidad demostrada**: horas ejecutadas por sección y semana según los fichajes (últimas 8 semanas,
   configurable), comparadas con la carga que Ortems planifica para las próximas semanas. Siempre **estimado**:
   es lo que la sección ha completado, no su capacidad nominal.
6. **Discrepancias nuevas**:
   - *Terminada en producción, planificada en Ortems*: alta si el plan es futuro (reserva capacidad para trabajo
     ya hecho), media si ya pasó.
   - *Anulada en producción, planificada en Ortems*.
   - *Precedencia del árbol en Ortems*: Ortems inicia la preorden siguiente antes de terminar su predecesora.
   - Lo que solo está en Ortems sin fichajes es trabajo futuro: informativo, agrupado por aparato.
7. **Sin capacidad configurada** de los puestos `PT…`, los solapes de Ortems son solo *potenciales* (informativos)
   y no hay saturaciones *confirmadas*: hay que configurar la capacidad para obtenerlas.

## Observaciones de la validación con los ficheros reales (pendientes de confirmar)

- En una parte de las preórdenes terminadas, `FechaInicio` es **posterior** a `FechaFin` (mediana ≈ 14,5 h).
  Parece que `FechaFin` es solo fecha (00:00) y `FechaInicio` lleva hora. Se importan con aviso
  `INICIO_POSTERIOR_FIN`; la barra real se dibuja desde el inicio, sin duración.
- Estado `ABO`: sin equivalencia configurada (¿abonada?, ¿abortada?). Se puede asignar en *Configuración → Estados*.
- Algunas preórdenes indican **distintas preórdenes siguientes** en fichajes distintos: la relación queda
  pendiente de validación (no se elige una).
- Significado de `Sem`, `DesfaseSemana`, `NT`, `InicioFab` y de los valores de `EST`.
- No hay fuente de **prioridades**: la detección de inversión de prioridad está inactiva.
