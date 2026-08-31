const ITERATIONS = 600_000
const WRITE_TOKEN_INFO = 'garage164-write-token-v1'
const VAULT_ENDPOINT = '/garage164/api/vault'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const accessShell = document.querySelector('#access-shell')
const garage = document.querySelector('#garage')
const accessForm = document.querySelector('#access-form')
const passwordInput = document.querySelector('#password')
const formMessage = document.querySelector('#form-message')
const submitButton = accessForm.querySelector('button[type="submit"]')
const syncMessage = document.querySelector('#sync-message')

// Estado en memoria de la sesión desbloqueada. Nada de esto se guarda en
// disco ni sobrevive a un recargo de página: se pierde al cerrar o recargar,
// que es exactamente el punto (ver "Cerrar").
const session = {
  password: null, // en memoria solo mientras dura la sesión, para poder recifrar al editar
  writeToken: null, // credencial de escritura derivada de la contraseña; el servidor solo ve un hash de esto
  etag: null, // versión del vault que tenemos cargada, para escrituras seguras (evita pisar cambios ajenos)
  data: null, // { collectionName, updatedAt, cars, wishlist } ya descifrado
}

const editor = {
  mode: 'create',
  type: 'car',
  index: null,
  returnTo: 'dashboard', // vista a la que regresa el botón "Volver"
}

// Vistas con contenido propio, frente a las de trabajo (registrar / editar).
const CONTENT_VIEWS = ['dashboard', 'collection', 'wishlist']
let currentView = 'dashboard'

// El único botón de alta de la aplicación vive en la barra y anuncia qué va a
// registrar según la sección abierta. En la pantalla de trabajo se esconde:
// ahí ya estás registrando.
const NAV_CREATE = {
  dashboard: { type: 'car', label: 'Registrar carrito' },
  collection: { type: 'car', label: 'Registrar carrito' },
  wishlist: { type: 'wish', label: 'Registrar deseo' },
}

function fromBase64(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function toBase64(bytes) {
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function deriveKey(password, saltBytes, usages) {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

// Token de escritura: derivado de la misma contraseña, pero con una sal fija
// e independiente de la del vault, así que nunca permite reconstruir la
// llave de cifrado. Es lo único que llega al servidor al guardar; el
// servidor solo compara su hash contra GARAGE164_WRITE_HASH y nunca conoce
// la contraseña real.
async function deriveWriteToken(password) {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: textEncoder.encode(WRITE_TOKEN_INFO), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  )
  return toHex(new Uint8Array(bits))
}

async function decryptVault(password, vault) {
  if (vault.version !== 1 || vault.kdf !== 'PBKDF2-SHA-256' || vault.iterations !== ITERATIONS) {
    throw new Error('El formato del archivo cifrado no es compatible.')
  }
  const key = await deriveKey(password, fromBase64(vault.salt), ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext))
  return JSON.parse(textDecoder.decode(plain))
}

// Cifra un objeto de datos nuevo. Genera sal e IV frescos en cada llamada:
// el IV nunca debe reutilizarse con AES-GCM, y una sal nueva no cuesta nada
// (ya tenemos la contraseña en memoria) y evita cualquier duda al respecto.
async function encryptVault(password, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(JSON.stringify(data)))
  return {
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function stat(value, id) { document.querySelector(id).textContent = String(value) }

// --- Formato de los datos ---------------------------------------------------
//
// Cada entrada de cars[] es UNA pieza física, no un modelo: dos ejemplares del
// mismo carrito son dos registros, porque cada uno trae su propio date code y
// puede estar en blister o suelto. Los duplicados salen de contar registros
// que comparten modelo, así que ya no hace falta un campo "cantidad".

const LEGACY_PACKAGES = { sellado: 'blister', abierto: 'blister abierto', suelto: 'suelto' }

// Convierte un registro del formato viejo (un modelo con `quantity`) en tantos
// registros como piezas representaba. Se aplica al descifrar; el vault queda
// convertido en el siguiente guardado.
function adoptCars(cars) {
  const adopted = []
  for (const car of cars) {
    const copies = Math.max(1, Math.floor(Number(car.quantity)) || 1)
    const entry = { ...car }
    const legacy = LEGACY_PACKAGES[normalize(entry.package)]
    if (legacy) entry.package = legacy
    delete entry.quantity
    for (let i = 0; i < copies; i += 1) adopted.push({ ...entry })
  }
  return adopted
}

function adoptData(data) {
  const cars = Array.isArray(data.cars) ? data.cars : []
  return { ...data, cars: adoptCars(cars), wishlist: Array.isArray(data.wishlist) ? data.wishlist : [] }
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-PA', { dateStyle: 'long' }).format(date)
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

// --- Comunicación con la Netlify Function ---------------------------------

async function fetchVault() {
  const response = await fetch(VAULT_ENDPOINT, { cache: 'no-store' })
  if (response.status === 404) {
    throw new Error('No se encontró el archivo cifrado. Falta completar la configuración inicial.')
  }
  if (!response.ok) {
    throw new Error('No fue posible contactar al servidor.')
  }
  const wire = await response.json()
  const etag = response.headers.get('ETag')
  return { wire, etag }
}

// Guarda data (el objeto completo: colección + deseos) recifrándolo con la
// contraseña ya guardada en la sesión. Envía el ETag que teníamos cargado:
// si alguien más guardó un cambio mientras tanto, el servidor rechaza con
// 409 en vez de pisar ese cambio silenciosamente.
async function saveVault(data) {
  const wire = await encryptVault(session.password, data)
  const response = await fetch(VAULT_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vault: wire, writeToken: session.writeToken, etag: session.etag }),
  })

  if (response.status === 409) {
    throw new Error('conflict')
  }
  if (response.status === 403) {
    throw new Error('unauthorized')
  }
  if (!response.ok) {
    throw new Error('save-failed')
  }

  const result = await response.json()
  session.etag = result.etag
  session.data = data
}

// --- Renderizado -----------------------------------------------------------

// Texto sobre el que busca el filtro. Incluye los códigos del blister porque
// buscar "C4982" o el toy number es justo como se localiza una pieza cuando ya
// hay muchas del mismo modelo.
function searchableText(car) {
  return normalize([
    car.model, car.brand, car.series, car.year, car.color, car.location, car.country,
    car.lineNumber, car.subseriesNumber, car.toyNumber, car.dateCode, car.assortment, car.gtin, car.notes,
  ].filter(Boolean).join(' '))
}

// Numera las piezas repetidas: "pieza 2 de 3". Se calcula sobre la colección
// completa, no sobre el resultado filtrado, para que el número no cambie según
// lo que esté escrito en el buscador.
function copyLabels(cars) {
  const totals = new Map()
  for (const car of cars) {
    const key = normalize(car.model)
    totals.set(key, (totals.get(key) || 0) + 1)
  }
  const seen = new Map()
  return cars.map((car) => {
    const key = normalize(car.model)
    const total = totals.get(key)
    if (total < 2) return ''
    const position = (seen.get(key) || 0) + 1
    seen.set(key, position)
    return `Pieza ${position} de ${total}`
  })
}

function renderCars(cars, search = '') {
  const grid = document.querySelector('#cars-grid')
  const noResults = document.querySelector('#no-results')
  const term = normalize(search)
  const labels = copyLabels(cars)
  const matches = cars.map((car, index) => ({ car, index })).filter(({ car }) => searchableText(car).includes(term))
  noResults.hidden = matches.length > 0
  grid.replaceChildren(...matches.map(({ car, index }) => {
    const card = document.createElement('article')
    card.className = 'car-card'
    const numbering = [car.lineNumber, car.subseriesNumber].filter(Boolean).join(' · ')
    const codes = [car.toyNumber, car.dateCode, car.assortment, car.gtin].filter(Boolean).join(' · ')
    const tags = [car.series, car.year, car.color, car.package, car.location, car.country].filter(Boolean)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    card.innerHTML = `
      <p class="eyebrow">${escapeHtml(car.brand || 'Hot Wheels')}</p>
      <h3>${escapeHtml(car.model)}</h3>
      ${numbering ? `<p class="card-numbering">${escapeHtml(numbering)}</p>` : ''}
      ${car.notes ? `<p>${escapeHtml(car.notes)}</p>` : ''}
      ${tags ? `<div class="tag-row">${tags}</div>` : ''}
      ${codes ? `<p class="card-codes">${escapeHtml(codes)}</p>` : ''}
      ${labels[index] ? `<div class="quantity">${labels[index]}</div>` : ''}
      ${car.addedAt ? `<p class="card-meta">Registrada el ${escapeHtml(formatDate(car.addedAt))}</p>` : ''}
      <div class="card-actions">
        <button class="text-button" type="button" data-edit-car="${index}">Editar</button>
        <button class="text-button" type="button" data-delete-car="${index}">Eliminar</button>
      </div>`
    return card
  }))
}

function renderWishlist(items) {
  const grid = document.querySelector('#wishlist-grid')
  const empty = document.querySelector('#no-wishlist')
  empty.hidden = items.length > 0
  grid.replaceChildren(...items.map((item) => {
    const realIndex = items.indexOf(item)
    const card = document.createElement('article')
    card.className = 'wish-card'
    const details = [item.series, item.year, item.color, item.where].filter(Boolean).join(' · ')
    card.innerHTML = `
      <p class="eyebrow priority-${escapeHtml(item.priority || 'media')}">Prioridad ${escapeHtml(item.priority || 'media')}</p>
      <h3>${escapeHtml(item.model)}</h3>
      ${details ? `<p>${escapeHtml(details)}</p>` : ''}
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}
      <div class="card-actions">
        <button class="text-button" type="button" data-edit-wish="${realIndex}">Editar</button>
        <button class="text-button" type="button" data-delete-wish="${realIndex}">Eliminar</button>
      </div>`
    return card
  }))
}

// Agrupa por un campo y devuelve pares [etiqueta, conteo] de mayor a menor.
// `fallback` nombra a las piezas que no traen ese dato, en vez de esconderlas:
// saber cuántas están sin clasificar es justamente parte del resumen.
function groupBy(cars, field, fallback) {
  const counts = new Map()
  for (const car of cars) {
    const label = String(car[field] ?? '').trim() || fallback
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function renderBars(id, rows, emptyId) {
  const list = document.querySelector(id)
  const max = rows.reduce((top, [, count]) => Math.max(top, count), 0)
  list.replaceChildren(...rows.map(([label, count]) => {
    const item = document.createElement('li')
    item.innerHTML = `
      <span class="bar-label">${escapeHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width: ${Math.round((count / max) * 100)}%"></span></span>
      <span class="bar-value">${count}</span>`
    return item
  }))
  if (emptyId) document.querySelector(emptyId).hidden = rows.length > 0
}

// Datos del blister que conviene tener y suelen quedar pendientes cuando se
// registra una pieza a las apuradas.
const COMPLETABLE = [
  ['toyNumber', 'Sin toy number'],
  ['dateCode', 'Sin date code'],
  ['lineNumber', 'Sin número de línea'],
  ['assortment', 'Sin assortment'],
  ['gtin', 'Sin GTIN'],
]

function renderDashboard(cars, modelCounts) {
  document.querySelector('#dashboard-empty').hidden = cars.length > 0
  document.querySelector('#dashboard-panels').hidden = cars.length === 0
  if (!cars.length) return

  // Últimas registradas: por fecha, y a igualdad de fecha (o sin fecha) manda
  // el orden de captura, que es el más reciente al final del arreglo.
  const recent = cars.map((car, index) => ({ car, index }))
    .sort((a, b) => String(b.car.addedAt || '').localeCompare(String(a.car.addedAt || '')) || b.index - a.index)
    .slice(0, 5)
  document.querySelector('#recent-list').replaceChildren(...recent.map(({ car }) => {
    const item = document.createElement('li')
    const detail = [car.series, car.toyNumber, car.package].filter(Boolean).join(' · ')
    item.innerHTML = `
      <strong>${escapeHtml(car.model)}</strong>
      ${detail ? `<span class="panel-detail">${escapeHtml(detail)}</span>` : ''}
      ${car.addedAt ? `<span class="panel-date">${escapeHtml(formatDate(car.addedAt))}</span>` : ''}`
    return item
  }))

  renderBars('#series-breakdown', groupBy(cars, 'series', 'Sin serie').slice(0, 6))
  renderBars('#package-breakdown', groupBy(cars, 'package', 'Sin especificar'))

  const repeated = [...modelCounts.entries()].filter(([, entry]) => entry.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
  document.querySelector('#duplicates-empty').hidden = repeated.length > 0
  document.querySelector('#duplicates-list').replaceChildren(...repeated.map(([, entry]) => {
    const item = document.createElement('li')
    item.innerHTML = `<strong>${escapeHtml(entry.model)}</strong><span class="panel-date">${entry.count} piezas</span>`
    return item
  }))

  const pending = COMPLETABLE
    .map(([field, label]) => [label, cars.filter((car) => !String(car[field] ?? '').trim()).length])
    .filter(([, count]) => count > 0)
  renderBars('#incomplete-breakdown', pending, '#incomplete-empty')
}

function render(data) {
  const cars = Array.isArray(data.cars) ? data.cars : []
  const wishlist = Array.isArray(data.wishlist) ? data.wishlist : []
  // Un modelo por nombre normalizado, guardando el nombre tal como se escribió
  // la primera vez para poder mostrarlo en el dashboard.
  const totalsByModel = new Map()
  for (const car of cars) {
    const key = normalize(car.model)
    const entry = totalsByModel.get(key) || { model: car.model, count: 0 }
    entry.count += 1
    totalsByModel.set(key, entry)
  }
  const totalCars = cars.length
  const duplicateCars = [...totalsByModel.values()].reduce((total, { count }) => total + Math.max(0, count - 1), 0)

  document.querySelector('#collection-name').textContent = data.collectionName || 'Garage 164'
  document.querySelector('#updated-at').textContent = data.updatedAt ? `Actualizado el ${formatDate(data.updatedAt)}` : ''
  stat(totalsByModel.size, '#unique-models')
  stat(totalCars, '#total-cars')
  stat(duplicateCars, '#duplicate-cars')
  stat(wishlist.length, '#wishlist-count')

  document.querySelector('#collection-note').textContent = totalCars
    ? `${totalCars} ${totalCars === 1 ? 'pieza' : 'piezas'} de ${totalsByModel.size} ${totalsByModel.size === 1 ? 'modelo' : 'modelos'}.`
    : 'La colección está vacía.'
  document.querySelector('#wishlist-note').textContent = wishlist.length
    ? `${wishlist.length} ${wishlist.length === 1 ? 'pieza' : 'piezas'} por conseguir.`
    : ''

  const searchValue = document.querySelector('#search').value
  renderCars(cars, searchValue)
  renderWishlist(wishlist)
  renderDashboard(cars, totalsByModel)
}

function showSyncMessage(text, isError = false) {
  syncMessage.textContent = text
  syncMessage.hidden = !text
  syncMessage.style.color = isError ? '#ffad98' : 'var(--muted)'
}

// La colección, el registro y la edición son espacios de trabajo distintos.
// Se mantienen dentro de la misma sesión para no guardar la contraseña ni la
// llave de cifrado en el navegador entre páginas.
function showView(view) {
  currentView = view
  const create = NAV_CREATE[view]
  const createButton = document.querySelector('#nav-create')
  createButton.hidden = !create
  if (create) {
    createButton.dataset.new = create.type
    createButton.textContent = create.label
  }
  document.querySelectorAll('.app-view').forEach((element) => {
    element.hidden = element.dataset.view !== view
  })
  document.querySelectorAll('[data-view-target]').forEach((button) => {
    const active = button.dataset.viewTarget === view
    button.classList.toggle('is-active', active)
    if (active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
}

// Coloca el formulario que toca en la pantalla de trabajo y esconde el otro:
// solo uno de los dos está montado a la vez.
function placeForm(type) {
  const form = document.querySelector(type === 'car' ? '#car-form' : '#wish-form')
  document.querySelector(type === 'car' ? '#wish-form' : '#car-form').hidden = true
  document.querySelector('#form-host').append(form)
  form.hidden = false
}

function setWorkspaceTitle(eyebrow, title, description) {
  document.querySelector('#workspace-eyebrow').textContent = eyebrow
  document.querySelector('#workspace-title').textContent = title
  document.querySelector('#workspace-description').textContent = description
}

function openWorkspace(type) {
  if (CONTENT_VIEWS.includes(currentView)) editor.returnTo = currentView
  editor.type = type
  placeForm(type)
  showView('workspace')
  document.querySelector(type === 'car' ? '#car-model' : '#wish-model').focus()
}

// El tipo de ficha lo decide la sección desde la que se entra, no un selector
// dentro del formulario.
function openCreate(type = 'car') {
  editor.mode = 'create'
  editor.index = null
  if (type === 'car') {
    resetCarForm()
    setWorkspaceTitle('Nuevo registro', 'Registrar carrito', 'Cada ficha es una pieza física. Solo el modelo es obligatorio.')
  } else {
    resetWishForm()
    setWorkspaceTitle('Nuevo registro', 'Registrar pieza por conseguir', 'Anota lo que estás buscando. Solo el modelo es obligatorio.')
  }
  openWorkspace(type)
}

function openEdit(type, index) {
  editor.mode = 'edit'
  editor.index = index
  const isCar = type === 'car'
  const entry = isCar ? session.data.cars[index] : session.data.wishlist[index]
  if (isCar) {
    fillCarForm(entry)
    setVal('car-edit-index', String(index))
    document.querySelector('#car-form-submit').textContent = 'Guardar cambios'
  } else {
    fillWishForm(entry)
    setVal('wish-edit-index', String(index))
    document.querySelector('#wish-form-submit').textContent = 'Guardar cambios'
  }
  setWorkspaceTitle(
    'Actualización',
    `Editar ${isCar ? 'carrito' : 'pieza por conseguir'}`,
    `Actualiza los datos de ${entry.model || 'esta pieza'} y guarda cuando termines.`,
  )
  openWorkspace(type)
}

function closeWorkspace(view) {
  document.querySelector('#car-form').hidden = true
  document.querySelector('#wish-form').hidden = true
  editor.index = null
  showView(view || editor.returnTo || 'dashboard')
}

// --- Catálogos de los campos con lista --------------------------------------

// Los campos con lista ahorran tecleo en el caso normal, pero una pieza rara
// siempre se puede anotar a mano con "Otro…", y un registro viejo nunca se
// queda sin su valor al editarlo.

const ANIO_INICIAL = 1968 // primer año de Hot Wheels

// Totales habituales de una línea. El total manda: al elegirlo, la lista del
// número se regenera de 1 a ese total.
const LINE_TOTALS = [250, 365, 100, 50, 20, 10, 5]
const LINE_TOTAL_POR_DEFECTO = 250

// Plantas donde se fabrican (y se fabricaron) los carritos, la más frecuente
// primero: es la que se escribe casi siempre.
const COUNTRIES = [
  'Malasia', 'Tailandia', 'Indonesia', 'China', 'India', 'Vietnam', 'Filipinas',
  'Hong Kong', 'Estados Unidos', 'México', 'Brasil', 'Francia', 'Venezuela',
  'Nueva Zelanda', 'Corea del Sur', 'Taiwán', 'España',
]
const COUNTRY_POR_DEFECTO = 'Malasia'

// Dónde está físicamente la pieza. La colección vive en Panamá.
const LOCATIONS = ['Panamá', 'Estados Unidos', 'Colombia', 'Costa Rica', 'México', 'España']
const LOCATION_POR_DEFECTO = 'Panamá'

const COLORS = [
  'Rojo', 'Azul', 'Celeste', 'Verde', 'Amarillo', 'Naranja', 'Negro', 'Blanco',
  'Gris', 'Plata', 'Dorado', 'Cobre', 'Morado', 'Rosa', 'Café', 'Beige',
  'Turquesa', 'Vino', 'Cromado', 'Transparente', 'Multicolor',
]

function currentYear() { return new Date().getFullYear() }

// Del año en curso hacia atrás: lo que se registra casi siempre es reciente.
function yearOptions() {
  const años = []
  for (let año = currentYear(); año >= ANIO_INICIAL; año -= 1) años.push(año)
  return años
}

function rangeOptions(total) {
  const numeros = []
  for (let n = 1; n <= total; n += 1) numeros.push(n)
  return numeros
}

// Los campos con lista son <select> como el de Empaque, más una opción
// "Otro…" al final: al elegirla aparece un campo de texto debajo. Así se
// llenan de un clic en el caso normal, sin quedarse sin sitio donde anotar
// una pieza fuera de catálogo (ni perder el valor de un registro viejo).
const OTRO = '__otro__'

const CAMPOS_CON_LISTA = [
  'car-year', 'car-line-number-value', 'car-line-number-total',
  'car-color', 'car-country', 'car-location',
]

// Rellena el select conservando lo que estuviera elegido, para que refrescar
// la lista del número al cambiar el total no borre el número ya puesto.
function setOptions(id, values, vacio = 'Sin especificar') {
  const select = document.querySelector(`#${id}`)
  const previo = select.value
  const opciones = [
    nuevaOpcion('', vacio),
    ...values.map((value) => nuevaOpcion(String(value), String(value))),
    nuevaOpcion(OTRO, 'Otro…'),
  ]
  select.replaceChildren(...opciones)
  select.value = [...select.options].some((o) => o.value === previo) ? previo : ''
}

function nuevaOpcion(value, texto) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = texto
  return option
}

function buildListFields() {
  setOptions('car-year', yearOptions(), 'Sin año')
  setOptions('car-line-number-total', LINE_TOTALS, 'Sin total')
  setOptions('car-line-number-value', rangeOptions(LINE_TOTAL_POR_DEFECTO), 'Sin número')
  setOptions('car-country', COUNTRIES, 'Sin especificar')
  setOptions('car-location', LOCATIONS, 'Sin especificar')
  setOptions('car-color', COLORS, 'Sin especificar')
  CAMPOS_CON_LISTA.forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('change', () => {
      mostrarCampoOtro(id, { enfocar: true })
      if (id === 'car-line-number-total') syncLineValues()
    })
  })
}

// Enseña u oculta el campo de texto de "Otro…" según lo elegido en el select.
function mostrarCampoOtro(id, { enfocar = false } = {}) {
  const select = document.querySelector(`#${id}`)
  const otro = document.querySelector(`#${id}-other`)
  const activo = select.value === OTRO
  otro.hidden = !activo
  if (!activo) otro.value = ''
  else if (enfocar) otro.focus()
}

// Valor real del campo: el del select, o lo escrito a mano si está en "Otro…".
function listVal(id) {
  const select = document.querySelector(`#${id}`)
  return select.value === OTRO ? val(`${id}-other`) : select.value
}

// Coloca un valor guardado: si está en la lista se elige; si no (un país raro,
// un registro viejo), cae en "Otro…" con el texto intacto.
function setListVal(id, value) {
  const select = document.querySelector(`#${id}`)
  const texto = value == null ? '' : String(value).trim()
  const enLista = [...select.options].some((o) => o.value === texto && o.value !== OTRO)
  if (texto && !enLista) {
    select.value = OTRO
    setVal(`${id}-other`, texto)
  } else {
    select.value = texto
    setVal(`${id}-other`, '')
  }
  mostrarCampoOtro(id)
}

// El N.º de línea se guarda como siempre ("64/250"): la partición en dos
// campos es solo de la pantalla, el dato en el vault no cambia de forma.
function readLineNumber() {
  const numero = listVal('car-line-number-value')
  const total = listVal('car-line-number-total')
  if (!numero) return ''
  return total ? `${numero}/${total}` : numero
}

function setLineNumber(lineNumber) {
  const [numero = '', total = ''] = String(lineNumber ?? '').split('/')
  setListVal('car-line-number-total', total.trim())
  syncLineValues()
  setListVal('car-line-number-value', numero.trim())
}

// Ajusta la lista del número al total elegido, para no ofrecer un 300 en una
// línea de 250. Un total escrito a mano fuera de rango deja la lista como está.
function syncLineValues() {
  const total = Number(listVal('car-line-number-total'))
  if (Number.isInteger(total) && total > 0 && total <= 999) {
    setOptions('car-line-number-value', rangeOptions(total), 'Sin número')
  }
}

// --- Formularios de alta / edición ------------------------------------------

function val(id) { return document.querySelector(`#${id}`).value.trim() }
function setVal(id, value) { document.querySelector(`#${id}`).value = value ?? '' }

// Los códigos del blister se guardan en mayúsculas y sin espacios sobrantes
// para que dos registros del mismo assortment se vean —y se busquen— igual.
function code(id) { return val(id).toUpperCase().replace(/\s+/g, '') }

function readCarForm() {
  return {
    model: val('car-model'),
    brand: val('car-brand'),
    series: val('car-series'),
    year: listVal('car-year'),
    lineNumber: readLineNumber(),
    subseriesNumber: val('car-subseries-number'),
    toyNumber: code('car-toy-number'),
    dateCode: code('car-date-code'),
    assortment: code('car-assortment'),
    gtin: val('car-gtin').replace(/[\s-]/g, ''),
    color: listVal('car-color'),
    country: listVal('car-country'),
    package: val('car-package'),
    location: listVal('car-location'),
    addedAt: val('car-added-at'),
    notes: val('car-notes'),
  }
}

function fillCarForm(car) {
  setVal('car-model', car.model)
  setVal('car-brand', car.brand)
  setVal('car-series', car.series)
  setListVal('car-year', car.year)
  setLineNumber(car.lineNumber)
  setVal('car-subseries-number', car.subseriesNumber)
  setVal('car-toy-number', car.toyNumber)
  setVal('car-date-code', car.dateCode)
  setVal('car-assortment', car.assortment)
  setVal('car-gtin', car.gtin)
  setListVal('car-color', car.color)
  setListVal('car-country', car.country)
  setVal('car-package', car.package)
  setListVal('car-location', car.location)
  setVal('car-added-at', car.addedAt)
  setVal('car-notes', car.notes)
}

function resetCarForm() {
  document.querySelector('#car-form').reset()
  setVal('car-edit-index', '')
  setVal('car-added-at', todayISO())
  // Lo que casi siempre es cierto viene escrito; se sobrescribe si toca.
  setListVal('car-year', currentYear())
  setListVal('car-line-number-total', LINE_TOTAL_POR_DEFECTO)
  syncLineValues()
  setListVal('car-line-number-value', '')
  setListVal('car-color', '')
  setListVal('car-country', COUNTRY_POR_DEFECTO)
  setListVal('car-location', LOCATION_POR_DEFECTO)
  document.querySelector('#car-form-submit').textContent = 'Registrar carrito'
  document.querySelector('#car-form-message').textContent = ''
}

function readWishForm() {
  return {
    model: val('wish-model'),
    series: val('wish-series'),
    year: val('wish-year'),
    color: val('wish-color'),
    priority: val('wish-priority') || 'media',
    where: val('wish-where'),
    notes: val('wish-notes'),
  }
}

function fillWishForm(item) {
  setVal('wish-model', item.model)
  setVal('wish-series', item.series)
  setVal('wish-year', item.year)
  setVal('wish-color', item.color)
  setVal('wish-priority', item.priority || 'media')
  setVal('wish-where', item.where)
  setVal('wish-notes', item.notes)
}

function resetWishForm() {
  document.querySelector('#wish-form').reset()
  setVal('wish-edit-index', '')
  document.querySelector('#wish-form-submit').textContent = 'Registrar deseo'
  document.querySelector('#wish-form-message').textContent = ''
}

async function persistChange(mutate, { formEl, messageEl, onSuccess }) {
  const data = { ...session.data }
  mutate(data)
  const submit = formEl ? formEl.querySelector('button[type="submit"], .primary-button') : null
  if (submit) submit.disabled = true
  showSyncMessage('Guardando…')
  try {
    data.updatedAt = todayISO()
    await saveVault(data)
    render(session.data)
    if (onSuccess) onSuccess()
    showSyncMessage('Guardado.')
  } catch (error) {
    if (error.message === 'conflict') {
      showSyncMessage('Alguien más actualizó la colección. Recargando la última versión…', true)
      await reloadVault()
    } else {
      const text = error.message === 'unauthorized'
        ? 'No fue posible guardar: credencial de escritura no válida.'
        : 'No fue posible guardar. Intenta de nuevo.'
      showSyncMessage(text, true)
      if (messageEl) messageEl.textContent = text
    }
  } finally {
    if (submit) submit.disabled = false
  }
}

async function reloadVault() {
  const { wire, etag } = await fetchVault()
  session.etag = etag
  session.data = adoptData(await decryptVault(session.password, wire))
  render(session.data)
}

// --- Eventos: acceso ---------------------------------------------------------

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const isPassword = passwordInput.type === 'password'
  passwordInput.type = isPassword ? 'text' : 'password'
  event.currentTarget.textContent = isPassword ? 'Ocultar' : 'Mostrar'
})

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  formMessage.textContent = ''
  submitButton.disabled = true
  submitButton.textContent = 'Abriendo…'
  const password = passwordInput.value
  try {
    const { wire, etag } = await fetchVault()
    const stored = await decryptVault(password, wire)
    const data = adoptData(stored)
    session.password = password
    session.etag = etag
    session.data = data
    session.writeToken = await deriveWriteToken(password)
    accessForm.reset()
    accessShell.hidden = true
    garage.hidden = false
    render(data)
    showView('dashboard')
    const separated = data.cars.length - (Array.isArray(stored.cars) ? stored.cars.length : 0)
    if (separated > 0) {
      showSyncMessage(`Se separaron ${separated} piezas repetidas en registros propios, para que cada una lleve su date code. El cambio se guarda con tu próxima edición.`)
    }
  } catch (error) {
    formMessage.textContent = error.message.includes('operation') || error.name === 'OperationError'
      ? 'La contraseña no es correcta.'
      : error.message || 'No fue posible abrir la colección.'
  } finally {
    submitButton.disabled = false
    submitButton.textContent = 'Abrir colección'
  }
})

document.querySelector('#lock-button').addEventListener('click', () => window.location.reload())

document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => closeWorkspace(button.dataset.viewTarget))
})

document.querySelectorAll('[data-back]').forEach((button) => {
  button.addEventListener('click', () => closeWorkspace())
})

// Cada sección abre su propio tipo de ficha: Colección un carrito, Lista de
// deseos una pieza por conseguir.
document.querySelectorAll('[data-new]').forEach((button) => {
  button.addEventListener('click', () => openCreate(button.dataset.new))
})

// --- Eventos: búsqueda --------------------------------------------------------

document.querySelector('#search').addEventListener('input', (event) => {
  if (session.data) renderCars(session.data.cars || [], event.target.value)
})

// --- Eventos: formulario de carritos -------------------------------------

document.querySelector('#car-form-cancel').addEventListener('click', () => {
  resetCarForm()
  closeWorkspace()
})

document.querySelector('#car-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const messageEl = document.querySelector('#car-form-message')
  const entry = readCarForm()
  if (!entry.model) {
    messageEl.textContent = 'El modelo es obligatorio.'
    return
  }
  // El GTIN solo sirve si está exacto: un código a medias no localiza nada.
  if (entry.gtin && !/^(\d{8}|\d{12,14})$/.test(entry.gtin)) {
    messageEl.textContent = 'El GTIN debe tener 8, 12, 13 o 14 dígitos. Déjalo vacío si no lo tienes a mano.'
    return
  }
  messageEl.textContent = ''
  const editIndex = val('car-edit-index')
  await persistChange(
    (data) => {
      data.cars = Array.isArray(data.cars) ? [...data.cars] : []
      if (editIndex === '') data.cars.push(entry)
      else data.cars[Number(editIndex)] = entry
    },
    {
      formEl: document.querySelector('#car-form'),
      messageEl,
      onSuccess: () => {
        resetCarForm()
        closeWorkspace('collection')
      },
    },
  )
})

document.querySelector('#cars-grid').addEventListener('click', async (event) => {
  const editBtn = event.target.closest('[data-edit-car]')
  const deleteBtn = event.target.closest('[data-delete-car]')
  if (editBtn) {
    const index = Number(editBtn.dataset.editCar)
    openEdit('car', index)
  }
  if (deleteBtn) {
    const index = Number(deleteBtn.dataset.deleteCar)
    const car = session.data.cars[index]
    if (!window.confirm(`¿Eliminar "${car.model}" de la colección?`)) return
    await persistChange(
      (data) => { data.cars = data.cars.filter((_, i) => i !== index) },
      { messageEl: null },
    )
  }
})

// --- Eventos: formulario de deseos -----------------------------------------

document.querySelector('#wish-form-cancel').addEventListener('click', () => {
  resetWishForm()
  closeWorkspace()
})

document.querySelector('#wish-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const messageEl = document.querySelector('#wish-form-message')
  const entry = readWishForm()
  if (!entry.model) {
    messageEl.textContent = 'El modelo es obligatorio.'
    return
  }
  const editIndex = val('wish-edit-index')
  await persistChange(
    (data) => {
      data.wishlist = Array.isArray(data.wishlist) ? [...data.wishlist] : []
      if (editIndex === '') data.wishlist.push(entry)
      else data.wishlist[Number(editIndex)] = entry
    },
    {
      formEl: document.querySelector('#wish-form'),
      messageEl,
      onSuccess: () => {
        resetWishForm()
        closeWorkspace('wishlist')
      },
    },
  )
})

document.querySelector('#wishlist-grid').addEventListener('click', async (event) => {
  const editBtn = event.target.closest('[data-edit-wish]')
  const deleteBtn = event.target.closest('[data-delete-wish]')
  if (editBtn) {
    const index = Number(editBtn.dataset.editWish)
    openEdit('wish', index)
  }
  if (deleteBtn) {
    const index = Number(deleteBtn.dataset.deleteWish)
    const item = session.data.wishlist[index]
    if (!window.confirm(`¿Eliminar "${item.model}" de la lista de deseos?`)) return
    await persistChange(
      (data) => { data.wishlist = data.wishlist.filter((_, i) => i !== index) },
      { messageEl: null },
    )
  }
})

// --- Arranque ----------------------------------------------------------------

buildListFields()
