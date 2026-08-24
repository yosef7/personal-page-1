#!/usr/bin/env bash
#
# Diagnostica por qué una contraseña abre (o no) garage164/vault.enc.json.
# Prueba la clave tal cual y sus variantes de codificación Unicode.
# La contraseña no se muestra, no se guarda y no sale de tu computadora.

set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

[ -f garage164/vault.enc.json ] || { echo "No existe garage164/vault.enc.json"; exit 1; }

read -rsp "Contraseña a probar: " CLAVE; echo
echo "Verificando variantes (cada una tarda un momento)…"

GARAGE164_TEST_PASS="$CLAVE" node --input-type=module -e '
import { readFile } from "node:fs/promises"
import { webcrypto } from "node:crypto"

const vault = JSON.parse(await readFile("garage164/vault.enc.json", "utf8"))
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
unset GARAGE164_TEST_PASS CLAVE
