---
name: afsd-init
description: Use when the user says "afsd init" to set up AFSD (Apple Feature-Spec Development) in a NEW or nearly empty Xcode project. For a project with existing development, use afsd-adopt.
---

# afsd-init

Prepara un proyecto de Xcode recién creado (por el usuario) para AFSD. Solo estructura: las decisiones de arquitectura las toma `afsd arch define` en el chat siguiente.
Nunca sobrescribas nada que ya exista: si un archivo existe, añade al final o salta.
Si el proyecto ya tiene bastante código, historial o documentación, di que lo adecuado es `afsd adopt` y para.

## 0. Requisito: proyecto de Xcode existente
Debe existir ya un proyecto creado en Xcode (`*.xcodeproj`, `*.xcworkspace` o `Package.swift` en la raíz o en una subcarpeta directa).
Si no existe, para y di en una línea: «Crea primero el proyecto en Xcode y vuelve a lanzar `afsd init`». **Nunca crees ni modifiques un proyecto de Xcode** (ni `project.pbxproj`).

## Pasos

1. Crea en la raíz (solo lo que falte):
   - `01-TOOLS/` con un `README.md` de una línea
   - `02-DOCS/wiki/`: `index.md` (mapa), `estado.md`, `arquitectura.md`, `decisions.md` (solo se añade), `lessons.md` (solo se añade; con el encabezado de `afsd-lessons`)
   - `02-DOCS/specs/`, `02-DOCS/sessions/` y `02-DOCS/archive/`, cada una con un `.gitkeep`
   En `index.md`, las rutas son relativas a `02-DOCS/wiki/` (por ejemplo `../../01-TOOLS/`).

2. Escribe `arquitectura.md` solo como esqueleto (sin decidir nada):

```
# Arquitectura
Huella: pendiente · Actualizado: <fecha>

## Actual
| Zona | Carpeta | Capa | Para qué |
|------|---------|------|----------|
| App | <carpeta de la app> | - | plantilla de Xcode |
Comandos: tests con `01-TOOLS/build/test.sh` · arquitectura con `bash 01-TOOLS/arch/check.sh` (lo crea `afsd arch define`)

## Objetivo
(pendiente: `afsd arch define`)

## Reglas
(pendiente: `afsd arch define`)
```

3. Crea `01-TOOLS/build/test.sh`. Scheme: el que incluye el target de tests (`xcodebuild -list`; si los tests viven en otro scheme, usa ese). Pregunta solo si no lo puedes deducir.
   **Simulador de pruebas: el que el usuario tenga seleccionado en Xcode** (destino activo). No lo cambies ni impongas otro (ni una iOS mínima): uno solo, el suyo.
   - Con MCP: léelo con `XcodeListRunDestinations` (`isActive`). Si es un dispositivo físico o `Any iOS …`, avisa y pide que elija un simulador en Xcode.
   - `test.sh` es solo el **respaldo sin MCP**. Pon en `DESTINO` el identificador (`id=<UDID>`) de ese simulador: es más robusto que el nombre (puede haber varios con el mismo). Sin MCP, usa el simulador arrancado (`xcrun simctl list devices booted`) o pregunta una vez.
   Contenido (si el comando falla antes de ejecutar tests, enseña el principio de la salida completa; si no, filtra para gastar pocos tokens):
```
#!/bin/zsh
# AFSD · respaldo de tests sin MCP: <iPhone …> · iOS <versión> (el simulador seleccionado en Xcode al hacer init). Para otro, cambia DESTINO.
DESTINO="platform=iOS Simulator,id=<UDID>"
LOG="${TMPDIR:-/tmp}/afsd-test.log"
xcodebuild test <-project X.xcodeproj | -workspace X.xcworkspace> -scheme "<scheme>" -destination "$DESTINO" -test-timeouts-enabled YES -default-test-execution-time-allowance 60 -maximum-test-execution-time-allowance 120 2>&1 | tee "$LOG" \
  | grep -E "error|failed|passed|Executed|✘|✔|\*\* (TEST|BUILD)" | tail -n 60
rc=${pipestatus[1]}
[ $rc -ne 0 ] && ! grep -qE -e "Executed" -e "\*\* TEST" "$LOG" && head -n 20 "$LOG"
exit $rc
```
   En `arquitectura.md`, línea **Comandos** de Actual, añade `· simulador: el activo en Xcode`.
   Dale permiso de ejecución (`chmod +x`) y, si hay git, `git update-index --chmod=+x 01-TOOLS/build/test.sh`. Si no queda ejecutable, se lanza con `zsh 01-TOOLS/build/test.sh`.

4. Si no existe `.gitignore`, créalo con `xcuserdata/`, `.DS_Store` y `DerivedData/`.
   Si ya existe, no lo modifiques: di qué de esas entradas falta y añádelas solo si el usuario dice que sí.

5. Crea `CLAUDE.md` con este bloque (o añádelo al final si ya existe). Si ya hay un bloque `## AFSD` de una versión anterior del plug-in, sustitúyelo por este y muestra el cambio:

```
## AFSD
- Al empezar: si no los tienes ya en contexto (en Claude Code los inyecta el hook de AFSD), lee `02-DOCS/wiki/estado.md` y la nota más reciente de `02-DOCS/sessions/`. Si responden lo que necesitas, no explores el proyecto.
- Mapa completo: `02-DOCS/wiki/index.md` (léelo solo si la tarea toca otra zona).
- Regla: no se escribe código de una feature nueva sin spec aprobada.
- Arquitectura: respeta las Reglas de `02-DOCS/wiki/arquitectura.md`. Si cambias la estructura (targets, carpetas, dependencias), ejecuta `bash 01-TOOLS/arch/check.sh`; la sección Actual y la huella las actualiza `afsd close` (fuera del flujo, `afsd arch sync`).
- Compilar, tests y previews: usa las herramientas MCP de Xcode si están. Tests y previews se hacen en el simulador que el usuario tiene seleccionado en Xcode (destino activo): no lo cambies. Si el destino activo no es un simulador (dispositivo físico o `Any iOS …`), avisa y para. Si una llamada falla por falta de aprobación o no hay ventana, abre el proyecto con `XcodeOpenWorkspace` (con el servicio headless es obligatorio y devuelve el `workspaceIdentifier` que sustituye a `tabIdentifier`). Con Swift Testing, el resumen de `RunAllTests`/`RunSomeTests` puede salir vacío (`total: 0`) aunque los tests pasen: no lo des por bueno ni por malo; lee el log de consola que devuelve la herramienta (`passed`/`failed` y `** TEST FINISHED **`) y exige al menos un test ejecutado; si no puedes, usa `01-TOOLS/build/test.sh`. Sin MCP: `01-TOOLS/build/test.sh`.
- Tests que no se cuelgan: todo test con async, streams, continuations o confirmaciones lleva `.timeLimit(.minutes(1))` (mejor en el `@Suite`); nunca un `await` o `for await` sin límite: suscríbete antes de provocar el evento y toma solo el primer valor esperado. Si `RunAllTests` no responde en unos minutos, páralo (en Xcode, ⌘.) y trátalo como test colgado: el que aparece `started` sin `passed`/`failed` en el log; arréglalo antes de seguir.
- Decisiones: añade al final de `02-DOCS/wiki/decisions.md` `- D-NN · <fecha> · <spec> · <decisión> · <por qué>` (nunca se borra nada).
- Lecciones: si el usuario te corrige o algo falla dos veces, aplica `afsd-lessons` (se anota en `02-DOCS/wiki/lessons.md`; las repetidas pasan, con permiso, a `## Reglas aprendidas` de este archivo).
- Cambio de chat: al acabar una fase o una tarea, o si llevas varios archivos grandes leídos, salidas largas de build/tests o empiezas a repetirte, para y propón un chat nuevo.
- Solo si se cambia de chat: antes escribe `02-DOCS/sessions/<fecha>-<feature>-<NN-spec>.md` (si existe, reescríbela entera; máx. 10 líneas) y actualiza `estado.md`.
  Formato: `# Sesión <fecha> · <feature>/<NN-spec>` y las líneas `- Hecho:`, `- Pendiente:`, `- Archivos tocados:`, `- Siguiente: <prompt exacto>`.
- Al terminar cada paso, cierra siempre así, sin variaciones: `**Siguiente — <en este chat | en un chat nuevo>:**` y debajo el prompt exacto en un bloque de código.
```

6. Escribe `estado.md` con este formato exacto (las demás skills lo leen y lo reescriben):

```
# Estado
- Feature activa: <slug o ninguna>
- Spec activa: <NN-spec o ninguna>
- Fase: <spec | plan | implementación | cierre | ninguna>
- Siguiente paso: <prompt exacto del siguiente paso>
- Actualizado: <fecha>
```

   Con: Feature activa ninguna, Spec activa ninguna, Fase ninguna, Siguiente paso `afsd arch define`.

7. Resume en tres líneas qué has creado.

## Commit del andamiaje (opcional)
Al final, si hay git, muestra `git status --short` limitado a lo creado/modificado por AFSD (`01-TOOLS/`, `02-DOCS/`, `CLAUDE.md`/`AGENTS.md`, `.gitignore`) y ofrece un commit solo con esos archivos: `chore: añade AFSD`. Hazlo solo tras confirmación; no hagas push ni incluyas otros cambios del usuario. Sin git, omite esto.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md`. **Si propones un chat nuevo, antes escribe la nota de sesión** (`02-DOCS/sessions/`, formato en `CLAUDE.md`) y actualiza `estado.md`; si sigues en este chat, no la escribas.
Termina con **Siguiente** y el prompt exacto.
Aquí: **en un chat nuevo**: `afsd arch define`.
