# Modelo de datos y relaciones

## Capas de información (trazabilidad)

| Capa | Dónde | Contenido | ¿Se modifica? |
|---|---|---|---|
| 1. Datos originales | `RawSheet` (por importación) | Cabeceras y celdas tal cual se leyeron, con su número de fila de Excel | Nunca |
| 2. Datos normalizados | `ProdRecord`, `OrtemsRecord` | Campos canónicos, incidencias de validación y estado (`ok`, `revision`, `rechazado`); cada registro guarda su origen `{lote, hoja, fila}` | No; una nueva importación crea una nueva versión |
| 3. Relaciones calculadas | `ProductionModel` | Aparatos, órdenes, operaciones, puestos, relaciones y dependencias con su estado | Se recalculan |
| 4. Resultados de análisis | `Analysis` | Correspondencias, comparación, carga, solapes, cuellos de botella, alertas | Se recalculan |
| 5. Información manual | `ManualRelation`, `AlertReview` | Validaciones de relaciones y revisiones de alertas, con usuario y fecha | Solo por el usuario |

Producción y Ortems se guardan en **versiones separadas** (`DatasetVersion` de tipo `produccion` u `ortems`).
Ortems nunca sobrescribe la planificación interna.

## Entidades

```
Aparato ──< Orden ──< Operación >── Puesto ──> Sección
             │  ▲
             └──┘ orden padre (estructura)
Operación ──> Operación (dependencias)
Registro Ortems ──> Operación | Orden   (correspondencia por reglas)
```

- **Operación**: clave `orden|operación`. Si el Excel no trae identificador de operación, la clave usa la
  fila de origen y la operación se etiqueta «Fila N».
- **Orden**: agrega sus operaciones (inicio mínimo, fin máximo, estado agregado).
- **Aparato**: agrega sus órdenes; sus **órdenes raíz** son las que no tienen orden padre dentro del aparato.
- **Puesto**: recurso donde se ejecutan operaciones; sección, área y centro proceden de la fila o de una hoja
  complementaria de puestos.

Los identificadores (orden, aparato, operación, puesto) se tratan **siempre como texto**: se conservan
ceros a la izquierda, guiones y caracteres especiales.

## Estados de una relación

| Estado | Significado | Ejemplo |
|---|---|---|
| **Confirmada** | Respaldada por un campo del Excel | Columna «OF Padre», «Nº Aparato», «Operación precedente» |
| **Inferida** | Deducida por una regla configurable; nunca se presenta como dato | Aparato heredado de la orden padre; secuencia 0010 → 0020 |
| **Pendiente** | No hay datos suficientes para decidir | Dos órdenes del mismo aparato sin orden padre; orden con dos aparatos distintos |
| **Validada manualmente** | Decisión de un usuario (capa 5) | El planificador indica que la orden B es hija de la C |
| **Rechazada** | Un usuario descarta una relación | |

La aplicación **no inventa estructura**: si un aparato tiene varias órdenes sin relación conocida, el árbol
las muestra como raíces independientes con la relación «pendiente de validar» y genera una alerta.

## Detecciones de calidad

Orden sin aparato, aparato sin órdenes (si hay maestro de aparatos), operación sin puesto, sin fechas o sin
duración, identificador duplicado, relación ambigua, orden padre inexistente, precedente inexistente y
ciclos en la estructura de órdenes.

## Versiones e importaciones

Cada importación (`ImportBatch`) guarda: archivo, tamaño, huella SHA-256, fecha y hora, usuario, modo, hojas
y asignación de columnas usadas, recuentos (leídas, correctas, en revisión, rechazadas, vacías), columnas
desconocidas, versión resultante y resumen de cambios. Se conservan las últimas N versiones completas por
fuente (configurable); los metadatos del historial se conservan siempre.
