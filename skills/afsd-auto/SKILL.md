---
name: afsd-auto
description: Use when the user says "afsd auto <idea>" in an AFSD project, in Claude Code. Runs a whole feature (spec, plan, implementation, close) with one subagent per phase, stopping only for spec approval, manual checks and the commit.
---

# afsd-auto

Hace una feature entera con subagentes: cada fase arranca con el contexto vacío y devuelve un resumen corto, así este chat apenas crece (ahorro de tokens).
Solo para Claude Code (necesita la herramienta de subagentes). Si no la tienes, di que no está disponible y propone el flujo manual (`afsd feature`).
Opción `afsd auto --plan <idea>`: además se para a que apruebes el plan antes de implementar.

## Reglas del orquestador (este chat)
- **No leas código ni archivos del proyecto**: solo `estado.md` al empezar y los resúmenes de los subagentes. Todo lo demás lo hace un subagente.
- Entre fases, una sola línea de progreso para el usuario.
- Nunca propongas "un chat nuevo" salvo fallo (ver abajo); si lo haces, antes escribe la nota de sesión (formato de `CLAUDE.md`).
- Si falta `02-DOCS/`, di que hay que ejecutar `afsd init` o `afsd adopt` y para.

## Fases
1. **Spec (aquí, con el usuario).** Carga la skill `afsd-feature` con la herramienta Skill y sigue sus pasos: preguntas, spec, **parar hasta que el usuario apruebe**. Esta es la única decisión que no se automatiza. Con "apruebo la spec", sigue.
2. **Plan (subagente).** Lanza un subagente `general-purpose` con la plantilla de abajo para `afsd-plan` pasos 1–3. En automático el plan se da por aprobado: `Estado: aprobado`, fase implementación. Con `--plan`: muestra el resumen de 5 líneas y espera "apruebo el plan".
3. **Implementar (subagentes en bucle).** Cada subagente hace como máximo **3 tareas** `[ ]` consecutivas del plan que no requieran el simulador, siguiendo `afsd-plan` paso 4, y devuelve el resumen. Repite hasta que no queden tareas de código. Las tareas que solo se pueden comprobar en el simulador pasan a `[~]` y no se intentan.
4. **Verificar (subagente).** `afsd-close` pasos 1–2 (tests, `check.sh`, criterios). Sin commit. Devuelve: criterios `[x]` con su prueba, los `[~]` pendientes y los archivos cambiados.
5. **Revisión manual (aquí).** Lista los `[~]` en pocas líneas y pide al usuario que los pruebe en el simulador. Con "confirmado", sigue.
6. **Cerrar (subagente).** `afsd-close` pasos 3–5 (marcar, decisiones, lecciones, Actual y huella, estado). Después **pide confirmación del commit** mostrando los archivos (no incluyas cambios ajenos a la feature, p. ej. `project.pbxproj` si no los hizo la spec). Con el sí, haz el commit.

## Plantilla del subagente
```
Eres una fase de AFSD en modo automático. Proyecto: <ruta>. Feature: <feature>/<NN-spec>.
1. Lee solo `02-DOCS/wiki/estado.md`, la spec y su `.plan.md`.
2. Carga la skill `afsd-<fase>` (herramienta Skill) y ejecuta SOLO: <pasos>.
3. En automático no hay parada de aprobación; no hagas preguntas. Nunca marques `[x]` sin prueba. No hagas push ni commit (salvo que se indique).
4. Para y devuelve el fallo si: un test falla, `bash 01-TOOLS/arch/check.sh` da una violación en archivos de esta spec, algo obliga a cambiar la spec o no se resuelve tras 2 intentos.
5. Actualiza `estado.md` y las casillas del plan.
Devuelve como máximo 8 líneas: hecho, tareas marcadas, fallos, siguiente.
```

## Si un subagente falla
No reintentes en bucle. Escribe la nota de sesión, deja `estado.md` en la tarea que falló y dile al usuario qué falló y cómo seguir:

**Siguiente — en un chat nuevo:**
```
afsd plan — continúa por T<n> de <feature>/<NN-spec>
```
