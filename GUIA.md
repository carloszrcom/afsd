# AFSD · guía rápida

Arranca siempre con `cxa` (Claude Code con las skills de Apple + AFSD) desde la carpeta del proyecto.
Cada paso termina con **Siguiente** y el prompt exacto: pégalo tal cual (en este chat o en uno nuevo).

## 1. App nueva
1. Crea el proyecto en Xcode (con target de tests) y haz el primer commit. AFSD **nunca** crea proyectos: si no hay, `init` se para.
2. `afsd init` (al final ofrece el commit del andamiaje: responde `sí`)
3. Chat nuevo: `afsd arch define` (acepta el preset o ajusta; 1–3 preguntas)
4. Commit de lo que cambie `arch define` (`CLAUDE.md`, `02-DOCS`).
5. Sigue en **3. Feature desde cero**.

## 2. App que ya estaba en desarrollo
1. Rama nueva (`git switch -c afsd-adopt`): `adopt` no cambia código, pero revisa el diff.
2. `afsd adopt` (mapa barato + línea base de tests). Si queda a medias: chat nuevo con `afsd arch sync`.
3. Opcional: chat nuevo con `afsd arch define` para fijar reglas (o ve directo a una feature).
4. Revisa `02-DOCS/wiki/arquitectura.md`. `adopt` ofrece al final el commit del andamiaje (`sí`). Sigue en 3 o 4.

## 3. Feature desde cero (paso a paso)
1. `afsd feature <idea en una frase>` → responde las preguntas (`ok a todo` si aceptas) → `apruebo la spec`
2. Chat nuevo: `afsd plan` → `apruebo el plan` → `empieza por T1 y encadena las tareas de código; para si algo falla`
3. Si el chat se alarga, el plugin propone otro: pega su `afsd plan — continúa por T<n> …`
4. Pruebas tú lo visual en el simulador.
5. Chat nuevo: `afsd close` → `confirmado, todo correcto` → revisa los archivos → `haz el commit`
   (si `project.pbxproj` u otros cambios no son de la feature: `haz el commit sin <archivo>`).

## 4. Feature desde cero en automático
1. `afsd auto <idea>` (o `afsd auto --plan <idea>` si quieres aprobar también el plan)
2. Responde las preguntas → `apruebo la spec`. Lo demás lo hacen subagentes.
3. Cuando lo pida: pruebas lo visual → `confirmado` → revisas archivos → `haz el commit`.
4. Si un subagente falla, para y te da el prompt para seguir a mano (como en 3).

## 5. Modificar una feature existente (app ya con AFSD)
1. `afsd feature <qué cambia en <feature>>` — detecta la spec afectada y crea una spec nueva con `Modifica: <feature>/<NN> (Cn)`.
2. Igual que en 3 (o 4). El plan incluye actualizar los tests que dejan de ser ciertos.
3. `afsd close` reescribe los criterios de la spec antigua y la marca `Modificada por: …`.

## 6. Cambio pequeño: `afsd quick <cambio>`
Hasta ~3 archivos, sin comportamiento nuevo (arreglo, texto, ajuste). Sin spec ni plan: hace el cambio, pasa tests y `check.sh`, y pide confirmación para el commit. Si no cabe, te manda a `afsd feature`.

## 7. Lecciones (por proyecto)
Si corriges al agente o algo falla dos veces, `afsd-lessons` lo anota solo en `02-DOCS/wiki/lessons.md` y el chat sigue.
Cuando una lección se repite, te enseña una regla de una línea para `CLAUDE.md` y espera tu `sí`.
De vez en cuando: `afsd lessons review` (agrupa, propone fusionar y archivar). Las lecciones no salen del proyecto.
Proyectos ya creados: sustituye su bloque `## AFSD` de `CLAUDE.md` por el de `skills/afsd-init/SKILL.md` (paso 5) para que el agente use las lecciones.

## 8. App o juego entero desde el documento de diseño (automático)
0. Requisitos: workflows activos (en Pro: `/config` → Dynamic workflows), MCP de Xcode activo y un simulador elegido en Xcode.
1. Crea el proyecto en Xcode (con target de tests), `git init` y primer commit.
2. Copia el documento al proyecto (p. ej. `docs/diseno.md`) y haz commit.
3. `cxa` → `afsd init` (comprueba una vez que el scheme es testable y que el simulador activo cumple la iOS mínima de los targets; si no, para y te dice cómo arreglarlo) → `/clear` → `afsd arch define` (si hay compras: «sí, pagos con RevenueCat»). Commit.
4. `/clear` → `afsd build plan docs/diseno.md` → responde las preguntas → `apruebo el roadmap` → acepta los permisos que propone.
5. `/afsd:build` (prueba corta: `/afsd:build con maxSpecs 3`). Sigue el progreso con `/workflows`; deja el Mac despierto (`caffeinate -dims` en otra terminal).
   - **Parar sin cortar a mitad de spec:** `/afsd:stop` (o `touch 02-DOCS/build/STOP`): acaba la spec en curso, hace su commit y se detiene. Para seguir: `/afsd:resume` (o `rm 02-DOCS/build/STOP`) y `/afsd:build`.
   - **Parar al instante:** cancela. Se retoma igual, pero puede repetir la tarea en curso.
   - **Retomar:** `/afsd:build` siempre sigue por la primera spec pendiente; no hace falta pedirle que revise los docs.
   - **Spec «pendiente de decisión»:** el agente anotó una decisión `[bloqueante]` en `decisions.md`. Cambia `[bloqueante]` por `[decidido]` (puedes corregir el texto) y relanza.
   - **Cuelgue de un test:** si en `/workflows` ves «(retry N)» en un agente, o el workflow escribe `⚠ CUELGUE en <spec>`, un test no termina (el círculo de Xcode sigue girando). En Xcode busca el test con «started» sin resultado y páralo con ⌘.; el workflow lo intenta arreglar solo (los tests con async llevan `.timeLimit`). Si no se recupera, la spec queda bloqueada con el motivo en el informe.
   - **Coste:** `02-DOCS/build/coste.md` (minutos, rondas, arreglos, tests por spec); los tokens, en `/workflows`.
6. Al terminar: `/clear` → `afsd build report` → prueba en el simulador lo que te diga → ajustes con `afsd quick` o `afsd feature`.
7. Merge de la rama `afsd/build` cuando te guste. Pagos reales: `afsd feature pagos-revenuecat`.

## Simulador de pruebas
Los tests y las previews usan **el simulador que tengas seleccionado en Xcode**. Elígelo antes de empezar (un simulador, no un dispositivo físico) y AFSD no lo cambia.
Sin MCP, `01-TOOLS/build/test.sh` usa el que estaba seleccionado al hacer `afsd init`; para otro, cambia `DESTINO` en ese archivo.

## Si algo va raro
- `afsd ping` → comprueba que el plugin carga (versión, hooks, proyecto).
- Una ejecución de tests que no acaba → test colgado: ⌘. en Xcode y mira el test «started» sin `passed`/`failed` en la consola.
- `bash 01-TOOLS/arch/check.sh` → huella y violaciones de arquitectura.
- `afsd arch sync` → rehace el mapa si cambiaste estructura fuera del flujo.
- Sin probar aún en real: `adopt`, `auto`, `quick`, `lessons`, `build` y los hooks (en `build`, lo nuevo de 0.10.0: `/afsd:stop`, `/afsd:resume`, `[bloqueante]` y el coste).
- Estado actual: `02-DOCS/wiki/estado.md`.
