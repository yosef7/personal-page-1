#!/usr/bin/env bash
#
# Diagnostica por qué una contraseña abre (o no) la colección publicada.
# Descarga el vault vigente desde la Function en vivo (o desde
# GARAGE164_VAULT_URL si lo indicas) y prueba la clave y sus variantes de
# codificación Unicode. La contraseña no se muestra, no se guarda y no sale
# de tu computadora.

set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

URL="${GARAGE164_VAULT_URL:-https://www.arnulforeyes.com/garage164/api/vault}"

read -rsp "Contraseña a probar: " CLAVE; echo
echo "Verificando variantes contra $URL (cada una tarda un momento)…"

GARAGE164_TEST_PASS="$CLAVE" GARAGE164_TEST_URL="$URL" node --input-type=module -e '
import { webcrypto } from "node:crypto"

const url = process.env.GARAGE164_TEST_URL
const respuesta = await fetch(url, { cache: "no-store" })
if (respuesta.status === 404) {
  console.error("\nLa colección todavía no está publicada en esa URL (404).")
  process.exit(1)
}
if (!respuesta.ok) {
  console.error(`\nNo se pudo leer ${url} (HTTP ${respuesta.status}).`)
  process.exit(1)
}
const vault = await respuesta.json()

const pass = process.env.GARAGE164_TEST_PASS
const b64 = (v) => Uint8Array.from(Buffer.from(v, "base64"))

async function abre(candidata) {
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(candidata), "PBKDF2", false, ["deriveKey"])
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(vault.salt), iterations: vault.iterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"])
  try {
    await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b64(vault.iv) }, key, b64(vault.ciphertext))
    return true
  } catch { return false }
}

// --- Perfil de la contraseña, sin revelarla ---
const soloAscii = /^[\x20-\x7E]+$/.test(pass)
const nfc = pass.normalize("NFC")
const nfd = pass.normalize("NFD")
const espacios = pass !== pass.trim()

console.log(`\n  Longitud            : ${pass.length} caracteres`)
console.log(`  ¿Solo caracteres ASCII? : ${soloAscii ? "sí" : "NO — contiene acentos, ñ o símbolos especiales"}`)
console.log(`  ¿Espacios al inicio/fin?: ${espacios ? "SÍ — puede ser el problema" : "no"}`)

// --- Qué variantes abren el vault ---
const variantes = [["tal como la escribiste", pass]]
if (nfc !== pass) variantes.push(["normalizada NFC (la que envía el navegador)", nfc])
if (nfd !== pass) variantes.push(["normalizada NFD (la que suele producir macOS)", nfd])
if (espacios)     variantes.push(["sin espacios sobrantes", pass.trim()])

console.log("\n  Resultados:")
for (const [nombre, cand] of variantes) {
  console.log(`   ${(await abre(cand)) ? "✓" : "✗"}  ${nombre}`)
}

if (nfc === nfd) {
  console.log("\n  Tu contraseña no tiene variantes de codificación:")
  console.log("  el navegador enviará exactamente los mismos bytes que la terminal.")
} else {
  console.log("\n  ATENCIÓN: tu contraseña tiene dos representaciones Unicode posibles.")
  console.log("  Si la marcada con ✓ no es la NFC, el navegador nunca podrá abrirla.")
}
console.log()
'
unset GARAGE164_TEST_PASS GARAGE164_TEST_URL CLAVE
