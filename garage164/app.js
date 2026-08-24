const ITERATIONS = 600_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const accessShell = document.querySelector('#access-shell')
const garage = document.querySelector('#garage')
const accessForm = document.querySelector('#access-form')
const passwordInput = document.querySelector('#password')
const formMessage = document.querySelector('#form-message')
const submitButton = accessForm.querySelector('button[type="submit"]')

function fromBase64(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function decryptVault(password, vault) {
  if (vault.version !== 1 || vault.kdf !== 'PBKDF2-SHA-256' || vault.iterations !== ITERATIONS) {
    throw new Error('El formato del archivo cifrado no es compatible.')
  }

  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(vault.salt), iterations: vault.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext))
  return JSON.parse(textDecoder.decode(plain))
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

function renderCars(cars, search = '') {
  const grid = document.querySelector('#cars-grid')
  const noResults = document.querySelector('#no-results')
  const term = normalize(search)
  const matches = cars.filter((car) => normalize([car.model, car.brand, car.series, car.color, car.location].join(' ')).includes(term))
  noResults.hidden = matches.length > 0
  grid.replaceChildren(...matches.map((car) => {
    const card = document.createElement('article')
    card.className = 'car-card'
    const tags = [car.series, car.year, car.color, car.package, car.location].filter(Boolean)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    card.innerHTML = `
      <p class="eyebrow">${escapeHtml(car.brand || 'Hot Wheels')}</p>
      <h3>${escapeHtml(car.model)}</h3>
      ${car.notes ? `<p>${escapeHtml(car.notes)}</p>` : ''}
      ${tags ? `<div class="tag-row">${tags}</div>` : ''}
      <div class="quantity">${car.quantity === 1 ? '1 unidad' : `${car.quantity} unidades`}</div>`
    return card
  }))
}

function renderWishlist(items) {
  const section = document.querySelector('#wishlist-section')
  const grid = document.querySelector('#wishlist-grid')
  section.hidden = items.length === 0
  grid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article')
    card.className = 'wish-card'
    const details = [item.series, item.year, item.color, item.where].filter(Boolean).join(' · ')
    card.innerHTML = `
      <p class="eyebrow priority-${escapeHtml(item.priority || 'media')}">Prioridad ${escapeHtml(item.priority || 'media')}</p>
      <h3>${escapeHtml(item.model)}</h3>
      ${details ? `<p>${escapeHtml(details)}</p>` : ''}
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}`
    return card
  }))
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function render(vault) {
  const cars = Array.isArray(vault.cars) ? vault.cars : []
  const wishlist = Array.isArray(vault.wishlist) ? vault.wishlist : []
  const totalsByModel = new Map()
  for (const car of cars) totalsByModel.set(normalize(car.model), (totalsByModel.get(normalize(car.model)) || 0) + Number(car.quantity || 1))
  const totalCars = cars.reduce((total, car) => total + Number(car.quantity || 1), 0)
  const duplicateCars = [...totalsByModel.values()].reduce((total, quantity) => total + Math.max(0, quantity - 1), 0)

  document.querySelector('#collection-name').textContent = vault.collectionName || 'Garage 164'
  document.querySelector('#updated-at').textContent = vault.updatedAt ? `Actualizado el ${formatDate(vault.updatedAt)}` : ''
  stat(totalsByModel.size, '#unique-models')
  stat(totalCars, '#total-cars')
  stat(duplicateCars, '#duplicate-cars')
  stat(wishlist.length, '#wishlist-count')
  renderCars(cars)
  renderWishlist(wishlist)
  document.querySelector('#search').addEventListener('input', (event) => renderCars(cars, event.target.value))
}

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
  try {
    const response = await fetch('vault.enc.json', { cache: 'no-store' })
    if (!response.ok) throw new Error('No se encontró el archivo cifrado. Falta completar la configuración inicial.')
    const vault = await decryptVault(passwordInput.value, await response.json())
    accessForm.reset()
    accessShell.hidden = true
    garage.hidden = false
    render(vault)
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
