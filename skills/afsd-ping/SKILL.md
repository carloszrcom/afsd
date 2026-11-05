---
name: afsd-ping
description: Use when the user says "afsd ping" to check that the AFSD plugin is loaded and working (version, hooks, project detected).
---

Responde con este formato exacto, sin explicaciones, y lee como mucho un archivo (el `plugin.json`):

```
>>> AFSD trabajando correctamente <<<
Versión: <campo "version" de `.claude-plugin/plugin.json`, dos carpetas por encima del "Base directory" de esta skill>
Proyecto AFSD: <sí si en tu contexto ya hay un bloque "Proyecto AFSD" con el estado (lo inyecta el hook de arranque) y entonces añade la fase y el siguiente paso; no si no lo hay>
Hooks: <activos si has recibido ese bloque; sin confirmar si no (en Xcode no se ejecutan; en un proyecto sin `02-DOCS/` tampoco hay nada que inyectar)>
```
