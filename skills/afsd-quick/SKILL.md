---
name: afsd-quick
description: Use when the user says "afsd quick <cambio>" for a small change or trivial fix in an AFSD project (up to 2–3 files, no new behaviour to specify). No spec or plan; tests and architecture check still run.
---

# afsd-quick

Cambio pequeño sin spec ni plan. Si no cabe en esto, no lo fuerces: usa `afsd feature`.

## 1. Decidir si cabe
Cabe si: toca como máximo 3 archivos, no añade comportamiento nuevo que merezca criterios, no crea pantallas ni estados nuevos y no cambia el modelo de datos.
Si no cabe (o si cambia comportamiento de una spec ya hecha), dilo en una línea y propón `afsd feature <idea>` o `afsd auto <idea>`. Para.

## 2. Preparar
- Lee `02-DOCS/wiki/arquitectura.md` (solo **Reglas**) y, si lo necesitas, `estado.md` (no lo modifiques: puede haber una feature en curso).
- Crea el marcador `02-DOCS/.quick` (`touch`): el hook de AFSD no pedirá confirmación al editar `.swift` mientras sea reciente. Bórralo al terminar (con `rm`, o con `rm` fallido, déjalo: caduca en 30 min).

## 3. Hacer y comprobar
- Haz el cambio. Si arregla un fallo, añade o ajusta el test que lo habría detectado.
- Ejecuta los tests (herramientas MCP de Xcode si están, en el destino activo de Xcode; si no, `zsh 01-TOOLS/build/test.sh`) y `bash 01-TOOLS/arch/check.sh`.
- No marques como hecho sin esa prueba. Si falla, corrige; si no se resuelve a los 2 intentos, para y explícalo.
- Si algo es visual, dilo: queda para que el usuario lo compruebe.

## 4. Registrar y cerrar
- `decisions.md`: solo si hubo una decisión no obvia (`- D-NN · <fecha> · quick · <decisión> · <por qué>`). Lecciones: solo si algo sorprendió o te corrigieron (`afsd-lessons`).
- Si cambió la estructura (huella *cambiada*), ejecuta `afsd arch sync` en un chat aparte, o dilo al usuario.
- Muestra los archivos cambiados y pide confirmación. Con el sí, commit: `fix(<zona>): <resumen>` (o `chore`/`refactor`). No hagas push. No incluyas cambios ajenos.

## Al terminar
Termina con **Siguiente** y el prompt exacto: normalmente, el *Siguiente paso* que ya tenía `estado.md`, en este chat si sigue corto.
