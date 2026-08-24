#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'

const [sourcePath, targetPath] = process.argv.slice(2)
const password = process.env.GARAGE164_PASSWORD
const iterations = 600_000

if (!sourcePath || !targetPath) {
  console.error('Uso: GARAGE164_PASSWORD=... node garage164/tools/encrypt-vault.mjs <datos.json> <vault.enc.json>')
  process.exit(1)
}
if (!password || password.length < 14) {
  console.error('Define GARAGE164_PASSWORD con una contraseña de al menos 14 caracteres. No la pongas en el comando ni en un archivo.')
  process.exit(1)
}

const data = JSON.parse(await readFile(sourcePath, 'utf8'))
const encoder = new TextEncoder()
const salt = webcrypto.getRandomValues(new Uint8Array(16))
const iv = webcrypto.getRandomValues(new Uint8Array(12))
const material = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
const key = await webcrypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  material,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
)
const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)))
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64')

await writeFile(targetPath, `${JSON.stringify({
  version: 1,
  kdf: 'PBKDF2-SHA-256',
  iterations,
  salt: toBase64(salt),
  iv: toBase64(iv),
  ciphertext: toBase64(ciphertext),
}, null, 2)}\n`)
console.log(`Archivo cifrado creado: ${targetPath}`)
