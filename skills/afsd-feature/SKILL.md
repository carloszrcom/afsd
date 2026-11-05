---
name: afsd-feature
description: Use when the user says "afsd feature" (with or without an idea) in an AFSD project. Creates a new feature with its first spec, or writes the next pending spec of the active feature, then stops for approval.
---

# afsd-feature

Convierte una idea en specs. **No escribas código de la app en esta skill.**

## 1. Leer lo mínimo
Lee `02-DOCS/wiki/estado.md` y `02-DOCS/wiki/arquitectura.md`. Nada más.
- Si falta `02-DOCS/`, di que hay que ejecutar `afsd init` (proyecto nuevo) o `afsd adopt` (existente) y para.
- Si **Reglas** de `arquitectura.md` está vacía o pendiente, avisa una vez de que conviene `afsd arch define` antes; sigue si el usuario dice que sí.
- Si hay feature activa y el usuario no trae idea nueva: escribe la **siguiente spec pendiente** de su `_feature.md` (salta al paso 4).
- Si hay feature activa y trae una idea nueva: pregunta si se pausa la actual o si la idea es parte de ella.
- **Modificación.** Si la idea cambia el comportamiento de algo ya hecho: localiza la spec afectada (`02-DOCS/specs/*/_feature.md` y `02-DOCS/specs/_actual/`; lee solo su título y sus criterios). Si el usuario no la indicó, propónla y confirma.
  La spec nueva es **otra spec** (siguiente `NN`) en la misma carpeta de esa feature, no una edición de la antigua: vuelve a poner `Estado: en curso` en su `_feature.md` y añade la fila.
  Pon en la spec nueva la línea `Modifica: <feature>/<NN-spec> (C<n>, C<m>)` con los criterios que cambian. Si el cambio es de una línea o un arreglo trivial, no uses esta skill: `afsd quick`.

## 2. Zona sin documentar (proyectos adoptados)
Si la feature toca una zona de código existente que no tiene retro-spec en `02-DOCS/specs/_actual/<zona>.md`:
lee solo el código y los tests de esa zona y escribe esa retro-spec (máximo 20 líneas: qué hace hoy, archivos, tests, límites).
Si la zona es grande, hazlo con un subagente.

## 3. Preguntar (máximo 5 preguntas, de una vez)
Solo lo que cambia el resultado: problema, quién lo usa, qué queda fuera, casos límite.
Cada pregunta con tu recomendación. No preguntes lo que puedas deducir de `arquitectura.md` o de la retro-spec.

## 4. Crear los archivos
`<slug>` = nombre en minúsculas con guiones.

`02-DOCS/specs/<slug>/_feature.md` (máximo 25 líneas; solo si la feature es nueva):
```
# <Feature>
Estado: en curso
## Por qué
## Objetivo
## Fuera de alcance
## Specs
| # | Spec | Estado | Depende de |
|---|------|--------|------------|
| 01 | <nombre> | borrador | - |
```

`02-DOCS/specs/<slug>/<NN>-<nombre>.md` (máximo 40 líneas):
```
# Spec <NN>: <nombre>
Estado: borrador
Modifica: <feature>/<NN-spec> (C<n>)   ← solo si cambia una spec ya hecha; si no, quita la línea
## Problema
## Comportamiento
## Criterios de aceptación
- [ ] C1 cada criterio se puede comprobar con un test o en el simulador
## Fuera de alcance
## Dudas
```

## 5. Partir si hace falta
Si la spec pasa de 8 criterios, o mezcla partes entregables por separado (interfaz, datos, pagos),
divídela y lista las specs en `_feature.md`. Empieza por la que desbloquea las demás.

## 6. Estado y aprobación
Reescribe `estado.md` (formato fijo) con: Feature activa, Spec activa <NN-nombre>, Fase: spec, Siguiente paso: aprobar la spec.
Muestra un resumen de cinco líneas y pide aprobación. No avances sin un sí claro.
Al aprobar: `Estado: aprobada` en la spec, fila `aprobada` en `_feature.md`, y en `estado.md` Fase: plan y Siguiente paso: `afsd plan`.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md`. **Si propones un chat nuevo, antes escribe la nota de sesión** (`02-DOCS/sessions/`, formato en `CLAUDE.md`) y actualiza `estado.md`; si sigues en este chat, no la escribas.
Termina con **Siguiente** y el prompt exacto.
Aquí: antes de aprobar, **en este chat**: `apruebo la spec` (o qué cambiar).
Después de aprobar, **en un chat nuevo**: `afsd plan`.
