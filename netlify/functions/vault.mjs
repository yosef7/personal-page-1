import { getStore } from '@netlify/blobs'

// Garage 164: el vault (colección cifrada) vive en Netlify Blobs para que
// pueda actualizarse sin pasar por un deploy. Esta función NUNCA ve la
// contraseña ni puede descifrar nada: solo entrega y guarda bytes cifrados.
//
// GET  -> devuelve el vault actual y su ETag (para escrituras condicionales)
// PUT  -> guarda un vault nuevo, si el token de escritura es válido
//
//   Primera escritura (la tienda está vacía): se acepta sin ETag previo.
//   Escrituras siguientes: deben incluir el ETag leído en el último GET.
//   Si no coincide, alguien más escribió antes -> 409, hay que recargar.

const STORE_NAME = 'garage164'
const KEY = 'vault'

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function tokenValido(writeToken) {
  const esperado = process.env.GARAGE164_WRITE_HASH
  if (!esperado || !writeToken) return false
  const recibido = await sha256Hex(writeToken)
  return recibido === esperado
}

export default async (req) => {
  const store = getStore(STORE_NAME)

  if (req.method === 'GET') {
    const result = await store.getWithMetadata(KEY, { type: 'json' })
    if (result === null) {
      return Response.json({ error: 'not-configured' }, { status: 404 })
    }
    return Response.json(result.data, { headers: { ETag: result.etag } })
  }

  if (req.method === 'PUT') {
    let body
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'bad-request' }, { status: 400 })
    }

    const { vault, writeToken, etag } = body || {}
    if (!vault || typeof vault !== 'object') {
      return Response.json({ error: 'bad-request' }, { status: 400 })
    }
    if (!(await tokenValido(writeToken))) {
      return Response.json({ error: 'unauthorized' }, { status: 403 })
    }

    const opciones = etag ? { onlyIfMatch: etag } : { onlyIfNew: true }
    const resultado = await store.setJSON(KEY, vault, opciones)

    // En la primerísima escritura a un almacén recién creado se ha visto a
    // setJSON devolver undefined en vez de {modified, etag} (caso límite de
    // aprovisionamiento). Lo tratamos igual que "no modificado": el cliente
    // ya sabe reaccionar a un 409 recargando, en vez de recibir un 502 opaco.
    if (!resultado || !resultado.modified) {
      return Response.json({ error: 'conflict' }, { status: 409 })
    }

    return Response.json({ ok: true, etag: resultado.etag })
  }

  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, PUT' } })
}

export const config = { path: '/garage164/api/vault' }
