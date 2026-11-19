# Reglas de negocio y criterios de cálculo

Todas las reglas están en `src/engine/` y son configurables en **Configuración** cuando corresponde.
Principio general: **si los datos no permiten un resultado fiable, se indica; nunca se inventa**.

## Fechas

- Se distinguen: inicio/fin **previstos**, inicio/fin **reales**, **fecha objetivo** (entrega) y fechas de **Ortems**.
  Si el Excel no trae fechas reales, se indica «Sin datos reales»; nunca se rellenan.
- Las fechas son hora local tal cual aparecen en el Excel (sin conversiones de zona horaria).
- **Semanas ISO 8601**: de lunes a domingo; la semana 1 contiene el primer jueves del año. El filtro de semana
  exige elegir el año ISO (el 1/1/2027 pertenece a la semana 53 de 2026).
- Fecha de referencia (retrasos y análisis futuro): hoy, o la configurada.

## Correspondencia producción ↔ Ortems

1. Se aplican las reglas en orden de prioridad (por defecto: orden + operación → orden → preorden).
2. Solo coincidencias **exactas** (opcional: ignorar mayúsculas y espacios; opcional: ignorar ceros a la izquierda).
3. Si una regla encuentra **varias candidatas**, el registro queda **ambiguo** y no se empareja.
4. Una regla con operación o puesto empareja a nivel de **operación**; las demás, a nivel de **orden**.

## Comparación de fechas

- Desfase = **producción − Ortems** (positivo: producción más tarde), en **días laborables** (calendario global)
  y en **horas**.
- **Tolerancia** configurable (por defecto 1 día laborable): por debajo, las fechas coinciden.
- Criticidad del desfase: media; **alta** a partir de 5 días laborables (configurable).
- **Crítica**: orden de prioridad alta que producción termina más tarde que Ortems, u orden/preorden de prioridad
  alta que está en Ortems y no en producción («orden prioritaria pendiente de programación»).
- **Prioridad invertida**: en el mismo puesto, Ortems programa antes la orden más prioritaria y producción la
  programa detrás de otra menos prioritaria (ventana de 14 días). Alta si la orden afectada es de prioridad alta.
- **Cambio de prioridad**: comparación con la importación anterior de Ortems.
- **Precedencia en Ortems**: Ortems inicia una operación antes de que termine su predecesora (alta si la
  dependencia es confirmada, media si es inferida).
- **Operaciones terminadas** que Ortems ya no planifica: informativo (un APS no exporta lo terminado).

## Prioridad

Interpretación configurable: «menor valor = más prioritario» (por defecto) o al revés; umbral de prioridad alta
(por defecto ≤ 2). Las prioridades en texto («Urgente», «Alta»…) se traducen con una tabla configurable y se
conserva siempre el texto original.

## Dependencias

| Regla | Tipo | Por defecto |
|---|---|---|
| Columna «Operación precedente» | Confirmada | Siempre (si existe) |
| Secuencia por número de operación dentro de la orden (0010 → 0020; secuencias iguales = paralelas) | Inferida | Activa |
| La orden hija termina antes de empezar la orden padre (solo con relación padre confirmada o validada) | Inferida | Activa |
| Heredar el aparato a través de la estructura de órdenes | Inferida | Activa |

Si una orden tiene precedentes explícitas, no se infiere su secuencia. No se supone que las operaciones de una
orden sean consecutivas salvo por estas reglas, todas desactivables.

## Retrasos y adelantos

- **Retrasada**: fin previsto anterior a la referencia sin fin real ni estado «terminada»
  (si el Excel no trae estado, se marca como **posible** retraso); fin real posterior al previsto más la
  tolerancia; fin posterior a la fecha objetivo; o fin de producción posterior al de Ortems.
- **Adelantada**: inicio de producción anterior al de Ortems más allá de la tolerancia.

## Capacidad y carga

- Capacidad diaria del puesto = horas por unidad del día de la semana × **unidades en paralelo** × **eficiencia**.
  Festivos y **paradas planificadas** dan capacidad 0; los **horarios especiales** sustituyen las horas de un día.
- **Sin capacidad configurada no se calcula ocupación**: se muestra la carga y se indica «sin capacidad conocida».
  Opcionalmente se puede activar una capacidad **supuesta**: todo lo que se calcule con ella se marca como **estimado**.
- Horas de una operación: duración del Excel; si falta y está permitido, **estimada** a partir de las fechas
  (horas del intervalo en días laborables, limitadas a las horas diarias del puesto).
- Reparto: las horas se reparten entre los días laborables del intervalo, en proporción a la capacidad diaria.
- Sección: suma de sus puestos. Si solo algunos tienen capacidad, la ocupación se calcula sobre esos y se marca
  como **parcial (estimada)**.
- Carga **combinada** = producción + órdenes/preórdenes que solo están en Ortems.

## Solapamientos

Se agrupan las operaciones de un mismo puesto que coinciden en el tiempo (los intervalos contiguos no solapan)
y se calcula la simultaneidad máxima:

| Clase | Condición |
|---|---|
| Solapamiento detectado (dentro de capacidad) | Simultaneidad ≤ unidades configuradas |
| Solapamiento potencialmente conflictivo | Capacidad paralela desconocida |
| **Sobrecarga confirmada** | Simultaneidad > unidades configuradas |
| Sobrecarga estimada | Simultaneidad > unidades supuestas |

## Cuellos de botella

- Ocupación ≥ umbral de riesgo (85 %, configurable) = **riesgo**; > 100 % = **saturado**.
- Certeza: **confirmado** (capacidad configurada y carga mayoritariamente con duración del Excel),
  **estimado** (capacidad supuesta o parcial, o duraciones estimadas), **sin capacidad conocida**.
- Previsiones en el horizonte configurado (8 semanas), con mensajes calculados, p. ej.:
  «El puesto de trabajo 05 presenta una ocupación prevista del 112 % durante la semana 43 de 2026
  (carga 44,8 h / capacidad 40 h).» — verificado en las pruebas automatizadas.

## Alertas

Criticidad: crítica, alta, media, informativa. Cada alerta tiene descripción, aparato, orden, operación,
puesto o sección, fecha, fuente (producción, Ortems, ambas, cálculo), motivo, registros de origen y estado de
revisión (pendiente, revisada, descartada) con nota, usuario y fecha. El identificador de cada alerta es estable,
de modo que su revisión se conserva mientras la alerta siga existiendo tras una nueva importación.
