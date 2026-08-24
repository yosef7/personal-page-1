#!/usr/bin/env bash
#
# Calcula el valor que debes pegar como variable de entorno GARAGE164_WRITE_HASH
# en el panel de Netlify (Site settings -> Environment variables). Se ejecuta
# UNA sola vez, al elegir la contraseña (o al cambiarla).
#
# La contraseña no se muestra, no se guarda y no sale de esta computadora:
# el resultado es un hash, no la contraseña ni el token derivado de ella.

set -euo pipefail
read -rsp "Contraseña de Garage 164: " PASS; echo

GARAGE164_TEST_PASS="$PASS" node --input-type=module -e '
const ITERATIONS = 600_000
const WRITE_TOKEN_INFO = "garage164-write-token-v1"
const { webcrypto } = await import("node:crypto")
const encoder = new TextEncoder()
const pass = process.env.GARAGE164_TEST_PASS

const material = await webcrypto.subtle.importKey("raw", encoder.encode(pass), "PBKDF2", false, ["deriveBits"])
const bits = await webcrypto.subtle.deriveBits(
  { name: "PBKDF2", salt: encoder.encode(WRITE_TOKEN_INFO), iterations: ITERATIONS, hash: "SHA-256" },
  material, 256)
const writeToken = Buffer.from(bits).toString("hex")

const digest = await webcrypto.subtle.digest("SHA-256", encoder.encode(writeToken))
const hash = Buffer.from(digest).toString("hex")

console.log("\nPega esto como GARAGE164_WRITE_HASH en Netlify:\n")
console.log(`  ${hash}\n`)
console.log("Site settings -> Environment variables -> Add a variable")
console.log("Después de guardarla, Netlify necesita un nuevo deploy para que la función la vea.\n")
'
unset GARAGE164_TEST_PASS PASS
