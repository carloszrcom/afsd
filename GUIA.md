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

## Si algo va raro
- `afsd ping` → comprueba que el plugin carga (versión, hooks, proyecto).
- `bash 01-TOOLS/arch/check.sh` → huella y violaciones de arquitectura.
- `afsd arch sync` → rehace el mapa si cambiaste estructura fuera del flujo.
- Sin probar aún en real: `adopt`, `auto`, `quick` y los hooks.
- Estado actual: `02-DOCS/wiki/estado.md`.
