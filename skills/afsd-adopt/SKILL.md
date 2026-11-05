---
name: afsd-adopt
description: Use when the user says "afsd adopt" to add AFSD to an Xcode project that already has development (code, git history, docs). Builds a cheap project map without documenting every feature.
---

# afsd-adopt

Adapta un proyecto existente a AFSD gastando pocos tokens. **No documentes features ahora**: se documentan cuando se vayan a tocar (lo hace `afsd feature`).
No cambies código de la app. Nunca sobrescribas nada que ya exista.

## 0. Requisito: proyecto de Xcode existente
Debe existir ya un proyecto creado en Xcode (`*.xcodeproj`, `*.xcworkspace` o `Package.swift` en la raíz o en una subcarpeta directa).
Si no existe, para y di en una línea: «Crea primero el proyecto en Xcode y vuelve a lanzar `afsd adopt`». **Nunca crees ni modifiques un proyecto de Xcode** (ni `project.pbxproj`).

## 1. Estructura
Crea solo lo que falte: `01-TOOLS/`, `02-DOCS/wiki/` (`index.md`, `estado.md`, `arquitectura.md`, `decisions.md`, `lessons.md`),
`02-DOCS/specs/`, `02-DOCS/sessions/` y `02-DOCS/archive/` (con `.gitkeep`), `01-TOOLS/build/test.sh` (pregunta scheme y simulador si no los deduces de `xcodebuild -list`; `chmod +x`)
y `.gitignore` solo si no existe (si existe, di qué falta de `xcuserdata/`, `.DS_Store`, `DerivedData/` y añádelo solo con permiso).
`estado.md` con este formato exacto:

```
# Estado
- Feature activa: <slug o ninguna>
- Spec activa: <NN-spec o ninguna>
- Fase: <spec | plan | implementación | cierre | ninguna>
- Siguiente paso: <prompt exacto del siguiente paso>
- Actualizado: <fecha>
```

Si ya hay `CLAUDE.md` o `AGENTS.md`, consérvalo y añade al final este bloque (si ya hay un bloque `## AFSD` de una versión anterior del plug-in, sustitúyelo y muestra el cambio).
Si el archivo supera 200 líneas, propón mover lo que sobre a `02-DOCS/wiki/` (solo con permiso):

```
## AFSD
- Al empezar: si no los tienes ya en contexto (en Claude Code los inyecta el hook de AFSD), lee `02-DOCS/wiki/estado.md` y la nota más reciente de `02-DOCS/sessions/`. Si responden lo que necesitas, no explores el proyecto.
- Mapa completo: `02-DOCS/wiki/index.md` (léelo solo si la tarea toca otra zona).
- Regla: no se escribe código de una feature nueva sin spec aprobada.
- Arquitectura: respeta las Reglas de `02-DOCS/wiki/arquitectura.md`. Si cambias la estructura (targets, carpetas, dependencias), ejecuta `bash 01-TOOLS/arch/check.sh`; la sección Actual y la huella las actualiza `afsd close` (fuera del flujo, `afsd arch sync`).
- Compilar, tests y previews: usa las herramientas MCP de Xcode si están disponibles; si no, `01-TOOLS/build/test.sh`.
- Decisiones: añade al final de `02-DOCS/wiki/decisions.md` `- D-NN · <fecha> · <spec> · <decisión> · <por qué>` (nunca se borra nada).
- Cambio de chat: al acabar una fase o una tarea, o si llevas varios archivos grandes leídos, salidas largas de build/tests o empiezas a repetirte, para y propón un chat nuevo.
- Solo si se cambia de chat: antes escribe `02-DOCS/sessions/<fecha>-<feature>-<NN-spec>.md` (si existe, reescríbela entera; máx. 10 líneas) y actualiza `estado.md`.
  Formato: `# Sesión <fecha> · <feature>/<NN-spec>` y las líneas `- Hecho:`, `- Pendiente:`, `- Archivos tocados:`, `- Siguiente: <prompt exacto>`.
- Al terminar cada paso, cierra siempre así, sin variaciones: `**Siguiente — <en este chat | en un chat nuevo>:**` y debajo el prompt exacto en un bloque de código.
```

## 2. Mapa barato
Invoca la skill `afsd-arch` en modo **sync**: crea `01-TOOLS/arch/check.sh`, escribe la sección **Actual** de `arquitectura.md` (zonas, dependencias, comandos, línea base de tests) y guarda la huella.
Si no puedes invocarla, dilo y para aquí: el siguiente paso será `afsd arch sync` en un chat nuevo.
**Objetivo** y **Reglas** quedan como `(pendiente: afsd arch define)`: son opcionales en un proyecto adoptado.

## 3. Completar
- `index.md`: el mapa de zonas, con enlaces a la documentación que ya existía (no la copies).
- `decisions.md`: `- D-00 · <fecha> · adopción · Decisiones anteriores a AFSD: ver git log · -`.
- `estado.md`: Siguiente paso `afsd arch define`.

## 4. Resumir
En cinco líneas: qué has creado, cuántas zonas detectaste, la línea base de tests y si hubo algo que no pudiste mapear.

## Commit del andamiaje (opcional)
Al final, si hay git, muestra `git status --short` limitado a lo creado/modificado por AFSD (`01-TOOLS/`, `02-DOCS/`, `CLAUDE.md`/`AGENTS.md`, `.gitignore`) y ofrece un commit solo con esos archivos: `chore: añade AFSD`. Hazlo solo tras confirmación; no hagas push ni incluyas otros cambios del usuario. Sin git, omite esto.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md`. **Si propones un chat nuevo, antes escribe la nota de sesión** (`02-DOCS/sessions/`, formato en `CLAUDE.md`) y actualiza `estado.md`; si sigues en este chat, no la escribas.
Termina con **Siguiente** y el prompt exacto.
Aquí:
- Mapa a medias o sin hacer → **en un chat nuevo**: `afsd arch sync`.
- Mapa terminado → **en un chat nuevo**: `afsd arch define`. Añade una línea: es opcional (fija las reglas); se puede ir directo a `afsd feature <idea>`.
