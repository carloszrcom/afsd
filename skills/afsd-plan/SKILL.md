---
name: afsd-plan
description: Use when the user says "afsd plan" or wants to plan or continue implementing the active spec of an AFSD project. Writes the task plan to a file, stops for approval, then implements task by task.
---

# afsd-plan

## 1. Leer lo mínimo
Lee `02-DOCS/wiki/estado.md`, la nota más reciente de `02-DOCS/sessions/` si es de esta spec, la spec activa y `arquitectura.md`.
Si la spec no está `aprobada`, dilo y para. Si ya existe su `.plan.md` aprobado, salta al paso 4 (continuar).

## 2. Escribir el plan en un archivo
`02-DOCS/specs/<feature>/<NN>-<spec>.plan.md` (máximo 40 líneas):
```
# Plan: <NN>-<spec>
Estado: borrador
## Tareas
- [ ] T1 <qué> · Archivos: <rutas> · Comprobación: <test o paso concreto> · (cubre C1)
- [ ] T2 ...
## Riesgos
## Decisiones pendientes
```
Reglas:
- Cada tarea es pequeña y tiene una comprobación concreta.
- Cada criterio de aceptación está cubierto por al menos una tarea.
- Primero tests o modelo, después vista, al final integración.
- Si la spec tiene `Modifica:`, incluye una tarea para actualizar los tests existentes que dejan de ser ciertos (y para añadir los nuevos).
- Sin tareas de documentación ni de cierre: eso es `afsd close`.

## 3. Parar
Resume el plan en cinco líneas y pide aprobación (el usuario puede editarlo con `/plan` de Xcode).
Al aprobar: `Estado: aprobado` en el plan; en `estado.md`, Fase: implementación y Siguiente paso: `afsd plan` (T1).

## 4. Implementar
- Haz la primera tarea `[ ]`. Ejecuta su comprobación (build y tests con las herramientas MCP de Xcode si están; si no, `01-TOOLS/build/test.sh`).
- Solo si pasa, márcala `[x]` y actualiza "Siguiente paso" en `estado.md`.
- Decisión no obvia (dependencia, cambio de proyecto, desvío del plan): una línea en `decisions.md`
  con `- D-NN · <fecha> · <spec> · <decisión> · <por qué>`.
- Respeta las Reglas de `arquitectura.md`. Si cambias la estructura, ejecuta `bash 01-TOOLS/arch/check.sh` (si existe) y corrige las violaciones. No toques la sección Actual ni la huella: eso lo hace `afsd close`.
- Tareas pequeñas: puedes encadenar varias. Tras cada tarea, decide si cambiar de chat según la regla de `CLAUDE.md`.
- No marques la spec ni la feature como hechas.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md`. **Si propones un chat nuevo, antes escribe la nota de sesión** (`02-DOCS/sessions/`, formato en `CLAUDE.md`) y actualiza `estado.md`; si sigues en este chat, no la escribas.
Termina con **Siguiente** y el prompt exacto.
Aquí:
- Plan escrito, sin aprobar → **en este chat**: `apruebo el plan` (o qué cambiar).
- Plan aprobado y chat todavía corto → **en este chat**: `empieza por T1`.
- Plan aprobado y chat largo, o a mitad de la implementación → **en un chat nuevo**: `afsd plan — continúa por T<n> de <feature>/<NN-spec>`.
- Todas las tareas `[x]` → **en un chat nuevo**: `afsd close`.
