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

const COMUN = `Eres un agente de AFSD en modo build: la app se construye sola a partir de 02-DOCS/specs/_roadmap.md. Trabajas en el directorio actual, que es la raíz del proyecto.
Reglas:
- No hay nadie a quien preguntar. Si algo es dudoso, decide lo más razonable y añádelo al final de 02-DOCS/wiki/decisions.md terminado en " [revisar]".
- Lee solo lo que necesites (estado.md, el roadmap, wiki/juego.md, la spec y su plan, el código de la zona que tocas). No explores el proyecto entero.
- Xcode: usa las herramientas MCP de Xcode si están. Si piden workspaceIdentifier o tabIdentifier, consíguelo con XcodeOpenWorkspace sobre el .xcodeproj o .xcworkspace de la raíz (o con XcodeListWindows). Tests y previews en el destino activo de Xcode: no lo cambies. Sin MCP, usa 01-TOOLS/build/test.sh.
- Con Swift Testing, el resumen de RunAllTests o RunSomeTests puede salir vacío: cuenta los tests en el log de consola que devuelve la herramienta.
- Tests que no se cuelgan: todo test con async, streams, continuations o confirmaciones lleva \`.timeLimit(.minutes(1))\` (mejor en el \`@Suite\`); nunca un \`await\` o \`for await\` sin límite: suscríbete antes de provocar el evento y toma solo el primer valor esperado. Si \`RunAllTests\` no responde en unos minutos, páralo (en Xcode, ⌘.) y trátalo como test colgado: el que aparece \`started\` sin \`passed\`/\`failed\` en el log; arréglalo antes de seguir.
- Nunca marques [x] sin prueba. Respeta las Reglas de 02-DOCS/wiki/arquitectura.md. No cambies ajustes del proyecto de Xcode (targets, versión mínima, firma). Nunca hagas push.`

// --- Esquemas de respuesta -------------------------------------------------
const STR = { type: 'string' }
const INT = { type: 'integer', minimum: 0 }
const BOOL = { type: 'boolean' }
const lista = items => ({ type: 'array', items })
const obj = props => ({ type: 'object', required: Object.keys(props), properties: props })

const E_PREPARAR = obj({ ok: BOOL, motivo: STR, mcp: BOOL, featuresBloqueadas: lista(STR), specs: lista(obj({ feature: STR, spec: STR, dependeDe: lista(STR) })) })
const E_PASO = obj({ ok: BOOL, motivo: STR })
const E_SPEC = obj({ ok: BOOL, motivo: STR, criterios: INT })
const E_PLAN = obj({ ok: BOOL, motivo: STR, tareas: INT })
const E_IMPL = obj({ ok: BOOL, motivo: STR, hechasAhora: INT, pendientes: INT })
const E_VERIFICAR = obj({
  testsEjecutados: INT, testsFallidos: INT, violaciones: INT, tareasPendientes: INT,
  criterios: lista(obj({ id: STR, estado: { type: 'string', enum: ['ok', 'falla', 'manual'] }, prueba: STR })),
  fallos: lista(STR),
})
const E_REVISAR = obj({ aprobado: BOOL, problemas: lista(STR) })
const E_CERRAR = obj({ ok: BOOL, motivo: STR, commit: STR, revisar: lista(STR) })

const paso = (prompt, schema, label) => agent(COMUN + '\n\n' + prompt, { schema, label })
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
  return p.concat(v.fallos || [])
}

async function construir(s, id) {
  const rutaSpec = `02-DOCS/specs/${s.feature}/${s.spec}.md`

  const spec = await paso(`Paso SPEC de ${id}. Carga la skill afsd-feature (herramienta Skill) y haz sus pasos 1, 4 y 5 para la spec ${s.spec} de la feature ${s.feature}, con estas reglas del modo build:
- usa 02-DOCS/wiki/juego.md y solo la sección § del documento de diseño (ruta en la línea "Fuente:" del roadmap; si es relativa a 02-DOCS/specs, resuélvela desde ahí; el archivo existe, no digas que no está disponible sin comprobarlo con Read) que cubre esta spec;
- si ${rutaSpec} ya existe y está aprobada, no la reescribas;
- máximo 8 criterios, cada uno comprobable con un test o en el simulador; la lógica del juego, en modelos Swift puros con tests;
- aprobación automática: "Estado: aprobada" en la spec y en su fila de _feature.md (créalo con "Estado: en curso" si la feature es nueva); fila del roadmap "en curso"; estado.md con Feature activa ${s.feature}, Spec activa ${s.spec}, Fase: plan.`, E_SPEC, `${id} · spec`)
  if (!spec || !spec.ok) return fallo(spec, 'no se pudo escribir la spec')

  const plan = await paso(`Paso PLAN de ${id}. Carga la skill afsd-plan y haz sus pasos 1 a 3 para ${rutaSpec}. Si ya hay un plan aprobado, no lo reescribas. Aprobación automática: "Estado: aprobado" en el plan; en estado.md, Fase: implementación y Siguiente paso: /afsd:build.`, E_PLAN, `${id} · plan`)
  if (!plan || !plan.ok) return fallo(plan, 'no se pudo escribir el plan')

  for (let ronda = 1; ronda <= MAX_RONDAS; ronda++) {
    const imp = await paso(`Paso IMPLEMENTAR de ${id}, ronda ${ronda}. Carga la skill afsd-plan y sigue su paso 4: haz como máximo 3 tareas [ ] consecutivas de 02-DOCS/specs/${s.feature}/${s.spec}.plan.md, cada una con su comprobación (build y RunSomeTests con los tests de la tarea, o 01-TOOLS/build/test.sh). Marca [x] en el plan justo después de comprobar cada tarea, no al final de la ronda (si te cancelan, lo hecho debe quedar anotado). Marca [x] solo lo comprobado. Las tareas que solo se pueden comprobar a mano en el simulador pásalas a [~] sin intentarlas. Si un test falla y no lo resuelves en 2 intentos, para: ok=false y en motivo el fallo exacto. Devuelve hechasAhora (tareas que pasaste a [x] o [~] en esta ronda) y pendientes (tareas [ ] que quedan).`, E_IMPL, `${id} · código ${ronda}`)
    if (!imp || !imp.ok || imp.pendientes === 0 || imp.hechasAhora === 0) break // los fallos los recoge la verificación
  }

  let v = null
  let problemas = []
  for (let intento = 0; intento <= MAX_ARREGLOS; intento++) {
    if (intento > 0) {
      const arr = await paso(`Paso ARREGLAR de ${id}, intento ${intento}. Arregla estos problemas:\n- ${problemas.join('\n- ')}\nSi quedan tareas [ ] en el plan, termínalas (afsd-plan paso 4). No cambies la spec salvo que el comportamiento real del sistema la contradiga (entonces corrige su texto como dice afsd-close). Ejecuta los tests afectados. Devuelve ok=false solo si no has podido arreglarlo, con el motivo.`, E_PASO, `${id} · arreglo ${intento}`)
      if (!arr) return fallo(null, 'falló el agente de arreglo')
    }

    v = await paso(`Paso VERIFICAR de ${id}. No edites código ni la spec. Carga la skill afsd-close y haz SOLO su paso 2 (verificar con pruebas), sin marcar casillas ni hacer commit:
- compila y ejecuta TODOS los tests (RunAllTests en el destino activo, o 01-TOOLS/build/test.sh); cuenta los tests ejecutados y fallidos en el log de consola, no en el resumen;
- ejecuta bash 01-TOOLS/arch/check.sh y cuenta solo las violaciones en archivos que tocó esta spec (git status y git diff --name-only HEAD);
- cuenta las tareas [ ] que quedan en el plan;
- para cada criterio de aceptación de ${rutaSpec}: "ok" con la prueba concreta (test, build, o preview o captura con RenderPreview o la skill device-interaction), "falla" con el porqué, o "manual" si solo lo puede juzgar una persona (aspecto, sensación), diciendo qué probar.`, E_VERIFICAR, `${id} · verificar`)
    if (!v) return fallo(null, 'falló el agente de verificación')

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
- orden obligatorio, para poder reanudar si te cancelan: primero todo lo demás (criterios, revision.md, lecciones, wiki); lo ÚLTIMO, justo antes del commit, el roadmap (✓ en la spec ${s.spec}; si era la última de ${s.feature}, la feature pasa a "hecha") y estado.md (sin spec activa, Siguiente paso: /afsd:build);
- no dejes pasar tiempo entre esos dos cambios y el commit: hazlos y commitea seguido.
Después haz un commit sin pedir confirmación, solo con los archivos de esta spec y de 02-DOCS: "feat(${s.feature}): ${s.spec} — <resumen en una línea>". Sin push. Devuelve el hash corto del commit y, en revisar, las líneas que añadiste a revision.md.`, E_CERRAR, `${id} · cerrar`)
  if (!cierre || !cierre.ok) return fallo(cierre, 'no se pudo cerrar ni hacer el commit')
  return { ok: true, commit: cierre.commit, revisar: cierre.revisar }
}

async function bloquear(id, motivo) {
  await paso(`Paso BLOQUEAR de ${id}. Esta spec no se pudo terminar: ${motivo}.
1. Guarda el trabajo a medias: git stash push -u -m "afsd-build ${id}".
2. En 02-DOCS/specs/_roadmap.md, marca la fila de su feature como "bloqueada (<motivo en 6 palabras>)".
3. En 02-DOCS/wiki/estado.md, sin spec activa y Siguiente paso: afsd build report.
4. Commit solo de esos dos archivos: "chore(build): ${id} bloqueada". Sin push.`, E_PASO, `${id} · bloquear`)
}

// --- Orquestación -----------------------------------------------------------
phase('Preparar')
const prep = await paso(`Paso PREPARAR. No escribas código ni cambies archivos.
1. Git: comprueba que la rama es afsd/build (git rev-parse --abbrev-ref HEAD). Si hay cambios sin commit (git status --porcelain) y estado.md no tiene una spec activa a medias, ok=false con el motivo. Si la tiene, son su trabajo a medias: sigue.
2. 02-DOCS/specs/_roadmap.md debe decir "Estado: aprobado"; si no, ok=false (hay que ejecutar afsd build plan).
3. Xcode: si tienes las herramientas MCP de Xcode, abre o localiza el proyecto y comprueba con XcodeListRunDestinations que el destino activo es un simulador; si es un dispositivo físico o "Any iOS…", ok=false pidiendo al usuario que elija un simulador en Xcode. mcp=true si tienes esas herramientas; si no, mcp=false y comprueba que existe 01-TOOLS/build/test.sh.
4. specs: las que faltan, en el orden del roadmap. De las features "pendiente" o "en curso", las specs sin ✓; excluye las features "aparcada" y "bloqueada". Si estado.md tiene una spec activa sin cerrar, ponla la primera. Para cada una: feature (slug), spec ("NN-nombre") y dependeDe (slugs de las features de la columna "Depende de"; [] si es "-"; "todas" = todas las features anteriores).
5. featuresBloqueadas: los slugs de las features que el roadmap ya tiene como "bloqueada" ([] si ninguna).`, E_PREPARAR, 'preparar')

if (!prep || !prep.ok) {
  return { empezado: false, motivo: prep ? prep.motivo : 'falló el agente de preparación', siguiente: 'corrige el motivo y vuelve a lanzar /afsd:build' }
}
log(`${prep.specs.length} spec(s) por hacer · MCP de Xcode: ${prep.mcp ? 'sí' : 'no'}`)

const hechas = []
const bloqueadas = []
const revisar = []
const featuresBloqueadas = new Set(prep.featuresBloqueadas || [])
let intentadas = 0

for (const s of prep.specs) {
  const id = `${s.feature}/${s.spec}`
  const dependeDeBloqueada = featuresBloqueadas.has(s.feature) || (s.dependeDe || []).some(f => featuresBloqueadas.has(f))
  if (dependeDeBloqueada) {
    bloqueadas.push({ id, motivo: 'depende de una feature bloqueada' })
    featuresBloqueadas.add(s.feature)
    continue
  }
  if (intentadas >= MAX_SPECS) break
  intentadas++

  phase(id)
  const r = await construir(s, id)
  if (r.ok) {
    hechas.push({ id, commit: r.commit })
    for (const x of r.revisar || []) revisar.push(x)
  } else {
    bloqueadas.push({ id, motivo: r.motivo })
    featuresBloqueadas.add(s.feature)
    await bloquear(id, r.motivo)
  }
}

phase('Informe')
const tocadas = new Set(hechas.map(h => h.id).concat(bloqueadas.map(b => b.id)))
const sinEmpezar = prep.specs.map(s => `${s.feature}/${s.spec}`).filter(id => !tocadas.has(id))
log(`${hechas.length} hecha(s) · ${bloqueadas.length} bloqueada(s) · ${sinEmpezar.length} sin empezar`)
return {
  hechas,
  bloqueadas,
  sinEmpezar,
  revisar,
  siguiente: sinEmpezar.length > 0
    ? 'vuelve a lanzar /afsd:build para seguir'
    : 'en un chat nuevo: afsd build report',
}
