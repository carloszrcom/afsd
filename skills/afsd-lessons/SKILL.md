---
name: afsd-lessons
description: Use when the user corrects the agent, the same mistake or failure happens twice, a bug's root cause is found, or the user says "afsd lessons" (or "afsd lessons review") in an AFSD project. Records the lesson in this project's lessons.md and promotes repeated ones to a rule. Per project only.
---

# afsd-lessons

Convierte un fallo o una corrección en algo que cambie el comportamiento la próxima vez. **Solo dentro de este proyecto**: nunca escribas fuera de él ni en el plugin de AFSD.
Una lección que queda solo en el chat se pierde en el siguiente chat.

## Cuándo
- **Solo:** el usuario te corrige, algo falla dos veces o aparece la causa de un bug. Captura en una línea y sigue con lo que hacías; no abras una conversación.
- `afsd lessons <lo que pasó>`: captura lo que diga el usuario. `afsd lessons review`: repaso (sección C).

## A. Capturar
1. Lee solo `02-DOCS/wiki/lessons.md` y la sección `## Reglas aprendidas` de `CLAUDE.md` (si existe).
   Si ya había una regla que cubría el caso, la lección es que no se aplicó: dilo y mejora su redacción; no añadas otra.
2. **Causa raíz, sin culpas.** Nombra el hueco del sistema: una regla que faltaba, una suposición falsa, una spec ambigua, un test que no existía.
   Nunca "el agente se equivocó" ni "el usuario no lo explicó".
3. **Elegir hogar** (el más barato que se active solo):
   - Hecho puntual del proyecto o de una API → solo `lessons.md`.
   - Regla de comportamiento que se repetirá → una línea en `## Reglas aprendidas` de `CLAUDE.md` (ver B).
   - Patrón de código prohibido o exigido → **propón** una Regla con `· check: deny|only …` para `arquitectura.md`. Las Reglas no se cambian sin permiso.
   - Criterio que faltó → añádelo a la spec activa (si ya está hecha, dilo y no la reescribas).
   - Decisión hacia delante con alternativas → `decisions.md` (`D-NN`), no aquí.
4. **Escribir.** Añade al final de `lessons.md`, sin borrar ni reescribir líneas (si el archivo no existe o está vacío, créalo con el encabezado del final):
   `- <fecha> · <lección en imperativo> · situación: <qué pasó> · hogar: <lessons|CLAUDE.md|check|spec> · activa: <cómo la aplicará el agente>`
   Sin `hogar` y `activa` no cuenta como capturada.

## B. Recurrencia
- **1.ª vez:** basta la nota.
- **2.ª vez de la misma clase:** hace falta una barrera. Redacta la regla en una línea, muéstrala y **espera un sí** antes de escribirla en `## Reglas aprendidas` de `CLAUDE.md` (créala al final si falta).
  Máximo 10 reglas: si ya hay 10, propón cuál fusionar o quitar. Marca las líneas originales de `lessons.md` con ` → regla` al final.
  Si la clase es comprobable con `grep`, propón mejor una Regla con `check:`.
- **3.ª vez:** la barrera falló. Reescríbela más fuerte o cámbiala por un `check:`; no añadas otra nota.

## C. `afsd lessons review`
Lee `lessons.md` entero y `## Reglas aprendidas`. Responde en menos de 15 líneas:
- las clases que se repiten y deberían pasar a regla;
- reglas que se pueden fusionar o quitar (por obsoletas);
- líneas ya promovidas (` → regla`) que se pueden archivar.
Aplica solo lo que el usuario apruebe. Archivar es **mover** a `02-DOCS/archive/lessons-<año>.md`, no borrar. Objetivo: `lessons.md` con unas 30 líneas activas.

## Encabezado de lessons.md
```
# Lecciones
Solo se añade. Formato: - <fecha> · <lección> · situación · hogar · activa. Las promovidas a regla llevan → regla. El hook de AFSD muestra las 5 últimas sin promover al empezar el chat.
```

## Al terminar
Una línea: dónde quedó y cómo se activará. Si la capturaste en mitad de otro paso, no añadas **Siguiente**: sigue con ese paso.
Si te invocaron con `afsd lessons`, termina con **Siguiente** y el prompt exacto del *Siguiente paso* de `estado.md`.
