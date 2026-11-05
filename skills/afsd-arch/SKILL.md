---
name: afsd-arch
description: Use when the user says "afsd arch define" or "afsd arch sync" in an AFSD project (afsd-adopt also runs sync). define sets the target architecture and checkable rules from a preset; sync refreshes the current architecture from the code, only when the project fingerprint changed.
---

# afsd-arch

`02-DOCS/wiki/arquitectura.md` es un contrato con tres secciones: **Actual** (verificado en el código), **Objetivo** (decidido, sin construir) y **Reglas** (invariantes comprobables). Máximo 60 líneas. No escribas código de la app.
Si falta `02-DOCS/`, di que hay que ejecutar `afsd init` o `afsd adopt` y para.

## 0. Preparar
- Si no existe `01-TOOLS/arch/check.sh`, cópialo desde `check.sh` de la carpeta de esta skill, dale permiso de ejecución y, si hay git, `git update-index --chmod=+x 01-TOOLS/arch/check.sh`.
  Lánzalo siempre con `bash 01-TOOLS/arch/check.sh` (en Xcode el archivo puede quedar sin permiso de ejecución).
  Si no encuentras la carpeta de la skill, dilo en una línea y sigue: las reglas quedan sin comprobación automática.
- Si `arquitectura.md` no tiene las tres secciones (formato antiguo), pásalo a este formato poniendo lo que había en **Actual**, sin perder información:

```
# Arquitectura
Huella: <12 caracteres de `bash 01-TOOLS/arch/check.sh --huella`> · Actualizado: <fecha>

## Actual
| Zona | Carpeta | Capa | Para qué |
|------|---------|------|----------|
Dependencias externas: <lista>
Comandos: tests con `01-TOOLS/build/test.sh` · arquitectura con `bash 01-TOOLS/arch/check.sh`
Línea base de tests: <pasan N, fallan M (cuáles)>

## Objetivo
- <decisión aún sin construir> (D-NN)

## Reglas
- R1 <regla> · check: deny <carpeta[,carpeta]> `<regex>`
- R2 <regla> · check: only <carpeta[,carpeta]> `<regex>`
- R3 <regla> · manual
```
`deny`: el patrón no puede aparecer en esas carpetas. `only`: solo puede aparecer en ellas. Rutas relativas a la raíz del proyecto.

## Modo define (proyecto nuevo o cambio de rumbo)
1. Lee `estado.md` y `arquitectura.md`. No leas código.
2. Lee `presets/ios-clean.md` de la carpeta de esta skill (si el proyecto no es una app SwiftUI, sin preset: pregunta tú).
   Resume en 5 líneas qué propone y haz de una vez solo las preguntas abiertas que apliquen (máximo 3, cada una con tu recomendación).
3. Escribe **Objetivo** y **Reglas** adaptando `<App>` al nombre real de la carpeta. No toques **Actual**.
4. Cada decisión del Objetivo: una línea en `decisions.md` (`- D-NN · <fecha> · arquitectura · <decisión> · <por qué>`), citada en el Objetivo como `(D-NN)`.
5. Ejecuta `bash 01-TOOLS/arch/check.sh`. Los avisos de carpetas que aún no existen son normales en un proyecto nuevo.
6. `estado.md`: Siguiente paso `afsd feature <idea>`. Resume en 5 líneas.

## Modo sync (proyecto existente o cambios hechos fuera del flujo)
1. Ejecuta `bash 01-TOOLS/arch/check.sh`. Si la huella es **igual** y **Actual** tiene zonas: di "arquitectura al día", lista las violaciones si las hay y para. No leas nada más.
2. Si cambió, o **Actual** está vacío: mapea con un subagente que devuelva solo el resumen, y solo lo que haya cambiado. Fuentes, en este orden, para cuando tengas suficiente:
   `README`/`docs` existentes (enlázalos, no los copies) · `xcodebuild -list` y `Package.swift` · árbol de carpetas (solo nombres, 3 niveles) ·
   `git log --oneline --stat` desde la fecha de *Actualizado* (o los últimos 50) · búsquedas puntuales (`@main`, `@Model`, `@Observable`, `import SwiftData`, `RevenueCat`, `StoreKit`).
   Como máximo 10 archivos leídos enteros; si necesitas más, pregunta.
3. Reescribe **Actual** (una línea por zona, sin documentar comportamiento). Lo que del **Objetivo** ya esté construido, muévelo a Actual. No cambies Reglas.
   Si no hay línea base de tests, ejecuta `01-TOOLS/build/test.sh` una vez y anótala.
4. Guarda la huella nueva (`bash 01-TOOLS/arch/check.sh --huella`) y la fecha. Si hay zonas nuevas o renombradas, actualiza el mapa de `index.md`.
5. Violaciones: lístalas, no las arregles. Para cada una propone una spec o una excepción en `decisions.md`.
6. Resume en 5 líneas: zonas, cambios desde la última vez, violaciones.

## Al terminar
Aplica la regla de cambio de chat de `CLAUDE.md` y termina con **Siguiente** y el prompt exacto.
Aquí:
- define terminado → **en un chat nuevo**: `afsd feature <describe la feature en una frase>`.
- sync con violaciones → **en un chat nuevo**: `afsd feature corregir la violación R<n> de arquitectura` (o la excepción que se decida).
- sync sin violaciones → el *Siguiente paso* de `estado.md`.
