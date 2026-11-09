# AFSD — Apple Feature-Spec Development

Plug-in para **Claude Code** (uso principal, conectado a Xcode por MCP) y para el agente de Claude de Xcode. Es la misma carpeta para los dos.
Autor: Carlos. Estado: versión 0.9.1, en pruebas.

## Cómo se usa
- **Claude Code:** en `~/.zshrc`, junto a `cx` (que carga el plugin oficial de Xcode):
  `cxa() { cx --plugin-dir ~/Repos/afsd-plugin "$@"; }` → `cx` sin AFSD, `cxa` con AFSD.
  Lee esta carpeta directamente: los cambios en las skills se notan al abrir una sesión nueva, sin reinstalar.
  Las skills se invocan escribiendo `afsd init`, `afsd plan`… o como `/afsd:afsd-plan`.
- **Xcode (opcional):** Settings → Intelligence → Plug-ins → Add Plug-in… Xcode guarda su propia copia: quitar y volver a añadir tras cada cambio. Los hooks probablemente no se ejecutan ahí.

## Hooks (Claude Code)
`hooks/hooks.json` + `hooks/afsd_hook.py` (python3 de macOS). Solo actúan en proyectos con `02-DOCS/wiki/estado.md`; ante cualquier error no bloquean nada.
| Evento | Qué hace |
|---|---|
| SessionStart | Inyecta `estado.md`, las 5 últimas lecciones sin promover y la nota de sesión más reciente: el chat nuevo no gasta lecturas en orientarse. |
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
| `afsd lessons [review]` | Anota una lección en `lessons.md` (causa raíz sin culpas, hogar, recurrencia); la 2.ª vez propone una regla de una línea para `CLAUDE.md` (con tu sí). `review` agrupa, fusiona y archiva. Solo dentro del proyecto. Se activa sola al corregirte | Cuando corriges al agente, algo falla dos veces o quieres repasar |
| `afsd build plan <doc.md>` · `/afsd:build` · `afsd build report` | Construye la app o el juego entero desde su documento de diseño: `plan` crea el roadmap (una tanda de preguntas y tu aprobación); el workflow `/afsd:build` hace cada spec con agentes nuevos (spec, plan, código, verificación, revisor independiente, commit); `report` lista lo que debes revisar. Pagos solo preparados (RevenueCat) | App nueva con documento de diseño completo |
| `afsd ping` | Responde `>>> AFSD trabajando correctamente <<<` con la versión, y si el proyecto y los hooks están detectados | Comprobar que el plugin carga |

## Flujo
Nuevo: `init` → `arch define`. Existente: `adopt` (incluye `arch sync`) → `arch define` opcional. Después, por cada feature: `feature` → aprobar spec → `plan` → aprobar plan → implementar → `close`.
Cada skill termina con **Siguiente — en este chat / en un chat nuevo** y el prompt exacto que hay que escribir.

## Crear una app o un juego entero desde su documento de diseño (`afsd build`)
Le das el documento de diseño (`.md`) y AFSD construye la app entera con el **workflow** `/afsd:build`: recorre el roadmap spec a spec y cada fase la hace un **agente nuevo**, con el contexto limpio.
Lo que devuelve cada agente (un JSON validado) se queda en variables del script, no en tu chat: la conversación no crece aunque el juego tenga 50 specs. Los pagos quedan **preparados** (un stub con la forma de RevenueCat), sin implementar.

**Requisitos.** Workflows dinámicos de Claude Code (en el plan Pro, actívalos en `/config` → Dynamic workflows). MCP de Xcode activo (Settings → Intelligence). En Xcode, elige el **simulador** con el que quieres probar.

**Pasos**
1. En Xcode, crea el proyecto con target de tests (y comprueba que el scheme los ejecuta). En la terminal: `git init`, `git add -A`, `git commit -m "Proyecto inicial"`.
2. Copia el documento de diseño al proyecto (p. ej. `docs/diseno.md`) y haz commit.
3. `cxa` → `afsd init` → `/clear` → `afsd arch define` (si hay compras: «sí, pagos con RevenueCat»). Commit.
4. `/clear` → `afsd build plan docs/diseno.md` → responde la única tanda de preguntas → `apruebo el roadmap`. Crea la rama `afsd/build` y propone los permisos para que los agentes no se paren a preguntar: acéptalos.
5. `/afsd:build` (para una prueba corta: `/afsd:build con maxSpecs 3`) y aprueba el lanzamiento del workflow.
6. Mientras trabaja: `/workflows` muestra cada spec, sus agentes, qué hace cada uno y sus tokens (`p` pausa, `x` para). Deja Claude Code abierto y el Mac despierto (`caffeinate -dims` en otra terminal).
7. Al terminar te da un resumen (hechas, bloqueadas, qué revisar). Luego `/clear` → `afsd build report` → prueba en el simulador lo que indique → ajustes con `afsd quick` o `afsd feature`.
8. Haz tú el merge (`git switch main && git merge afsd/build`); AFSD nunca hace push. Pagos reales, cuando quieras: `afsd feature pagos-revenuecat`.

**Qué hace por cada spec**
| Agente | Qué hace | Devuelve |
|---|---|---|
| spec | escribe la spec desde `wiki/juego.md` y su § del documento; aprobación automática | nº de criterios |
| plan | plan de tareas, aprobado en automático | nº de tareas |
| código (hasta 12 rondas) | máx. 3 tareas por ronda, cada una con su comprobación | hechas y pendientes |
| verificar | todos los tests, `check.sh` y cada criterio con su prueba | tests ejecutados y fallidos, criterios |
| revisor | independiente (no vio cómo se hizo): criterios simulados, tests vacíos, reglas rotas, cambios ajenos | aprobado o problemas |
| arreglo (máx. 2) | corrige lo que digan la verificación o el revisor | — |
| cerrar | marca criterios, wiki, `build/revision.md` y commit | hash del commit |

**Quién decide si una spec pasa: el script, no el modelo.** Hacen falta tests ejecutados (**0 tests no cuenta**), ninguno fallido, ninguna violación de arquitectura, ninguna tarea pendiente, ningún criterio fallido y el visto bueno del revisor.
Si tras 2 arreglos sigue fallando, guarda el trabajo en `git stash`, marca la feature `bloqueada`, salta las que dependen de ella y sigue con las demás.

**Por qué no pierde el hilo ni gasta tokens repasando.** Cada agente empieza vacío y solo lee la wiki (`estado.md`, roadmap, `juego.md`, la spec y su plan). La verdad está en disco (roadmap con ✓ y commits):
si paras o se cae, relanzar `/afsd:build` en la misma sesión reutiliza los agentes ya terminados; en una sesión nueva, el agente de preparación lee el roadmap y sigue por la primera spec pendiente.

**Límites.** Prueba la lógica y la interfaz; no sabe si el juego es divertido o está equilibrado: eso queda en `02-DOCS/build/revision.md` para ti.
Todo va en serie (un proyecto de Xcode y un simulador): no hace specs en paralelo, para no pisar `project.pbxproj`. No hay preguntas a mitad: la única aprobación es la del roadmap.

## Estructura que crea en cada proyecto
```
CLAUDE.md                 bloque "AFSD" (reglas cortas, se carga en cada chat)
01-TOOLS/build/test.sh    respaldo de tests sin MCP, con el simulador seleccionado en Xcode al hacer init (por id); salida filtrada
01-TOOLS/arch/check.sh    huella del proyecto + reglas de arquitectura (sin tokens)
02-DOCS/
  wiki/  estado.md  arquitectura.md  index.md  decisions.md  lessons.md  juego.md (solo con afsd build)
  specs/<feature>/  _feature.md  <NN>-<spec>.md  <NN>-<spec>.plan.md
  specs/_actual/<zona>.md   retro-specs de código existente, solo de lo que se toca
  specs/_roadmap.md         features y specs en orden (afsd build)
  build/revision.md         lo que afsd build deja para revisión manual
  sessions/                 notas de sesión para cambiar de chat
  archive/
```
- `estado.md` es lo primero que lee cualquier chat: feature activa, spec activa, fase, siguiente paso (prompt exacto).
- `decisions.md` y `lessons.md` solo se añaden. Las decisiones llevan ID (`D-NN`). Una lección repetida pasa a regla en `CLAUDE.md` (`## Reglas aprendidas`, máx. 10, con tu permiso) vía `afsd-lessons`; las lecciones nunca salen del proyecto.

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

## Cambios en 0.9.1
- Tests que no se cuelgan: los tests con async o streams llevan `.timeLimit(.minutes(1))`, `test.sh` usa los límites de tiempo de `xcodebuild`, y las skills y el workflow indican qué hacer si una ejecución no termina (buscar el test `started` sin resultado).

## Cambios en 0.9.0
- `afsd build` pasa a ser un **workflow dinámico** de Claude Code (`workflows/afsd-build.js`, se lanza con `/afsd:build`): un agente nuevo por fase, respuestas en JSON validado, la decisión de si una spec pasa la toma el código (0 tests nunca pasa), revisor independiente, bloqueo con `git stash` y salto de las dependientes, y opción `maxSpecs`.
- Retirados `bin/afsd-run.sh` y el modo `afsd build next` (sesiones `claude -p` en bucle): sus señales eran débiles (una línea de texto y cambios en git), pedía el permiso de Xcode por proceso y fallaba al llegar al límite de uso.
- `afsd build plan` propone los permisos en `.claude/settings.local.json` (ignorado con `.git/info/exclude`).
- Probado: el script con un simulador del runtime y agentes falsos (spec que pasa, 0 tests, revisor que rechaza, bloqueo con dependientes, bloqueos de ejecuciones anteriores, `maxSpecs`, agente caído). Pendiente en real: que los agentes del workflow tengan el MCP de Xcode y las skills, y que los permisos eviten preguntas.
- Copia de la 0.8.1 en `_backup-0.8.1.tar.gz`.

## Cambios en 0.8.1
- **Simulador de pruebas: el que tengas seleccionado en Xcode** (destino activo). Sustituye a la regla de la iOS mínima y a cambiar el destino por MCP de la 0.8.0: los tests por MCP usan ese destino y AFSD no lo toca. Si el destino activo no es un simulador (dispositivo físico o `Any iOS …`), avisa y para.
- `test.sh` (respaldo sin MCP) usa el identificador del simulador (`id=`) y, si falla antes de ejecutar tests, enseña el principio de la salida completa en vez de solo las líneas filtradas.
- Proyectos creados con 0.8.0: pide «regenera `01-TOOLS/build/test.sh` según `afsd-init` paso 3» y sustituye el bloque `## AFSD` de `CLAUDE.md`.
- Copia de la 0.8.0 en `_backup-0.8.0.tar.gz`.

## Cambios en 0.8.0 (la parte del simulador la sustituye la 0.8.1)
- Simulador de pruebas: **un iPhone con la versión mínima de iOS que soporta la app** (`IPHONEOS_DEPLOYMENT_TARGET`), salvo que pidas otro. Solo uno, para no multiplicar tiempo ni tokens.
  `init` y `adopt` lo eligen solos; si falta ese runtime, dicen cómo instalarlo y usan mientras el más bajo disponible (`PROVISIONAL`). `build plan` avisa si el `test.sh` no cumple la regla.
- Con MCP, los tests van por MCP (`RunSomeTests` en cada tarea, `RunAllTests` al cerrar) tras fijar el destino del proyecto con `XcodeSwitchRunDestination`, porque esas herramientas no aceptan destino y usan el activo en Xcode. `test.sh` es la definición del simulador y el respaldo sin MCP; filtra la salida (máx. 60 líneas).
- Proyectos ya creados: su `test.sh` no cambia. Para aplicarlo, pide «regenera `01-TOOLS/build/test.sh` según `afsd-init` paso 3» y sustituye el bloque `## AFSD` de `CLAUDE.md`.
- Visto en real: con Swift Testing, `RunAllTests` devuelve `total: 0` aunque el test pase. Las skills mandan leer el log de consola y exigir al menos un test ejecutado.
- Copia de la 0.7.0 en `_backup-0.7.0.tar.gz`.

## Cambios en 0.7.0
- Nueva skill `afsd-build` (`plan`, `next`, `report`) y script `bin/afsd-run.sh`: construye una app o un juego entero desde su documento de diseño, una spec por sesión de Claude Code (`claude -p`), con subagentes, tests y commit por spec, hasta terminar el roadmap.
- Pagos preparados: feature `pagos-base` con `PurchaseService` (conceptos de RevenueCat) y un stub; `pagos-revenuecat` queda escrita y aparcada. `afsd feature` activa features aparcadas.
- Hook PreToolUse: con `AFSD_BUILD=1` deniega (no pregunta) editar `.swift` fuera de implementación.
- Corregida la ruta de `cxa` (`~/Repos/afsd-plugin`).
- Probado: el bucle con `claude` y `xcrun` simulados (fin, atasco, errores, sin MCP) y el hook. Pendiente en real: todo `afsd build`. Copia de la 0.6.0 en `_backup-0.6.0.tar.gz`.

## Cambios en 0.6.0
- Nueva skill `afsd-lessons`: captura lecciones al corregirte (no solo al cerrar), con causa raíz sin culpas, hogar (`lessons.md`, `CLAUDE.md`, regla `check:` propuesta o spec) y regla de recurrencia (1.ª nota, 2.ª barrera, 3.ª la barrera falló). `afsd lessons review` para repasar y archivar.
- El hook SessionStart inyecta las 5 últimas lecciones sin promover (unos 300 tokens como máximo); sin ellas, `lessons.md` no se leía nunca.
- `close`, `quick` e `init` usan `afsd-lessons`; el bloque `## AFSD` de `CLAUDE.md` gana una línea (en proyectos anteriores: sustituir el bloque como en 0.1.0, paso 5 de `afsd-init`).
- Sin promoción entre proyectos: nada escribe fuera del proyecto ni en el plugin. Las Reglas de `arquitectura.md` solo se proponen.
- Copia de la 0.5.0 en `_backup-0.5.0.tar.gz`. Pendiente de probar en real: todo lo anterior.

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
- Probar `/afsd:build` en real: que los agentes del workflow tienen el MCP de Xcode y las skills de AFSD, que `Workflow(afsd:build)` y los demás permisos evitan preguntas, y cuánto gasta una spec.
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
