---
name: afsd-build
description: Use when the user says "afsd build plan <design-doc.md>" or "afsd build report" in an AFSD project. Builds a whole app or game from its design document - plan turns the document into an approved roadmap; the /afsd:build workflow then builds, tests, reviews and commits every spec with a fresh subagent per phase; report lists what needs human review. Payments are only prepared (RevenueCat-ready stub).
---

# afsd-build

Construye una app (o un juego) entera a partir de su documento de diseño:
- `afsd build plan <doc.md>`: **interactivo, una sola vez**. Convierte el documento en `02-DOCS/specs/_roadmap.md` y el usuario lo aprueba.
- `/afsd:build`: el **workflow** del plugin (`workflows/afsd-build.js`). Recorre el roadmap spec a spec; cada fase (spec, plan, código, verificación, revisión independiente, cierre y commit) la hace un agente nuevo con el contexto limpio, y los resultados quedan en variables del script, no en el chat. Lo lanza el usuario; esta skill no lo ejecuta.
- `afsd build report`: resumen de lo que necesita revisión humana.

Si falta `02-DOCS/`, di que antes hay que crear el proyecto en Xcode y ejecutar `afsd init` (o `afsd adopt`) y `afsd arch define`, y para.

## Modo plan
1. **Leer lo mínimo:** `estado.md`, `arquitectura.md` y el documento de diseño. Si el documento pasa de unas 300 líneas, que lo lea un subagente y te devuelva el resumen del paso 2.
   Si las **Reglas** de `arquitectura.md` están pendientes, di que primero va `afsd arch define` y para.
   Si el destino activo de Xcode no es un simulador (`XcodeListRunDestinations`), avisa y pide que elija uno antes del roadmap.
2. **Resumen del juego:** escribe `02-DOCS/wiki/juego.md` (máx. 60 líneas): concepto, bucle de juego, mecánicas, pantallas, economía (moneda del juego frente a compras con dinero real), contenido y fuera de alcance; en cada sección, la referencia `§` a la parte del documento que la detalla.
   Las vueltas de `next` leen este resumen y solo la `§` que necesitan, nunca el documento entero. Añade en `index.md` una línea a `juego.md` y al roadmap.
3. **Tecnología:** atente a lo que ya hay (proyecto, `arquitectura.md`, frameworks: SwiftUI, SpriteKit, SceneKit, RealityKit…).
   Si el documento pide algo que no encaja, o ves una mejora clara, **propónla** con su porqué y su coste; no la apliques sin un sí (queda como `D-NN`).
   Para que se pueda probar sin personas: la lógica del juego va en modelos Swift puros (Domain) con tests; el render y las vistas, finos por encima.
4. **Preguntas:** máximo 8, de una vez, cada una con tu recomendación. Solo lo que el documento no resuelve y cambia el resultado.
   Después no habrá más preguntas: lo que quede abierto lo decidirá `next` y lo marcará `[revisar]`.
5. **Roadmap:** `02-DOCS/specs/_roadmap.md`, features en orden de dependencias; cada una con 1–4 specs pequeñas (máx. 8 criterios, comprobables con test o en el simulador):
```
# Roadmap
Fuente: <ruta del documento, relativa a la raíz del proyecto (ej. docs/diseno.md), no a 02-DOCS> · Resumen: ../wiki/juego.md · Estado: borrador · Rama: afsd/build
| # | Feature | Specs | Estado | Depende de |
|---|---------|-------|--------|------------|
| 01 | pagos-base | 01-servicio-compras-stub | pendiente | - |
| 02 | <feature> | 01-<spec>, 02-<spec> | pendiente | 01 |
| 99 | pagos-revenuecat | 01-revenuecat | aparcada | todas |
## Notas
```
   Estados de fila: `pendiente`, `en curso`, `hecha`, `bloqueada (<motivo>)` y `aparcada` (`next` nunca la toca). En `Specs`, las hechas llevan ✓ (`01-<spec> ✓`).
6. **Pagos: preparados, no implementados** (si el juego tiene compras):
   - `pagos-base`, temprana. En Domain, un protocolo `PurchaseService` con los conceptos de RevenueCat: ofertas (*offerings*), productos (id, título, precio, tipo: consumible, no consumible o suscripción), comprar con resultado (`completada`, `cancelada`, `pendiente`), restaurar, y derechos activos (*entitlements*) con un flujo de cambios.
     En Data, `StubPurchaseService` configurable (todo desbloqueado, sin compras o fallo simulado) y el catálogo de IDs de producto como datos. Se compone en App; las pantallas de tienda llaman al protocolo a través de su ViewModel.
     La moneda del juego es lógica del juego, no pagos: una compra consumible solo la abona a través del servicio.
   - Asegura la Regla de pagos en `arquitectura.md` (`check: only <App>/Data` con `^import (RevenueCat|StoreKit)`); si falta, propónla.
   - `pagos-revenuecat`, **aparcada**: escribe ya `02-DOCS/specs/pagos-revenuecat/_feature.md` (`Estado: aparcada`) y `01-revenuecat.md` (`Estado: borrador`): SDK por SPM, `RevenueCatPurchaseService` en Data que sustituye al stub en la composición, API key fuera del código, productos en App Store Connect y en RevenueCat, pruebas en sandbox y restaurar compras.
7. **Aprobación:** resumen de máx. 8 líneas y espera `apruebo el roadmap`. Al aprobar:
   - Roadmap `Estado: aprobado`. Si hay git y el árbol está limpio, `git switch -c afsd/build` (si no está limpio, pide un commit antes). Commit solo de `02-DOCS/`: `chore(build): roadmap`. Sin push.
   - `estado.md`: Fase: ninguna · Siguiente paso: `/afsd:build`.
   - **Permisos**, para que los agentes del workflow no se paren a preguntar: propón añadir a `.claude/settings.local.json` (créalo, o mézclalo sin borrar nada) en `permissions.allow`:
     `"Edit"`, `"Write"`, `"Bash(git status)"`, `"Bash(git status *)"`, `"Bash(git diff *)"`, `"Bash(git add *)"`, `"Bash(git commit *)"`, `"Bash(git stash *)"`, `"Bash(git log *)"`, `"Bash(git rev-parse *)"`, `"Bash(xcodebuild *)"`, `"Bash(xcrun simctl *)"`, `"Bash(bash 01-TOOLS/*)"`, `"Bash(zsh 01-TOOLS/*)"`, `"Bash(mkdir *)"`, `"Bash(touch *)"`, `"mcp__plugin_xcode-integration_xcode"`, `"Workflow(afsd:build)"`.
     Muéstralo y escríbelo solo con un sí. Si git no lo ignora (`git check-ignore .claude/settings.local.json`), añádelo a `.git/info/exclude` (no a `.gitignore`), porque el workflow exige el árbol limpio.
   - Termina con **Siguiente — en este chat o en uno nuevo de `cxa`:** `/afsd:build` (para probar con pocas: `/afsd:build con maxSpecs 3`).
     Añade en una línea: deja Claude Code abierto y el Mac despierto (`caffeinate -dims` en otra terminal); el progreso se ve con `/workflows` (`p` pausa, `x` para).

## Modo report
Lee `_roadmap.md`, `02-DOCS/build/revision.md`, las líneas `[revisar]` de `decisions.md` y `git stash list` (solo `afsd-build`). Máximo 25 líneas:
- progreso (features hechas / total) y bloqueadas, con su motivo y su stash;
- qué probar en el simulador (de `revision.md`), agrupado por pantalla;
- decisiones a revisar y reglas propuestas para `CLAUDE.md` (se aplican con `afsd lessons review`);
- pagos: `pagos-revenuecat` está escrita y aparcada → cuando quieras, `afsd feature pagos-revenuecat`.
Termina con **Siguiente** y el prompt exacto (normalmente: probar en el simulador y luego `afsd quick <ajuste>` o `afsd feature <cambio>`).
