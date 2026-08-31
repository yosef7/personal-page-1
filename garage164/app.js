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

function renderCars(cars, search = '') {
  const grid = document.querySelector('#cars-grid')
  const noResults = document.querySelector('#no-results')
  const term = normalize(search)
  const matches = cars.filter((car) => normalize([car.model, car.brand, car.series, car.color, car.location].join(' ')).includes(term))
  noResults.hidden = matches.length > 0
  grid.replaceChildren(...matches.map((car) => {
    const realIndex = cars.indexOf(car)
    const card = document.createElement('article')
    card.className = 'car-card'
    const tags = [car.series, car.year, car.color, car.package, car.location].filter(Boolean)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    card.innerHTML = `
      <p class="eyebrow">${escapeHtml(car.brand || 'Hot Wheels')}</p>
      <h3>${escapeHtml(car.model)}</h3>
      ${car.notes ? `<p>${escapeHtml(car.notes)}</p>` : ''}
      ${tags ? `<div class="tag-row">${tags}</div>` : ''}
      <div class="quantity">${car.quantity === 1 ? '1 unidad' : `${car.quantity} unidades`}</div>
      <div class="card-actions">
        <button class="text-button" type="button" data-edit-car="${realIndex}">Editar</button>
        <button class="text-button" type="button" data-delete-car="${realIndex}">Eliminar</button>
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

function render(data) {
  const cars = Array.isArray(data.cars) ? data.cars : []
  const wishlist = Array.isArray(data.wishlist) ? data.wishlist : []
  const totalsByModel = new Map()
  for (const car of cars) totalsByModel.set(normalize(car.model), (totalsByModel.get(normalize(car.model)) || 0) + Number(car.quantity || 1))
  const totalCars = cars.reduce((total, car) => total + Number(car.quantity || 1), 0)
  const duplicateCars = [...totalsByModel.values()].reduce((total, quantity) => total + Math.max(0, quantity - 1), 0)

  document.querySelector('#collection-name').textContent = data.collectionName || 'Garage 164'
  document.querySelector('#updated-at').textContent = data.updatedAt ? `Actualizado el ${formatDate(data.updatedAt)}` : ''
  stat(totalsByModel.size, '#unique-models')
  stat(totalCars, '#total-cars')
  stat(duplicateCars, '#duplicate-cars')
  stat(wishlist.length, '#wishlist-count')

  const searchValue = document.querySelector('#search').value
  renderCars(cars, searchValue)
  renderWishlist(wishlist)
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

function updateCreateTypeControls(type) {
  document.querySelectorAll('[data-create-type]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.createType === type)
  })
}

function placeForm(type, hostId) {
  const form = document.querySelector(type === 'car' ? '#car-form' : '#wish-form')
  document.querySelector(type === 'car' ? '#wish-form' : '#car-form').hidden = true
  document.querySelector(`#${hostId}`).append(form)
  form.hidden = false
}

function openCreate(type = 'car') {
  editor.mode = 'create'
  editor.type = type
  editor.index = null
  document.querySelector('[data-view-target="edit"]').disabled = true
  if (type === 'car') resetCarForm()
  else resetWishForm()
  placeForm(type, 'create-form-host')
  updateCreateTypeControls(type)
  showView('create')
  document.querySelector(type === 'car' ? '#car-model' : '#wish-model').focus()
}

function openEdit(type, index) {
  editor.mode = 'edit'
  editor.type = type
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
  document.querySelector('#edit-title').textContent = `Editar ${isCar ? 'carrito' : 'pieza deseada'}`
  document.querySelector('#edit-description').textContent = `Actualiza los datos de ${entry.model || 'esta pieza'} y guarda cuando termines.`
  document.querySelector('[data-view-target="edit"]').disabled = false
  placeForm(type, 'edit-form-host')
  showView('edit')
  document.querySelector(isCar ? '#car-model' : '#wish-model').focus()
}

function returnToCollection() {
  document.querySelector('#car-form').hidden = true
  document.querySelector('#wish-form').hidden = true
  editor.index = null
  document.querySelector('[data-view-target="edit"]').disabled = true
  showView('collection')
}

// --- Formularios de alta / edición ------------------------------------------

function val(id) { return document.querySelector(`#${id}`).value.trim() }
function setVal(id, value) { document.querySelector(`#${id}`).value = value ?? '' }

function readCarForm() {
  return {
    model: val('car-model'),
    brand: val('car-brand'),
    series: val('car-series'),
    year: val('car-year'),
    color: val('car-color'),
    package: val('car-package'),
    location: val('car-location'),
    quantity: Number(val('car-quantity')) || 1,
    notes: val('car-notes'),
  }
}

function fillCarForm(car) {
  setVal('car-model', car.model)
  setVal('car-brand', car.brand)
  setVal('car-series', car.series)
  setVal('car-year', car.year)
  setVal('car-color', car.color)
  setVal('car-package', car.package)
  setVal('car-location', car.location)
  setVal('car-quantity', car.quantity ?? 1)
  setVal('car-notes', car.notes)
}

function resetCarForm() {
  document.querySelector('#car-form').reset()
  setVal('car-edit-index', '')
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
  session.data = await decryptVault(session.password, wire)
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
    const data = await decryptVault(password, wire)
    session.password = password
    session.etag = etag
    session.data = data
    session.writeToken = await deriveWriteToken(password)
    accessForm.reset()
    accessShell.hidden = true
    garage.hidden = false
    render(data)
    showView('collection')
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

document.querySelector('#header-create-button').addEventListener('click', () => openCreate())

document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.viewTarget
    if (target === 'create') openCreate(editor.type)
    else if (target === 'collection') returnToCollection()
    else if (target === 'edit' && editor.index !== null) {
      placeForm(editor.type, 'edit-form-host')
      showView('edit')
    }
  })
})

document.querySelectorAll('[data-back-to-collection]').forEach((button) => {
  button.addEventListener('click', returnToCollection)
})

document.querySelectorAll('[data-create-type]').forEach((button) => {
  button.addEventListener('click', () => openCreate(button.dataset.createType))
})

// --- Eventos: búsqueda --------------------------------------------------------

document.querySelector('#search').addEventListener('input', (event) => {
  if (session.data) renderCars(session.data.cars || [], event.target.value)
})

// --- Eventos: formulario de carritos -------------------------------------

document.querySelector('#show-car-form').addEventListener('click', () => {
  openCreate('car')
})

document.querySelector('#car-form-cancel').addEventListener('click', () => {
  resetCarForm()
  returnToCollection()
})

document.querySelector('#car-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const messageEl = document.querySelector('#car-form-message')
  const entry = readCarForm()
  if (!entry.model) {
    messageEl.textContent = 'El modelo es obligatorio.'
    return
  }
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
        returnToCollection()
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

document.querySelector('#show-wish-form').addEventListener('click', () => {
  openCreate('wish')
})

document.querySelector('#wish-form-cancel').addEventListener('click', () => {
  resetWishForm()
  returnToCollection()
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
        returnToCollection()
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
