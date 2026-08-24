#!/usr/bin/env node
//
// Cifra garage164/data.json y lo publica directamente en la Netlify Function
// (que lo guarda en Netlify Blobs). No pasa por git ni por un deploy: el
// cambio queda visible en la página en cuanto la petición responde.
//
// Reemplaza al antiguo flujo de "cifrar -> commit -> push". Se usa para
// reemplazar la colección completa (alta inicial o una limpieza grande);
// para agregar un carrito suelto es más simple hacerlo desde la propia
// página, ya desbloqueada.

import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'

const ITERATIONS = 600_000
const WRITE_TOKEN_INFO = 'garage164-write-token-v1'
const DEFAULT_URL = 'https://www.arnulforeyes.com/garage164/api/vault'

const [sourcePath] = process.argv.slice(2)
const password = process.env.GARAGE164_PASSWORD
const targetUrl = process.env.GARAGE164_VAULT_URL || DEFAULT_URL

if (!sourcePath) {
  console.error('Uso: GARAGE164_PASSWORD=... node garage164/tools/publish-vault.mjs <datos.json>')
  process.exit(1)
}
if (!password || password.length < 14) {
  console.error('Define GARAGE164_PASSWORD con una contraseña de al menos 14 caracteres.')
  process.exit(1)
}

const encoder = new TextEncoder()
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64')
const toHex = (bytes) => Buffer.from(bytes).toString('hex')

async function encryptVault(data) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const material = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)))
  return {
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

// Debe coincidir exactamente con deriveWriteToken() en garage164/app.js:
// misma sal fija, mismas iteraciones, mismo tamaño de salida.
async function deriveWriteToken() {
  const material = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(WRITE_TOKEN_INFO), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  )
  return toHex(new Uint8Array(bits))
}

const data = JSON.parse(await readFile(sourcePath, 'utf8'))

console.log('Cifrando…')
const vault = await encryptVault(data)
const writeToken = await deriveWriteToken()

console.log(`Leyendo el estado actual de ${targetUrl} …`)
const current = await fetch(targetUrl, { cache: 'no-store' })
const etag = current.status === 200 ? current.headers.get('etag') : null

if (current.status !== 200 && current.status !== 404) {
  console.error(`No se pudo leer el estado actual (HTTP ${current.status}).`)
  process.exit(1)
}

console.log(etag ? 'Publicando (reemplaza la versión actual)…' : 'Publicando por primera vez…')
const response = await fetch(targetUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ vault, writeToken, etag }),
})

if (response.status === 403) {
  console.error('Rechazado: la contraseña no coincide con la que autoriza escritura.')
  console.error('Revisa la variable GARAGE164_WRITE_HASH en Netlify, o que estés usando la contraseña correcta.')
  process.exit(1)
}
if (response.status === 409) {
  console.error('Conflicto: alguien más publicó un cambio mientras tanto. Vuelve a ejecutar este comando.')
  process.exit(1)
}
if (!response.ok) {
  console.error(`No se pudo publicar (HTTP ${response.status}).`)
  process.exit(1)
}

console.log('Publicado. El cambio ya es visible en la página, sin necesidad de deploy.')
