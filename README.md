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

## Dos modos de funcionamiento

- **Modo servidor (multiusuario)**: un servidor Node con base de datos SQLite integrada sirve la aplicación;
  los usuarios inician sesión, los datos, revisiones y configuración se comparten y el servidor aplica los
  permisos. Ver [docs/SERVIDOR.md](docs/SERVIDOR.md).
- **Modo local**: la web compilada funciona sin servidor; los datos se guardan solo en el navegador. Es el
  modo del artefacto de demostración.

La aplicación detecta el modo automáticamente al arrancar.

## Puesta en marcha

Requisitos: Node.js 22.13 o superior.

```bash
npm install
```

Modo servidor (recomendado para uso real):

```bash
npm run build:all
```

```bash
cp .env.example .env
```

```bash
npm run start:env
```

Desarrollo (en dos terminales):

```bash
npm run dev:server
```

```bash
npm run dev
```

Pulse **Cargar datos de demostración** (son ficticios) o importe sus Excel en **Importación de Excel**.

| Script | Qué hace |
|---|---|
| `npm run dev` | Interfaz en desarrollo (Vite) |
| `npm run dev:server` | Servidor en desarrollo (API en el puerto 3000) |
| `npm run build` | Comprobación de tipos + build de la web en `dist/` |
| `npm run build:server` | Build del servidor en `dist-server/server.mjs` |
| `npm run build:all` | Las dos anteriores |
| `npm start` / `npm run start:env` | Arranca el servidor (variables del entorno / del archivo `.env`) |
| `npm test` | 61 pruebas automatizadas (Vitest): motor, importación, integración, servidor y cálculo en segundo plano |
| `npm run samples` | Genera los Excel ficticios de ejemplo en `samples/` |
| `npm run e2e` | Prueba de extremo a extremo del modo local en Chromium (requiere `npm run build` y Playwright) |
| `npm run e2e:server` | Prueba de extremo a extremo del modo servidor con dos usuarios (requiere `npm run build:all`) |
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
- [Formato de los Excel reales (fichajes y Ortems)](docs/DATOS_REALES.md)
- [Modo servidor: instalación, seguridad y API](docs/SERVIDOR.md)
- [Pruebas](docs/PRUEBAS.md)

## Privacidad y seguridad

- En modo local, los datos importados se guardan **solo en el navegador** (IndexedDB). En modo servidor, en la
  base de datos del servidor de la empresa; nunca en servicios externos.
- Los archivos se validan antes de procesarse (extensión, firma binaria, tamaño). **Nunca se ejecutan macros**
  y las fórmulas no se evalúan: se usa el último resultado guardado en el archivo.
- Al exportar, los textos que empiezan por `=`, `+`, `-` o `@` se escapan para evitar la inyección de fórmulas.
- No hay credenciales en el código: la configuración del servidor se lee de variables de entorno (`.env.example`).
- Modo servidor: contraseñas con scrypt, sesiones en cookie HttpOnly/SameSite=Strict, bloqueo tras intentos
  fallidos, protección CSRF, permisos aplicados en el servidor y registro de actividad (ver docs/SERVIDOR.md).
- El análisis se calcula en un Web Worker para que la interfaz no se bloquee con grandes volúmenes.
