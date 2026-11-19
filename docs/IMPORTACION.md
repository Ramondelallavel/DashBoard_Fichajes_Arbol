# Importación de Excel

Hay dos módulos independientes (producción y Ortems) con el mismo asistente de 7 pasos.

## Asistente

1. **Archivo**: arrastrar o seleccionar `.xlsx`, `.xlsm` o `.csv` (máx. 60 MB). Se comprueba la firma
   binaria frente a la extensión; `.xls` (Excel 97-2003) se rechaza con instrucciones para guardarlo como `.xlsx`.
   Se calcula la huella SHA-256 para reconocer archivos repetidos.
2. **Hojas**: se detectan todas (incluidas las ocultas, con aviso). En producción, cada hoja puede ser:
   - *Filas de planificación* (órdenes/operaciones). Varias hojas de filas se suman.
   - *Datos complementarios* de órdenes, puestos o aparatos, que se unen por su identificador y **solo rellenan
     huecos** (si hay valores distintos, se conserva el de la fila y se avisa).
3. **Cabecera**: se detecta automáticamente aunque haya títulos encima (con nivel de confianza) y se puede corregir.
   Vista previa de las filas.
4. **Columnas**: propuesta de correspondencia columna → campo interno con su confianza y su motivo. No se
   presupone ningún nombre: se compara con sinónimos y con el tipo de los valores. Cada campo procede de una
   sola columna. Opciones: orden de fecha en texto (día/mes/año por defecto), unidad de duración y separador
   decimal. Los perfiles se pueden **exportar e importar en JSON**.
5. **Validación**: registros correctos, pendientes de revisión (se importan con aviso) y rechazados
   (sin orden, duplicado exacto…), con ejemplos de hoja y fila. Columnas desconocidas y avisos de columna
   (p. ej. identificadores guardados como número).
6. **Modo y confirmación**:
   | Modo | Uso |
   |---|---|
   | Inicial | Primera carga de la fuente |
   | Actualización | El archivo es una foto completa: pasa a ser la versión activa y se calculan nuevos/modificados/desaparecidos |
   | Sustitución completa | Descarta la versión activa (pide confirmación explícita) |
   | Incremental | El archivo solo trae novedades: fusión por clave orden + operación sin borrar nada (solo si las claves son fiables) |

   Antes de confirmar se muestra el resumen de cambios. Si desaparecen registros, se pide una confirmación explícita.
7. **Resumen**: importados, rechazados y pendientes de revisión, con la lista de estos últimos.

## Perfiles de columnas

Al confirmar, la asignación se guarda como **perfil** con la firma de las cabeceras. Si otro Excel tiene las
mismas cabeceras (coincidencia ≥ 80 %), el perfil se aplica automáticamente.

## Campos internos

**Producción**: número de aparato, referencia y descripción de artículo, familia, orden, preorden, orden padre,
operación, descripción de operación, secuencia, operación precedente, puesto, descripción de puesto, sección,
área, centro de trabajo, inicio/fin previstos, inicio/fin reales, fecha objetivo, duración, cantidad, estado y prioridad.
Obligatorio: **orden**.

**Ortems**: orden, preorden, aparato, artículo, operación/fase, puesto/recurso, prioridad, inicio, fin, periodo,
duración, cantidad y estado de planificación. Obligatorio: **orden o preorden**.

## Seguridad

- No se ejecutan macros ni se evalúan fórmulas (se usa su último resultado guardado; si no lo hay, la celda queda vacía y se avisa).
- Límites de tamaño, filas (400.000 por hoja) y columnas (400).
- CSV: detección del separador; si no es UTF-8, se lee como Windows-1252 (habitual en Excel en español) y se avisa.

## Excel de ejemplo

`npm run samples` genera en `samples/` tres Excel **ficticios** (producción con dos hojas, Ortems actual y
Ortems de la semana anterior) que incluyen títulos sobre la cabecera, identificadores con ceros a la izquierda,
duplicados, una fecha inexistente, una operación sin puesto, relaciones sin orden padre, preórdenes solo en
Ortems y cambios de prioridad.
