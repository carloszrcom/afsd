---
name: afsd-close
description: Use when the user says "afsd close" or all tasks of the active spec are done in an AFSD project. Verifies acceptance criteria with evidence, records decisions and lessons, updates docs and commits.
---

# afsd-close

## 1. Leer lo mínimo
Lee `02-DOCS/wiki/estado.md`, la spec activa, su `.plan.md` y `_feature.md`.
Si quedan tareas `[ ]` en el plan, dilo y para. Si no hay plan, avísalo y sigue con los criterios de la spec.

## 2. Verificar con pruebas
- Compila y ejecuta los tests (herramientas MCP de Xcode si están; si no, `01-TOOLS/build/test.sh`). Compara con la línea base de `arquitectura.md` si existe.
- Si existe `01-TOOLS/arch/check.sh`, ejecútalo con `bash 01-TOOLS/arch/check.sh`. Una violación en archivos que tocó esta spec cuenta como criterio `[ ]`: explícala y para (o, si el usuario lo decide, regístrala como excepción en `decisions.md`).
  Las violaciones en archivos que no tocó la spec son anteriores: menciónalas en una línea, no bloquean.
- Para criterios visuales, renderiza la preview si puedes.
- Cada criterio queda en uno de tres estados:
  - `[x]` comprobado: di con qué (test, build, preview).
  - `[ ]` falla: explica el fallo y para. No cierres.
  - `[~]` sin comprobar: necesita revisión manual del usuario.
- Nunca marques `[x]` sin prueba.
- Si el comportamiento real difiere de lo que dice la spec (por ejemplo, un control del sistema que funciona distinto),
  corrige primero el texto de la spec y del criterio, avisa al usuario en una línea y después marca.

## 3. Revisión manual
Si hay `[~]`, lístalos en dos o tres líneas y pide al usuario que los compruebe.
Cuando confirme, pásalos a `[x]` con "(revisado por el usuario)".

## 4. Registrar
- `decisions.md`: decisiones de esta spec que falten (`- D-NN · <fecha> · <spec> · <decisión> · <por qué>`).
- `lessons.md`: si algo falló o sorprendió, `- <fecha> · <situación> · <lección>`.
  Si la lección ya estaba, conviértela en una regla de una línea en `CLAUDE.md`.
- Si la spec tiene `Modifica: <feature>/<NN-spec>`: en esa spec anterior, reescribe los criterios afectados con el comportamiento nuevo (o márcalos `~~Cn~~ sustituido por <NN>/Cn`) y añade bajo `Estado:` la línea `Modificada por: <esta spec>`. Si existe su retro-spec en `_actual/`, actualízala. Muéstralo en una línea.
- `arquitectura.md`: si `check.sh` dijo *Huella: cambiada*, actualiza **Actual** (lo construido del **Objetivo** pasa a Actual) y guarda la huella nueva (`bash 01-TOOLS/arch/check.sh --huella`) y la fecha. No cambies las Reglas sin permiso.

## 5. Cerrar
- Spec `Estado: hecha`, plan `Estado: hecho`, fila de la spec en `_feature.md`: hecha.
- Si todas las specs están hechas: `_feature.md` `Estado: hecha`.
- Reescribe `estado.md` entero con este formato (sin otras líneas):

```
# Estado
- Feature activa: <slug o ninguna>
- Spec activa: <NN-spec o ninguna>
- Fase: <spec | plan | implementación | cierre | ninguna>
- Siguiente paso: <prompt exacto del siguiente paso>
- Actualizado: <fecha>
```

## 6. Commit
Muestra los archivos cambiados y pide confirmación. Luego un commit:
`feat(<feature>): <spec> — <resumen en una línea>`. No hagas push.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md`. **Si propones un chat nuevo, antes escribe la nota de sesión** (`02-DOCS/sessions/`, formato en `CLAUDE.md`) y actualiza `estado.md`; si sigues en este chat, no la escribas.
Termina con **Siguiente** y el prompt exacto.
Aquí:
- Criterios `[~]` pendientes → **en este chat**: `confirmado, todo correcto` (o describe qué falla).
- Commit hecho y quedan specs en la feature → **en un chat nuevo**: `afsd feature` (escribe la spec <NN> de <feature>).
- Commit hecho y la feature está terminada → **en un chat nuevo**: `afsd feature <describe la siguiente feature en una frase>`.
