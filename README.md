# Planificación industrial · Gantt · Ortems · Cuellos de botella

Aplicación web para analizar la planificación de producción a partir de **dos Excel independientes**:

1. **Excel de producción**: aparatos, órdenes, operaciones, artículos, puestos de trabajo y secciones.
2. **Excel de Ortems**: órdenes, preórdenes, prioridades y fechas planificadas por Ortems.

La aplicación cruza ambas fuentes **sin mezclarlas**, reconstruye el árbol de procesos de cada aparato,
representa la planificación en un **diagrama de Gantt** interactivo, compara producción con Ortems,
calcula la carga frente a la capacidad del calendario y **anticipa cuellos de botella**, distinguiendo
siempre lo confirmado de lo estimado.

> Los datos de demostración y los Excel de `samples/` son **ficticios**. No se versiona ningún Excel real
> (ver `.gitignore`).

## Puesta en marcha

Requisitos: Node.js 20 o superior.

```bash
npm install
```

```bash
npm run dev
```

Abra la URL que muestra Vite y pulse **Cargar datos de demostración**, o importe sus Excel en **Importación de Excel**.

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobación de tipos + build de producción en `dist/` |
| `npm test` | 48 pruebas automatizadas (Vitest) del motor, la importación y la integración |
| `npm run samples` | Genera los Excel ficticios de ejemplo en `samples/` |
| `npm run e2e` | Prueba de extremo a extremo en Chromium (requiere `npm run build` y Playwright) |
| `npm run build:artifact` | Build de un único HTML autocontenido (`dist-artifact/planificacion-industrial.html`) |

## Secciones de la aplicación

1. **Dashboard**: indicadores y gráficos de situación de fábrica; reaccionan a los filtros.
2. **Gantt general**: agrupable por aparato, familia, sección, puesto u orden; escalas día / semana / mes / trimestre / año; producción, Ortems o ambas.
3. **Gantt por aparato**: órdenes y operaciones del aparato con flechas de dependencias (confirmadas, inferidas, incumplidas).
4. **Árbol de procesos**: aparato → órdenes → operaciones, con el estado de cada relación y validación manual de las pendientes.
5. **Puestos de trabajo**: carga, capacidad, solapamientos y operaciones de cada recurso.
6. **Análisis de carga**: mapa de calor puesto/sección × día/semana/mes, para producción, Ortems o la combinación.
7. **Cuellos de botella**: avisos de saturación futura, ranking de recursos, operaciones incompatibles en el mismo recurso.
8. **Comparador de Ortems**: tabla de correspondencias y discrepancias con criticidad y estado de revisión.
9. **Alertas e incidencias**: alertas centralizadas, revisables, con motivo, fuente y trazabilidad.
10. **Importación de Excel**: asistente de 7 pasos, historial, datos originales y comparación de versiones.
11. **Configuración**: capacidad por puesto, calendario, festivos, paradas, tolerancias, reglas de correspondencia y de dependencias, prioridades, estados, perfiles y permisos.

Todo lo exportable se exporta a Excel respetando los filtros, con fecha de generación, usuario y versión de los datos.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Modelo de datos y relaciones](docs/MODELO_DATOS.md)
- [Reglas de negocio y criterios de cálculo](docs/REGLAS_NEGOCIO.md)
- [Importación de Excel](docs/IMPORTACION.md)
- [Pruebas](docs/PRUEBAS.md)

## Privacidad y seguridad

- Los datos importados se guardan **solo en el navegador** (IndexedDB). No se envían a ningún servidor.
- Los archivos se validan antes de procesarse (extensión, firma binaria, tamaño). **Nunca se ejecutan macros**
  y las fórmulas no se evalúan: se usa el último resultado guardado en el archivo.
- Al exportar, los textos que empiezan por `=`, `+`, `-` o `@` se escapan para evitar la inyección de fórmulas.
- No hay credenciales en el código. La autenticación real (SSO/OIDC) está prevista; hoy el perfil
  (Administrador, Planificador, Consulta) se elige localmente para probar los permisos.
