#!/bin/bash
# AFSD · comprobación de arquitectura: huella del proyecto + reglas de 02-DOCS/wiki/arquitectura.md
# Uso:  bash 01-TOOLS/arch/check.sh            huella y violaciones (salida corta)
#       bash 01-TOOLS/arch/check.sh --huella   solo la huella actual
# Salida: 0 sin violaciones · 1 con violaciones
# Reglas comprobables (una línea en la sección Reglas):
#   - R1 <texto> · check: deny <carpeta[,carpeta]> `<regex>`   el patrón no puede aparecer en esas carpetas
#   - R2 <texto> · check: only <carpeta[,carpeta]> `<regex>`   el patrón solo puede aparecer en esas carpetas
# Compatible con bash 3.2 (macOS). Solo mira archivos .swift.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
ARCH="02-DOCS/wiki/arquitectura.md"
MAX=5
EXCL='(^|/)(\.git|\.build|\.swiftpm|DerivedData|Pods|Carthage|build|xcuserdata|01-TOOLS|02-DOCS)(/|$)'

hash12() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -c1-12; }
swift_files() { find . -name '*.swift' -type f 2>/dev/null | sed 's|^\./||' | grep -Ev "$EXCL" | LC_ALL=C sort; }

huella() {
  {
    echo "## carpetas"
    find . -mindepth 1 -maxdepth 2 -type d 2>/dev/null | sed 's|^\./||' | grep -Ev "$EXCL" \
      | grep -Ev '(^|/)\.|\.(xcodeproj|xcworkspace|xcassets|lproj|xcdatamodeld)(/|$)' | LC_ALL=C sort
    echo "## targets y paquetes"
    find . -name project.pbxproj -type f 2>/dev/null | grep -Ev "$EXCL" | LC_ALL=C sort | while IFS= read -r f; do
      grep -E 'productName = |productType = |repositoryURL = ' "$f" | sed 's/^[[:space:]]*//' | LC_ALL=C sort -u
    done
    find . -name Package.swift -type f 2>/dev/null | grep -Ev "$EXCL" | LC_ALL=C sort | while IFS= read -r f; do
      echo "# $f"; grep -E '\.(package|target|testTarget|executableTarget|library)\(' "$f" | sed 's/^[[:space:]]*//'
    done
  } | hash12
}

ACTUAL="$(huella)"
if [ "${1:-}" = "--huella" ]; then echo "$ACTUAL"; exit 0; fi

if [ ! -f "$ARCH" ]; then echo "Huella: $ACTUAL (no hay $ARCH)"; exit 0; fi
GUARDADA="$(sed -n 's/^Huella: *\([0-9a-f]\{12\}\).*/\1/p' "$ARCH" | head -1)"
if [ -z "$GUARDADA" ]; then echo "Huella: sin guardar (actual: $ACTUAL)"
elif [ "$GUARDADA" = "$ACTUAL" ]; then echo "Huella: igual ($ACTUAL)"
else echo "Huella: cambiada (guardada: $GUARDADA, actual: $ACTUAL)"; fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t afsd)"; trap 'rm -rf "$TMP"' EXIT
: > "$TMP/total"; : > "$TMP/n"
grep -E '^- R[0-9]+ .*check: (deny|only) ' "$ARCH" | while IFS= read -r line; do
  echo x >> "$TMP/n"
  id="$(printf '%s\n' "$line" | sed -E 's/^- (R[0-9]+).*/\1/')"
  spec="$(printf '%s\n' "$line" | sed -E 's/.*check: //')"
  kind="${spec%% *}"; rest="${spec#* }"; dirs="${rest%% *}"
  regex="$(printf '%s\n' "${rest#* }" | sed -E 's/^`//; s/`[[:space:]]*$//')"
  dirre="$(printf '%s' "$dirs" | sed -E 's/[.]/\\./g; s/,/|/g')"
  : > "$TMP/hits"
  if [ "$kind" = "deny" ]; then
    for d in $(printf '%s' "$dirs" | tr ',' ' '); do
      [ -d "$d" ] || echo "$id aviso: la carpeta $d no existe (regla sin efecto todavía)"
    done
    swift_files | grep -E "^($dirre)/" | tr '\n' '\0' | xargs -0 grep -nE "$regex" /dev/null 2>/dev/null > "$TMP/hits"
  else
    swift_files | grep -Ev "^($dirre)/" | tr '\n' '\0' | xargs -0 grep -nE "$regex" /dev/null 2>/dev/null > "$TMP/hits"
  fi
  n="$(wc -l < "$TMP/hits" | tr -d ' ')"
  if [ "$n" -gt 0 ]; then
    echo "$id $n violación(es) [$kind $dirs]:"
    head -n "$MAX" "$TMP/hits" | sed 's/[[:space:]]\{2,\}/ /g' | cut -c1-140 | sed 's/^/  /'
    [ "$n" -gt "$MAX" ] && echo "  … y $((n - MAX)) más"
    i=0; while [ "$i" -lt "$n" ]; do echo x >> "$TMP/total"; i=$((i + 1)); done
  fi
done
REGLAS="$(wc -l < "$TMP/n" | tr -d ' ')"
TOTAL="$(wc -l < "$TMP/total" | tr -d ' ')"
MANUALES="$(grep -E '^- R[0-9]+ ' "$ARCH" | grep -Evc 'check: (deny|only) ')"
echo "Reglas: $REGLAS comprobables, $MANUALES manuales · Violaciones: $TOTAL"
[ "$TOTAL" -eq 0 ]
