#!/usr/bin/env bash
#
# Cifra garage164/data.json y prepara la publicación de Garage 164.
#
#   Uso:  ./garage164/tools/publicar.sh
#
# La contraseña se pide en pantalla, nunca se escribe en el comando ni queda
# en el historial de la terminal.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

DATOS="garage164/data.json"
VAULT="garage164/vault.enc.json"

rojo()  { printf '\033[31m%s\033[0m\n' "$1"; }
verde() { printf '\033[32m%s\033[0m\n' "$1"; }
gris()  { printf '\033[90m%s\033[0m\n' "$1"; }

# --- 1. Comprobaciones previas -------------------------------------------

if [ ! -f "$DATOS" ]; then
  rojo "No existe $DATOS"
  gris "Créalo con:  cp garage164/data.example.json garage164/data.json"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  rojo "Node.js no está instalado. Es necesario para cifrar."
  exit 1
fi

if ! git check-ignore -q "$DATOS"; then
  rojo "PELIGRO: $DATOS no está protegido por .gitignore."
  rojo "Se detiene aquí para evitar publicar la colección sin cifrar."
  exit 1
fi

if ! python3 -c "import json,sys; json.load(open('$DATOS'))" 2>/dev/null; then
  rojo "$DATOS tiene un error de sintaxis JSON."
  gris "Revisa comas y comillas antes de continuar."
  exit 1
fi

# --- 2. Resumen de lo que se va a cifrar ---------------------------------

python3 - "$DATOS" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
cars = d.get('cars', [])
wish = d.get('wishlist', [])
total = sum(int(c.get('quantity', 1) or 1) for c in cars)
print(f"\n  Colección : {d.get('collectionName', 'Garage 164')}")
print(f"  Actualizado: {d.get('updatedAt', '(sin fecha)')}")
print(f"  Modelos    : {len(cars)}")
print(f"  Unidades   : {total}")
print(f"  Por conseguir: {len(wish)}\n")
PY

# --- 3. Contraseña --------------------------------------------------------

read -rsp "Contraseña de Garage 164: " PASS1; echo
read -rsp "Confírmala: " PASS2; echo

if [ "$PASS1" != "$PASS2" ]; then
  rojo "Las contraseñas no coinciden."
  exit 1
fi

if [ "${#PASS1}" -lt 14 ]; then
  rojo "La contraseña debe tener al menos 14 caracteres."
  exit 1
fi

# --- 4. Cifrado -----------------------------------------------------------

export GARAGE164_PASSWORD="$PASS1"
node garage164/tools/encrypt-vault.mjs "$DATOS" "$VAULT"
unset GARAGE164_PASSWORD PASS1 PASS2

# --- 5. Verificación de seguridad antes de publicar ----------------------

if git status --porcelain --untracked-files=all garage164/ | grep -q "data\.json"; then
  rojo "PELIGRO: $DATOS aparecería en el commit. No se publica nada."
  exit 1
fi

verde "Vault cifrado correctamente."
gris "Pruébalo antes de publicar:"
gris "  python3 -m http.server 8001 --bind 127.0.0.1"
gris "  http://127.0.0.1:8001/garage164/"
echo

# --- 6. Publicación opcional ---------------------------------------------

read -rp "¿Publicar ahora en el sitio? (s/N): " RESP
if [ "${RESP:-n}" != "s" ] && [ "${RESP:-n}" != "S" ]; then
  gris "No se publicó. Cuando quieras hacerlo:"
  gris "  git add $VAULT && git commit -m 'chore(garage164): actualiza la colección' && git push"
  exit 0
fi

git add "$VAULT"
git commit -m "chore(garage164): actualiza la colección"
git push
verde "Publicado. Netlify despliega en menos de un minuto."
