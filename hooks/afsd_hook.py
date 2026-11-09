#!/usr/bin/env python3
"""Hooks de AFSD para Claude Code. Solo actúan en proyectos con 02-DOCS/wiki/estado.md.

session-start  inyecta estado.md, las 5 últimas lecciones sin promover y la nota de sesión más reciente (ahorra lecturas al empezar).
pre-edit       al editar un .swift sin estar en fase de implementación (y sin marcador `afsd quick` reciente), pide confirmación;
               en `afsd build` (AFSD_BUILD=1, sin usuario) lo deniega con el motivo.
stop           si la respuesta propone "un chat nuevo" y no hay nota de sesión reciente, obliga a escribirla.

Compatible con el python3 de macOS (3.9). Ante cualquier error, no bloquea nada.
"""
import json
import os
import sys
import time

NOTA_RECIENTE_SEG = 20 * 60
MARCADOR_QUICK_SEG = 30 * 60
MAX_CONTEXTO = 4000
MAX_LECCIONES = 5
MAX_LINEA_LECCION = 220


def leer_entrada():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def raiz(data):
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def ruta_estado(root):
    return os.path.join(root, "02-DOCS", "wiki", "estado.md")


def leer(path, limite=None):
    try:
        with open(path, encoding="utf-8") as f:
            texto = f.read()
    except Exception:
        return ""
    return texto if limite is None else texto[:limite]


def nota_mas_reciente(root):
    carpeta = os.path.join(root, "02-DOCS", "sessions")
    try:
        notas = [os.path.join(carpeta, n) for n in os.listdir(carpeta) if n.endswith(".md")]
    except Exception:
        return None
    return max(notas, key=os.path.getmtime) if notas else None


def lecciones_recientes(root):
    """Últimas lecciones de lessons.md que aún no se han promovido a regla (' → regla')."""
    texto = leer(os.path.join(root, "02-DOCS", "wiki", "lessons.md"))
    lineas = [l.strip() for l in texto.splitlines() if l.strip().startswith("- ") and "→ regla" not in l]
    return [l[:MAX_LINEA_LECCION] for l in lineas[-MAX_LECCIONES:]]


def fase(root):
    for linea in leer(ruta_estado(root)).splitlines():
        if linea.strip().lower().startswith("- fase:"):
            return linea.split(":", 1)[1].strip()
    return ""


def emitir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))


def session_start(data):
    root = raiz(data)
    estado = leer(ruta_estado(root))
    if not estado:
        return
    partes = ["Proyecto AFSD. Ya tienes en contexto `02-DOCS/wiki/estado.md`; no lo vuelvas a leer.", estado.strip()]
    lecciones = lecciones_recientes(root)
    if lecciones:
        partes.append("Lecciones recientes de este proyecto (`02-DOCS/wiki/lessons.md`); aplícalas:\n" + "\n".join(lecciones))
    nota = nota_mas_reciente(root)
    if nota:
        partes.append("Nota de sesión más reciente (`%s`):\n%s" % (os.path.relpath(nota, root), leer(nota, 1500).strip()))
    emitir({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                   "additionalContext": "\n\n".join(partes)[:MAX_CONTEXTO]}})


def pre_edit(data):
    root = raiz(data)
    if not os.path.isfile(ruta_estado(root)):
        return
    entrada = data.get("tool_input") or {}
    ruta = entrada.get("file_path") or entrada.get("filePath") or entrada.get("path") or ""
    if not ruta.endswith(".swift"):
        return
    f = fase(root)
    if "implementaci" in f.lower():
        return
    marcador = os.path.join(root, "02-DOCS", ".quick")
    try:
        if time.time() - os.path.getmtime(marcador) < MARCADOR_QUICK_SEG:
            return
    except OSError:
        pass
    if os.environ.get("AFSD_BUILD") == "1":
        emitir({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "AFSD build: la fase es \"%s\", no implementación. Aprueba antes el plan "
                                        "(afsd-plan pasos 1-3, Fase: implementación en estado.md) y vuelve a intentarlo." % (f or "sin fase"),
        }})
        return
    emitir({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": "AFSD: vas a editar código Swift (%s) y la fase es \"%s\", no implementación. "
                                    "Sin spec aprobada solo se permiten cambios de una línea." % (os.path.basename(ruta), f or "sin fase"),
    }})


def ultima_respuesta(transcript_path):
    textos = []
    try:
        with open(transcript_path, encoding="utf-8") as f:
            for linea in f:
                try:
                    o = json.loads(linea)
                except Exception:
                    continue
                tipo = o.get("type")
                contenido = (o.get("message") or {}).get("content")
                if tipo == "user":
                    es_prompt = isinstance(contenido, str) or any(
                        isinstance(b, dict) and b.get("type") == "text" for b in (contenido or []))
                    if es_prompt:
                        textos = []
                elif tipo == "assistant" and isinstance(contenido, list):
                    textos += [b.get("text", "") for b in contenido if isinstance(b, dict) and b.get("type") == "text"]
    except Exception:
        return ""
    return "\n".join(textos)


def stop(data):
    if data.get("stop_hook_active"):
        return
    root = raiz(data)
    if not os.path.isfile(ruta_estado(root)):
        return
    texto = data.get("last_assistant_message") or ultima_respuesta(data.get("transcript_path") or "")
    if "en un chat nuevo" not in texto.lower():
        return
    nota = nota_mas_reciente(root)
    if nota and time.time() - os.path.getmtime(nota) < NOTA_RECIENTE_SEG:
        return
    emitir({"decision": "block",
            "reason": "AFSD: propones un chat nuevo pero no has escrito la nota de sesión. Escribe ahora "
                      "`02-DOCS/sessions/<fecha>-<feature>-<NN-spec>.md` (formato en CLAUDE.md, máx. 10 líneas; "
                      "si existe, reescríbela entera), actualiza `estado.md` y repite el bloque **Siguiente**."})


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else ""
    data = leer_entrada()
    try:
        {"session-start": session_start, "pre-edit": pre_edit, "stop": stop}.get(modo, lambda d: None)(data)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
