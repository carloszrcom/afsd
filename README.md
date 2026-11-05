# AFSD — Apple Feature-Spec Development

Plug-in para **Claude Code** (uso principal, conectado a Xcode por MCP) y para el agente de Claude de Xcode. Es la misma carpeta para los dos.
Autor: Carlos. Estado: versión 0.5.0, en pruebas.

## Cómo se usa
- **Claude Code:** en `~/.zshrc`, junto a `cx` (que carga el plugin oficial de Xcode):
  `cxa() { cx --plugin-dir ~/Developer/afsd-plugin "$@"; }` → `cx` sin AFSD, `cxa` con AFSD.
  Lee esta carpeta directamente: los cambios en las skills se notan al abrir una sesión nueva, sin reinstalar.
  Las skills se invocan escribiendo `afsd init`, `afsd plan`… o como `/afsd:afsd-plan`.
- **Xcode (opcional):** Settings → Intelligence → Plug-ins → Add Plug-in… Xcode guarda su propia copia: quitar y volver a añadir tras cada cambio. Los hooks probablemente no se ejecutan ahí.

## Hooks (Claude Code)
`hooks/hooks.json` + `hooks/afsd_hook.py` (python3 de macOS). Solo actúan en proyectos con `02-DOCS/wiki/estado.md`; ante cualquier error no bloquean nada.
| Evento | Qué hace |
|---|---|
| SessionStart | Inyecta `estado.md` y la nota de sesión más reciente: el chat nuevo no gasta lecturas en orientarse. |
| PreToolUse (editar `.swift`) | Si la fase no es *implementación*, pide confirmación: sin spec aprobada solo se admiten cambios de una línea. |
| Stop | Si la respuesta propone *un chat nuevo* y no hay nota de sesión de los últimos 20 min, obliga a escribirla antes de terminar. |

## Para qué sirve
Método ligero de desarrollo guiado por specs, inspirado en rsc-harness pero reducido a lo que ahorra tokens:
**una feature se divide en specs pequeñas; cada spec pasa por spec → plan → implementación → cierre**, y todo el conocimiento
queda en archivos del proyecto (`02-DOCS`) para que un chat nuevo no tenga que investigar el proyecto otra vez.
Base: el enfoque de Apple (spec primero, `/plan`, tests, cierre) más features con varias specs y memoria entre chats.

## Skills
| Se invoca | Qué hace | Cuándo |
|---|---|---|
| `afsd init` | Crea `CLAUDE.md`, `01-TOOLS`, `02-DOCS`, `test.sh`, `.gitignore` y el esqueleto de `arquitectura.md`. No decide arquitectura | Proyecto de Xcode recién creado por ti (nunca crea proyectos) |
| `afsd adopt` | Lo mismo, y ejecuta `afsd arch sync` para mapear el proyecto (sin documentar features) | Proyecto que ya existe (exige proyecto de Xcode) |
| `afsd arch define` | Fija **Objetivo** y **Reglas** de la arquitectura a partir de un preset (`ios-clean`) con 1–3 preguntas | Tras `init`, o al cambiar de rumbo |
| `afsd arch sync` | Ejecuta `check.sh`; si la huella cambió, re-mapea solo lo cambiado y actualiza **Actual** | Proyecto adoptado o cambios hechos fuera del flujo |
| `afsd feature [idea]` | Crea la feature y su spec (o la siguiente spec pendiente). Para hasta que se aprueba | Empezar una feature |
| `afsd plan` | Escribe el plan de tareas en un archivo, para hasta aprobarlo, luego implementa tarea a tarea | Spec aprobada |
| `afsd close` | Verifica criterios con pruebas, registra decisiones y lecciones, cierra y hace commit | Tareas terminadas |
| `afsd auto [--plan] <idea>` | Feature completa con un subagente por fase: solo se para a aprobar la spec (y el plan con `--plan`), en lo visual y en el commit. Solo Claude Code | Features que no quieres llevar paso a paso |
| `afsd quick <cambio>` | Cambio pequeño sin spec ni plan (≤3 archivos): tests + `check.sh` + commit con confirmación. Si no cabe, deriva a `afsd feature` (sin probar) | Arreglos y ajustes triviales |
| `afsd ping` | Responde `>>> AFSD trabajando correctamente <<<` con la versión, y si el proyecto y los hooks están detectados | Comprobar que el plugin carga |

## Flujo
Nuevo: `init` → `arch define`. Existente: `adopt` (incluye `arch sync`) → `arch define` opcional. Después, por cada feature: `feature` → aprobar spec → `plan` → aprobar plan → implementar → `close`.
Cada skill termina con **Siguiente — en este chat / en un chat nuevo** y el prompt exacto que hay que escribir.

## Estructura que crea en cada proyecto
```
CLAUDE.md                 bloque "AFSD" (reglas cortas, se carga en cada chat)
01-TOOLS/build/test.sh    comando fijo de tests (scheme y simulador)
01-TOOLS/arch/check.sh    huella del proyecto + reglas de arquitectura (sin tokens)
02-DOCS/
  wiki/  estado.md  arquitectura.md  index.md  decisions.md  lessons.md
  specs/<feature>/  _feature.md  <NN>-<spec>.md  <NN>-<spec>.plan.md
  specs/_actual/<zona>.md   retro-specs de código existente, solo de lo que se toca
  sessions/                 notas de sesión para cambiar de chat
  archive/
```
- `estado.md` es lo primero que lee cualquier chat: feature activa, spec activa, fase, siguiente paso (prompt exacto).
- `decisions.md` y `lessons.md` solo se añaden. Las decisiones llevan ID (`D-NN`). Una lección repetida pasa a regla en `CLAUDE.md`.

## Arquitectura como contrato
`arquitectura.md` (máx. 60 líneas) tiene tres secciones: **Actual** (verificado en el código), **Objetivo** (decidido, sin construir) y **Reglas** (invariantes).
Una regla es comprobable si acaba en `· check: deny <carpetas> \`<regex>\`` (el patrón no puede aparecer ahí) o `· check: only <carpetas> \`<regex>\`` (solo puede aparecer ahí); si no, es manual.
`check.sh` calcula una **huella** (carpetas a 2 niveles, targets, paquetes) y busca violaciones con `grep`: el modelo solo lee su salida, unas pocas líneas.
Si la huella no cambió, no se re-mapea nada. `afsd close` ejecuta `check.sh`: una violación en archivos que tocó la spec bloquea el cierre.
El script y el preset viven en `skills/afsd-arch/`; la skill copia `check.sh` al proyecto.

## Reglas de diseño (por qué es así)
1. **Ahorrar tokens:** leer lo mínimo; skills cortas; subagentes para exploraciones grandes; un chat por tarea.
2. **Cambio de chat:** al acabar fase o tarea, o con muchos archivos leídos, salidas largas o repeticiones. Solo si se cambia de chat se escribe la nota de sesión y se actualiza `estado.md`.
   La regla completa vive en el bloque AFSD de `CLAUDE.md`; cada skill solo lleva un recordatorio y sus casos de **Siguiente**.
3. **Sin código de una feature nueva sin spec aprobada** (salvo cambios de una línea).
4. **Nunca `[x]` sin prueba.** Criterios: `[x]` comprobado, `[ ]` falla, `[~]` pendiente de revisión manual del usuario.
5. Si el comportamiento real difiere de la spec, se corrige la spec antes de marcar.
6. Documentación progresiva en proyectos existentes: solo se documenta una zona cuando se va a tocar.
7. Nunca sobrescribir lo que ya existe (`CLAUDE.md`, `.gitignore`…); nunca hacer push.

## Qué se ha probado (proyecto `PruebaCrearPluginAFSD`)
- Instalación del plug-in en Xcode 27.1 y carga de skills: OK.
- `init`, `feature`, `plan`, `close` con dos features (contador, ajustes con 2 specs) y cambios de chat con prompt de continuación: OK.
- Memoria entre chats vía `estado.md` y notas de sesión: OK.
- `check.sh` (0.2.0): probado con un proyecto de ejemplo (huella igual/cambiada, reglas deny y only, carpetas inexistentes, rutas con espacios), en bash de Linux; falta probarlo en el Mac.
- **Probado en Claude Code (`cxa`):** el plugin carga, `afsd ping`, y los hooks SessionStart y PreToolUse. Stop solo con entradas simuladas.
- **Sin probar:** `afsd adopt` en un proyecto real; `afsd auto`; `afsd quick`; hooks en Xcode; proyectos grandes.

## Cambios en 0.5.0
- `init` y `adopt` exigen un proyecto de Xcode existente (nunca lo crean) y ofrecen al final el commit del andamiaje.
- Modificar features: `afsd feature` genera spec con `Modifica:`; `plan` actualiza tests afectados; `close` reescribe la spec antigua.
- Nueva skill `afsd-quick`; el hook de edición no pregunta si existe `02-DOCS/.quick` de menos de 30 min.
- Pendiente de probar en real: todo lo anterior.

## Cambios en 0.4.0
- Nueva skill `afsd-auto`: modo automático con subagentes (sin probar).
- Incluidas cinco skills de código Swift de terceros (ver `THIRD_PARTY_NOTICES.md`); preset `ios-clean` con iOS 26.

## Cambios en 0.3.0
- Uso principal en Claude Code con `--plugin-dir`; hooks SessionStart, PreToolUse y Stop.
- Las skills piden usar las herramientas MCP de Xcode para compilar, tests y previews (si no hay, `test.sh`).
- La sección Actual y la huella de `arquitectura.md` solo las actualiza `afsd close` (o `afsd arch sync`); `afsd plan` ya no las toca.
- Recordatorio explícito: si se propone un chat nuevo, antes se escribe la nota de sesión.
- `afsd ping` reescrita: comprueba versión, proyecto y hooks. Copia de la 0.2.0 en `_backup-0.2.0.tar.gz`.

## Cambios en 0.2.0
- Nueva skill `afsd-arch` (define, sync), `check.sh` y preset `ios-clean`.
- `init` ya no decide arquitectura; su siguiente paso es `afsd arch define`. `adopt` delega el mapa en `afsd arch sync`.
- Bloque AFSD de `CLAUDE.md` ampliado (arquitectura, decisiones `D-NN`, regla completa de cambio de chat). Las skills llevan solo un recordatorio corto.
- `afsd close` ejecuta `check.sh` y actualiza Actual y la huella. `afsd feature` avisa si no hay Reglas.
- Copia de la 0.1.0 en `_backup-0.1.0.tar.gz`.

**Proyectos creados con 0.1.0** (p. ej. `PruebaCrearPluginAFSD`): ejecutar `afsd arch sync`, que migra `arquitectura.md` al formato nuevo;
y sustituir a mano el bloque `## AFSD` de su `CLAUDE.md` por el de `skills/afsd-init/SKILL.md` (paso 5).

## Pendiente
- Probar el hook Stop en real.
- Comprobar el nombre real de las herramientas MCP de Xcode en Claude Code (el hook de edición reconoce `mcp__…XcodeWrite/XcodeUpdate`).
- Fase 2: modo `afsd arch check`; comprobación de Reglas en `afsd plan`; lista de deuda (Objetivo frente a Actual) en `index.md`; tamaños S/M/L; paquetes Swift locales como opción del preset.
- Skill propia de código Swift (convenciones de Carlos) dentro del plugin.
- Probar `afsd adopt`, `afsd auto` y `afsd quick` en proyectos reales.
- Completar autor y licencia de las skills de terceros (`THIRD_PARTY_NOTICES.md`) antes de publicar.
## Notas para quien (o el agente que) continúe
- El plug-in usa el mismo formato que los de Claude Code: `.claude-plugin/plugin.json` + `skills/<nombre>/SKILL.md`.
- Editar las skills en esta carpeta; en Xcode, quitar y volver a añadir el plug-in para que cargue los cambios.
- Los chats del agente de Xcode no son visibles desde fuera: para revisar un paso, mirar los archivos de `02-DOCS` y `git log` del proyecto.
# afsd
