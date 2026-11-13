---
description: AFSD - pide al workflow /afsd:build que pare cuando termine la spec en curso
allowed-tools: Bash(mkdir -p 02-DOCS/build), Bash(touch 02-DOCS/build/STOP)
disable-model-invocation: true
---

Ejecuta `mkdir -p 02-DOCS/build && touch 02-DOCS/build/STOP` en la raíz del proyecto. Responde solo: "STOP creado: /afsd:build parará al terminar la spec en curso. Para seguir después: /afsd:resume y /afsd:build." No hagas nada más.
