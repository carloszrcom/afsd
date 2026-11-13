export const meta = {
  name: 'build',
  description: 'AFSD: construye la app entera desde el roadmap aprobado, una spec tras otra. Cada fase la hace un agente nuevo (contexto limpio), con verificación por pruebas, revisor independiente y un commit por spec. Pagos solo preparados.',
  phases: ['Preparar', 'Informe'],
}

// Opciones (opcionales): /afsd:build con maxSpecs 3  →  args = { maxSpecs: 3 }
// args puede llegar como objeto ({maxSpecs: 3}) o como texto ("con maxSpecs 3", "3", "maxSpecs=3")
const opts = (typeof args === 'object' && args !== null) ? args : {}
const texto = typeof args === 'string' ? args : ''
const delTexto = (texto.match(/maxSpecs\D{0,3}(\d+)/i) || texto.match(/^\s*(\d+)\s*$/) || [])[1]
const pedido = Number.isInteger(opts.maxSpecs) ? opts.maxSpecs : parseInt(opts.maxSpecs ?? delTexto, 10)
const MAX_SPECS = Number.isInteger(pedido) && pedido > 0 ? pedido : Infinity
const MAX_RONDAS = 12   // rondas de implementación por spec (máx. 3 tareas por ronda)
const MAX_ARREGLOS = 2  // intentos de arreglo cuando falla la verificación o la revisión
const PARAR_SI_BLOQUEANTE = false // true: al aparcar una spec por una decisión bloqueante, el workflow se detiene en vez de seguir con las que no dependen de ella
const ahora = () => { try { return Date.now() } catch (e) { return 0 } }

const COMUN = `Eres un agente de AFSD en modo build: la app se construye sola a partir de 02-DOCS/specs/_roadmap.md. Trabajas en el directorio actual, que es la raíz del proyecto.
Reglas:
- No hay nadie a quien preguntar. Si algo es dudoso, decide lo más razonable y añádelo al final de 02-DOCS/wiki/decisions.md terminado en " [revisar]".
- Lee solo lo que necesites (estado.md, el roadmap, wiki/juego.md, la spec y su plan, el código de la zona que tocas). No explores el proyecto entero.
- Xcode: usa las herramientas MCP de Xcode si están. Si piden workspaceIdentifier o tabIdentifier, consíguelo con XcodeOpenWorkspace sobre el .xcodeproj o .xcworkspace de la raíz (o con XcodeListWindows). Tests y previews en el destino activo de Xcode: no lo cambies. Sin MCP, usa 01-TOOLS/build/test.sh.
- Con Swift Testing, el resumen de RunAllTests o RunSomeTests puede salir vacío: cuenta los tests en el log de consola que devuelve la herramienta.
- Tests que no se cuelgan: todo test con async, streams, continuations o confirmaciones lleva \`.timeLimit(.minutes(1))\` (mejor en el \`@Suite\`); nunca un \`await\` o \`for await\` sin límite: suscríbete antes de provocar el evento y toma solo el primer valor esperado. Si \`RunAllTests\` no responde en unos minutos, páralo (en Xcode, ⌘.) y trátalo como test colgado: el que aparece \`started\` sin \`passed\`/\`failed\` en el log; arréglalo antes de seguir.
- Nunca marques [x] sin prueba. Respeta las Reglas de 02-DOCS/wiki/arquitectura.md. No cambies ajustes del proyecto de Xcode (targets, versión mínima, firma). Nunca hagas push. Nunca añadas 02-DOCS/build/STOP a un commit.
- Decisiones bloqueantes: si una decisión cambia lo que la spec tiene que cumplir (valores, reglas o comportamiento del diseño), sobre todo si no pudiste leer el diseño o es ambiguo, anótala en decisions.md terminada en " [bloqueante]" (no en " [revisar]"), devuélvela en \`bloqueantes\` y no implementes a ciegas esa parte. Lo que no cambia el resultado (detalles, nombres, orden) sigue siendo " [revisar]". Si devuelves bloqueantes en el paso SPEC, deja la spec en "Estado: borrador".
- Las líneas de decisions.md terminadas en " [decidido]" son órdenes del usuario y mandan sobre la spec y el diseño: lee las de tu spec y respétalas.`

// --- Esquemas de respuesta -------------------------------------------------
const STR = { type: 'string' }
const INT = { type: 'integer', minimum: 0 }
const BOOL = { type: 'boolean' }
const lista = items => ({ type: 'array', items })
const obj = props => ({ type: 'object', required: Object.keys(props), properties: props })

const E_PREPARAR = obj({ ok: BOOL, motivo: STR, mcp: BOOL, featuresBloqueadas: lista(STR), specs: lista(obj({ feature: STR, spec: STR, dependeDe: lista(STR) })) })
const E_PASO = obj({ ok: BOOL, motivo: STR })
const E_FIN = obj({ ok: BOOL, motivo: STR, parar: BOOL })
const E_SPEC = obj({ ok: BOOL, motivo: STR, criterios: INT, bloqueantes: lista(STR) })
const E_PLAN = obj({ ok: BOOL, motivo: STR, tareas: INT, bloqueantes: lista(STR) })
const E_IMPL = obj({ ok: BOOL, motivo: STR, hechasAhora: INT, pendientes: INT, bloqueantes: lista(STR) })
const E_VERIFICAR = obj({
  testsEjecutados: INT, testsFallidos: INT, violaciones: INT, tareasPendientes: INT,
  criterios: lista(obj({ id: STR, estado: { type: 'string', enum: ['ok', 'falla', 'manual'] }, prueba: STR })),
  fallos: lista(STR), colgados: lista(STR),
})
const E_REVISAR = obj({ aprobado: BOOL, problemas: lista(STR) })
const E_CERRAR = obj({ ok: BOOL, motivo: STR, commit: STR, revisar: lista(STR), parar: BOOL })

// stallMs: si un agente pasa 10 min sin ninguna salida (p. ej. RunAllTests colgado), Claude Code lo reinicia solo.
// En /workflows se ve como «(retry N)». Tras 6 intentos fallidos agent() devuelve null y se avisa como cuelgue.
const STALL_MS = 600000
const paso = (prompt, schema, label) => agent(COMUN + '\n\n' + prompt, { schema, label, stallMs: STALL_MS })
const CUELGUE = 'sin respuesta tras varios reinicios: posible cuelgue (en Xcode busca un test «started» sin resultado y páralo con ⌘.)'
const fallo = (r, porDefecto) => ({ ok: false, motivo: (r && r.motivo) || porDefecto })

// Lo que tiene que estar bien para cerrar una spec. "0 tests" nunca cuenta como prueba.
function problemasDe(v) {
  const p = []
  if (v.testsEjecutados === 0) p.push('no se ejecutó ningún test (0 tests no cuenta como prueba)')
  if (v.testsFallidos > 0) p.push(`${v.testsFallidos} test(s) fallan`)
  if (v.violaciones > 0) p.push(`${v.violaciones} violación(es) de arquitectura en archivos de esta spec`)
  if (v.tareasPendientes > 0) p.push(`quedan ${v.tareasPendientes} tarea(s) [ ] en el plan`)
  if (v.criterios.length === 0) p.push('no se comprobó ningún criterio de aceptación')
  for (const c of v.criterios) if (c.estado === 'falla') p.push(`criterio ${c.id} falla: ${c.prueba}`)
  for (const t of v.colgados || []) p.push(`test colgado: ${t} (añade .timeLimit(.minutes(1)) y suscríbete antes de provocar el evento)`)
  return p.concat(v.fallos || [])
}

// Decisión bloqueante devuelta por un agente: la spec se aparca, no se da por fallida
const bloqueo = r => (r && r.bloqueantes && r.bloqueantes.length) ? { ok: false, decision: true, motivo: r.bloqueantes.slice(0, 3).join('; ') } : null

// completa=true: esta spec cierra su feature (o la tanda), así que se ejecuta la suite entera
async function construir(s, id, completa) {
  const rutaSpec = `02-DOCS/specs/${s.feature}/${s.spec}.md`
  const t0 = ahora()
  let rondas = 0
  let arreglos = 0
  const ambito = completa
    ? 'ejecuta TODOS los tests (RunAllTests en el destino activo, o 01-TOOLS/build/test.sh): esta spec cierra su feature, así que toca la suite completa'
    : 'ejecuta solo los tests de esta spec y de su zona (RunSomeTests con los archivos de test nuevos o modificados según git status, más los de las features cuyo código haya tocado); la suite completa se ejecuta al cerrar la feature. Sin MCP, 01-TOOLS/build/test.sh ejecuta todo y vale igual'

  const spec = await paso(`Paso SPEC de ${id}. Carga la skill afsd-feature (herramienta Skill) y haz sus pasos 1, 4 y 5 para la spec ${s.spec} de la feature ${s.feature}, con estas reglas del modo build:
- usa 02-DOCS/wiki/juego.md y solo la sección § del documento de diseño (ruta en la línea "Fuente:" del roadmap; si es relativa a 02-DOCS/specs, resuélvela desde ahí; el archivo existe, no digas que no está disponible sin comprobarlo con Read) que cubre esta spec;
- si ${rutaSpec} ya existe y está aprobada, no la reescribas;
- máximo 8 criterios, cada uno comprobable con un test o en el simulador; la lógica del juego, en modelos Swift puros con tests;
- aprobación automática: "Estado: aprobada" en la spec y en su fila de _feature.md (créalo con "Estado: en curso" si la feature es nueva); fila del roadmap "en curso"; estado.md con Feature activa ${s.feature}, Spec activa ${s.spec}, Fase: plan.`, E_SPEC, `${id} · spec`)
  const bSpec = bloqueo(spec)
  if (bSpec) return bSpec
  if (!spec || !spec.ok) return fallo(spec, 'no se pudo escribir la spec')

  const plan = await paso(`Paso PLAN de ${id}. Carga la skill afsd-plan y haz sus pasos 1 a 3 para ${rutaSpec}. Si ya hay un plan aprobado, no lo reescribas. Aprobación automática: "Estado: aprobado" en el plan; en estado.md, Fase: implementación y Siguiente paso: /afsd:build.`, E_PLAN, `${id} · plan`)
  const bPlan = bloqueo(plan)
  if (bPlan) return bPlan
  if (!plan || !plan.ok) return fallo(plan, 'no se pudo escribir el plan')

  for (let ronda = 1; ronda <= MAX_RONDAS; ronda++) {
    const imp = await paso(`Paso IMPLEMENTAR de ${id}, ronda ${ronda}. Carga la skill afsd-plan y sigue su paso 4: haz como máximo 3 tareas [ ] consecutivas de 02-DOCS/specs/${s.feature}/${s.spec}.plan.md, cada una con su comprobación (build y RunSomeTests con los tests de la tarea, o 01-TOOLS/build/test.sh). Marca [x] en el plan justo después de comprobar cada tarea, no al final de la ronda (si te cancelan, lo hecho debe quedar anotado). Marca [x] solo lo comprobado. Las tareas que solo se pueden comprobar a mano en el simulador pásalas a [~] sin intentarlas. Si un test falla y no lo resuelves en 2 intentos, para: ok=false y en motivo el fallo exacto. Devuelve hechasAhora (tareas que pasaste a [x] o [~] en esta ronda) y pendientes (tareas [ ] que quedan).`, E_IMPL, `${id} · código ${ronda}`)
    rondas = ronda
    const bImp = bloqueo(imp)
    if (bImp) return bImp
    if (!imp || !imp.ok || imp.pendientes === 0 || imp.hechasAhora === 0) break // los fallos los recoge la verificación
  }

  let v = null
  let problemas = []
  for (let intento = 0; intento <= MAX_ARREGLOS; intento++) {
    if (intento > 0) {
      arreglos = intento
      const arr = await paso(`Paso ARREGLAR de ${id}, intento ${intento}. Arregla estos problemas:\n- ${problemas.join('\n- ')}\nSi quedan tareas [ ] en el plan, termínalas (afsd-plan paso 4). No cambies la spec salvo que el comportamiento real del sistema la contradiga (entonces corrige su texto como dice afsd-close). Ejecuta los tests afectados. Devuelve ok=false solo si no has podido arreglarlo, con el motivo.`, E_PASO, `${id} · arreglo ${intento}`)
      if (!arr) return fallo(null, 'falló el agente de arreglo')
    }

    v = await paso(`Paso VERIFICAR de ${id}. No edites código ni la spec. Carga la skill afsd-close y haz SOLO su paso 2 (verificar con pruebas), sin marcar casillas ni hacer commit:
- compila y ${ambito}; cuenta los tests ejecutados y fallidos en el log de consola, no en el resumen; si la ejecución no termina en unos 10 minutos, abandónala (⌘. en Xcode) y devuelve en colgados los tests con started sin passed/failed (testsEjecutados cuenta solo los que terminaron);
- ejecuta bash 01-TOOLS/arch/check.sh y cuenta solo las violaciones en archivos que tocó esta spec (git status y git diff --name-only HEAD);
- cuenta las tareas [ ] que quedan en el plan;
- para cada criterio de aceptación de ${rutaSpec}: "ok" con la prueba concreta (test, build, o preview o captura con RenderPreview o la skill device-interaction), "falla" con el porqué, o "manual" si solo lo puede juzgar una persona (aspecto, sensación), diciendo qué probar.`, E_VERIFICAR, `${id} · verificar`)
    if (!v) { log(`⚠ CUELGUE en ${id}: la verificación no responde`); return fallo(null, 'verificación ' + CUELGUE) }
    if ((v.colgados || []).length) log(`⚠ CUELGUE en ${id}: ${v.colgados.join(', ')} (el agente lo abandonó y se intenta arreglar)`)

    problemas = problemasDe(v)
    if (problemas.length === 0) {
      const rev = await paso(`Paso REVISAR de ${id}. Eres un revisor independiente: no escribiste este código y no edites nada. Lee ${rutaSpec}, su plan y los cambios de esta spec (git status, git diff HEAD y los archivos nuevos). Comprueba que:
1. cada criterio de aceptación está implementado de verdad, no simulado ni escrito a medida para el test;
2. cada criterio con test tiene uno que fallaría si el comportamiento se rompe (nada de tests vacíos o triviales);
3. se cumplen las Reglas de 02-DOCS/wiki/arquitectura.md;
4. no hay cambios ajenos a la spec.
Aprueba (aprobado=true) si no hay problemas reales; no bloquees por estilo o gustos. Cada problema, en una frase concreta con su archivo.`, E_REVISAR, `${id} · revisión`)
      if (!rev) return fallo(null, 'falló el agente revisor')
      if (rev.aprobado) break
      problemas = rev.problemas.length ? rev.problemas.map(p => `revisor: ${p}`) : ['el revisor no aprobó (sin motivo)']
    }
    if (intento === MAX_ARREGLOS) return { ok: false, motivo: problemas.slice(0, 3).join('; ') }
  }

  const cierre = await paso(`Paso CERRAR de ${id}. La verificación pasó y el revisor aprobó. Resultado por criterio: ${JSON.stringify(v.criterios)}.
Carga la skill afsd-close y haz sus pasos 3 a 5 con estas reglas del modo build:
- marca cada criterio según ese resultado: ok → [x] con su prueba; manual → [~] (no pidas revisión al usuario);
- añade a 02-DOCS/build/revision.md (créalo con "# Revisión manual" si falta; solo se añade) una línea por criterio manual y por decisión [revisar] de esta spec: "- <fecha> · ${id} · <qué revisar o probar>";
- lecciones con afsd-lessons, pero sin escribir reglas en CLAUDE.md: las reglas propuestas van también a revision.md;
- coste: añade al final de 02-DOCS/build/coste.md (créalo con "# Coste por spec" y la cabecera de tabla "| fecha | spec | minutos | rondas de código | arreglos | tests |" si falta) la línea "| <fecha> | ${id} | ${Math.round((ahora() - t0) / 60000)} | ${rondas} | ${arreglos} | ${v.testsEjecutados} |" (los minutos no cuentan este cierre); va en el mismo commit;
- orden obligatorio, para poder reanudar si te cancelan: primero todo lo demás (criterios, revision.md, lecciones, wiki); lo ÚLTIMO, justo antes del commit, el roadmap (✓ en la spec ${s.spec}; si era la última de ${s.feature}, la feature pasa a "hecha") y estado.md (sin spec activa, Siguiente paso: /afsd:build);
- no dejes pasar tiempo entre esos dos cambios y el commit: hazlos y commitea seguido.
Después haz un commit sin pedir confirmación, solo con los archivos de esta spec y de 02-DOCS: "feat(${s.feature}): ${s.spec} — <resumen en una línea>". Sin push. Devuelve el hash corto del commit y, en revisar, las líneas que añadiste a revision.md. Después del commit, comprueba con \`test -e 02-DOCS/build/STOP\` y devuelve parar=true si existe (false si no).`, E_CERRAR, `${id} · cerrar`)
  if (!cierre || !cierre.ok) return fallo(cierre, 'no se pudo cerrar ni hacer el commit')
  return { ok: true, commit: cierre.commit, revisar: cierre.revisar, parar: !!cierre.parar }
}

async function bloquear(id, motivo) {
  return await paso(`Paso BLOQUEAR de ${id}. Esta spec no se pudo terminar: ${motivo}.
1. Guarda el trabajo a medias: git stash push -u -m "afsd-build ${id}".
2. En 02-DOCS/specs/_roadmap.md, marca la fila de su feature como "bloqueada (<motivo en 6 palabras>)".
3. En 02-DOCS/wiki/estado.md, sin spec activa y Siguiente paso: afsd build report.
4. Commit solo de esos dos archivos: "chore(build): ${id} bloqueada". Sin push.
5. Comprueba con \`test -e 02-DOCS/build/STOP\` y devuelve parar=true si existe (false si no).`, E_FIN, `${id} · bloquear`)
}

// Spec que espera una decisión del usuario (línea [bloqueante] en decisions.md): se guarda lo hecho y se sigue con lo que no depende de ella
async function aparcar(id, motivo) {
  return await paso(`Paso APARCAR de ${id}. Esta spec espera una decisión del usuario: ${motivo}.
1. En 02-DOCS/specs/_roadmap.md, marca la fila de su feature como "pendiente de decisión (<motivo en 6 palabras>)".
2. En 02-DOCS/wiki/estado.md, sin spec activa y Siguiente paso: afsd build report.
3. Commit de todo lo que haya (código a medias, spec, plan, decisions.md, roadmap y estado, nunca 02-DOCS/build/STOP): "wip(build): ${id} pendiente de decisión". Sin push. Las casillas [x] del plan siguen valiendo al retomar.
4. Comprueba con \`test -e 02-DOCS/build/STOP\` y devuelve parar=true si existe (false si no).`, E_FIN, `${id} · aparcar`)
}

// --- Orquestación -----------------------------------------------------------
phase('Preparar')
const prep = await paso(`Paso PREPARAR. No escribas código ni cambies archivos.
1. Git: comprueba que la rama es afsd/build (git rev-parse --abbrev-ref HEAD). Si hay cambios sin commit (git status --porcelain) y estado.md no tiene una spec activa a medias, ok=false con el motivo. Si la tiene, son su trabajo a medias: sigue. Ignora siempre el archivo 02-DOCS/build/STOP en git status. Si ese archivo existe, ok=false con el motivo "existe 02-DOCS/build/STOP: quítalo con /afsd:resume y vuelve a lanzar".
2. 02-DOCS/specs/_roadmap.md debe decir "Estado: aprobado"; si no, ok=false (hay que ejecutar afsd build plan).
3. Xcode: si tienes las herramientas MCP de Xcode, abre o localiza el proyecto y comprueba con XcodeListRunDestinations que el destino activo es un simulador; si es un dispositivo físico o "Any iOS…", ok=false pidiendo al usuario que elija un simulador en Xcode. mcp=true si tienes esas herramientas; si no, mcp=false y comprueba que existe 01-TOOLS/build/test.sh.
4. specs: las que faltan, en el orden del roadmap. De las features "pendiente" o "en curso", las specs sin ✓; excluye las features "aparcada" y "bloqueada"; una feature "pendiente de decisión" solo entra si en 02-DOCS/wiki/decisions.md ya no queda ninguna línea de esa feature (las que empiezan por "D-NN · fecha · <feature>/") terminada en [bloqueante]. Si estado.md tiene una spec activa sin cerrar, ponla la primera. Para cada una: feature (slug), spec ("NN-nombre") y dependeDe (slugs de las features de la columna "Depende de"; [] si es "-"; "todas" = todas las features anteriores).
5. featuresBloqueadas: los slugs de las features que el roadmap ya tiene como "bloqueada", o como "pendiente de decisión" con alguna línea [bloqueante] sin resolver ([] si ninguna).`, E_PREPARAR, 'preparar')

if (!prep || !prep.ok) {
  return { empezado: false, motivo: prep ? prep.motivo : 'falló el agente de preparación', siguiente: 'corrige el motivo y vuelve a lanzar /afsd:build' }
}
log(`${prep.specs.length} spec(s) por hacer · MCP de Xcode: ${prep.mcp ? 'sí' : 'no'}`)

const hechas = []
const bloqueadas = []
const aparcadas = []
const revisar = []
const featuresBloqueadas = new Set(prep.featuresBloqueadas || [])
let intentadas = 0
let detenido = false

for (const [i, s] of prep.specs.entries()) {
  const id = `${s.feature}/${s.spec}`
  const dependeDeBloqueada = featuresBloqueadas.has(s.feature) || (s.dependeDe || []).some(f => featuresBloqueadas.has(f))
  if (dependeDeBloqueada) {
    bloqueadas.push({ id, motivo: 'depende de una feature bloqueada o pendiente de decisión' })
    featuresBloqueadas.add(s.feature)
    continue
  }
  if (intentadas >= MAX_SPECS) break
  intentadas++

  // La suite completa solo al cerrar la feature (o la tanda); en las demás specs, los tests de su zona
  const ultimaDeFeature = !prep.specs.slice(i + 1).some(x => x.feature === s.feature)
  const completa = ultimaDeFeature || intentadas === MAX_SPECS

  phase(id)
  const r = await construir(s, id, completa)
  if (r.ok) {
    hechas.push({ id, commit: r.commit })
    for (const x of r.revisar || []) revisar.push(x)
    if (r.parar) { detenido = true; break }
  } else if (r.decision) {
    aparcadas.push({ id, motivo: r.motivo })
    featuresBloqueadas.add(s.feature)
    const fin = await aparcar(id, r.motivo)
    if (fin && fin.parar) { detenido = true; break }
    if (PARAR_SI_BLOQUEANTE) break
  } else {
    bloqueadas.push({ id, motivo: r.motivo })
    featuresBloqueadas.add(s.feature)
    const fin = await bloquear(id, r.motivo)
    if (fin && fin.parar) { detenido = true; break }
  }
}

phase('Informe')
const tocadas = new Set(hechas.map(h => h.id).concat(bloqueadas.map(b => b.id), aparcadas.map(a => a.id)))
const sinEmpezar = prep.specs.map(s => `${s.feature}/${s.spec}`).filter(id => !tocadas.has(id))
log(`${hechas.length} hecha(s) · ${bloqueadas.length} bloqueada(s) · ${aparcadas.length} pendiente(s) de decisión · ${sinEmpezar.length} sin empezar${detenido ? ' · parado por STOP' : ''}`)
return {
  hechas,
  bloqueadas,
  aparcadas,
  sinEmpezar,
  revisar,
  detenido,
  siguiente: detenido
    ? 'parado por STOP: /afsd:resume y vuelve a lanzar /afsd:build'
    : aparcadas.length > 0
      ? 'decide lo pendiente (afsd build report): en decisions.md cambia [bloqueante] por [decidido] (puedes corregir el texto) y vuelve a lanzar /afsd:build'
      : sinEmpezar.length > 0
        ? 'vuelve a lanzar /afsd:build para seguir'
        : 'en un chat nuevo: afsd build report',
}
