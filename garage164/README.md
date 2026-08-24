# Garage 164 — colección privada, editable en vivo

Catálogo privado de la colección de carritos, publicado en `/garage164/` dentro del sitio estático. No hay enlaces hacia esta ruta desde ninguna página pública.

Los datos se guardan **cifrados**. Quien abra la dirección solo ve una pantalla que pide contraseña; el contenido real se descifra dentro del navegador y nunca viaja en claro ni queda guardado sin cifrar en ningún servidor. Se puede agregar, editar o eliminar carritos y piezas de la lista de deseos directamente desde la página — el cambio queda visible al instante para quien la abra después, sin pasar por `git push` ni esperar un deploy.

---

## 1. Cómo funciona, en palabras simples

El sitio en general es estático (HTML/CSS/JS servidos tal cual). Garage 164 es la excepción: tiene una pequeña pieza de servidor —una **Netlify Function**— que guarda el archivo cifrado en un almacén llamado **Netlify Blobs**. Esa pieza nunca ve la contraseña ni puede leer la colección: solo entrega y guarda bytes cifrados, igual que antes hacía un archivo estático.

```
  Navegador                    Netlify Function              Netlify Blobs
  ─────────                    ────────────────              ─────────────
  contraseña ──► descifra ◄──── GET  /garage164/api/vault ◄────  vault cifrado
                                                                  (ilegible para
  editas, agregas,                                                Netlify)
  cifras de nuevo ──────────► PUT  /garage164/api/vault ─────►
                               (solo si el token de escritura
                                es válido)
```

1. **Abres la página** e ingresas la contraseña compartida. El navegador pide el vault a la Function, lo descifra en memoria y muestra la colección.
2. **Agregas o editas** un carrito desde la propia página. El navegador arma la colección actualizada, la cifra de nuevo (con una sal e IV nuevos) y se la manda a la Function.
3. **La Function verifica** que quien escribe conoce la contraseña —sin necesitar saberla ella misma— y guarda el resultado en Blobs.
4. **Cualquiera que abra la página después** ve el cambio de inmediato, porque ya no lee un archivo fijo: le pregunta a la Function en cada carga.

La contraseña nunca se envía a ningún servidor. Lo único que sale del navegador al guardar es un **token de escritura** derivado de ella —explicado en la [sección 8](#8-qué-protege-esto-y-qué-no)— que sirve para autorizar, no para descifrar.

**Detalle técnico**, para quien lo quiera: la contraseña pasa por PBKDF2-SHA-256 con 600 000 iteraciones para derivar la llave de cifrado, y el contenido se cifra con AES-256-GCM. Cada guardado genera una sal y un IV nuevos y aleatorios.

## 2. Qué hay en esta carpeta

| Archivo | ¿Se publica? | Para qué sirve |
| --- | --- | --- |
| `index.html` | Sí | La página: acceso, catálogo, formularios de alta/edición |
| `styles.css` | Sí | Estilos (tema oscuro) |
| `app.js` | Sí | Descifra, cifra y llama a la Function desde el navegador |
| `data.example.json` | Sí | Plantilla de ejemplo, con datos inventados |
| `data.json` | **No, nunca** | Tu colección en texto legible. Está en `.gitignore` |
| `tools/publish-vault.mjs` | Sí | Cifra `data.json` y lo publica de un golpe (reemplaza toda la colección) |
| `tools/publicar.sh` | Sí | Envoltorio de lo anterior: valida, resume y confirma antes de publicar |
| `tools/generar-hash-escritura.sh` | Sí | Calcula el valor que se configura una vez en Netlify para autorizar escrituras |
| `tools/probar-clave.sh` | Sí | Diagnostica si una contraseña abre la colección publicada |
| `../netlify/functions/vault.mjs` | Sí | La Function: entrega y guarda el vault en Netlify Blobs |

Ya no hay un archivo `vault.enc.json` en el repositorio — la colección vive en Netlify Blobs, no en git. La regla que evita accidentes sigue siendo una sola: **`data.json` se queda en tu computadora; lo que sale de aquí siempre pasa por el cifrado primero.**

## 3. Requisitos

- **Node.js** — para cifrar y publicar desde la terminal.
- **Python 3** — para levantar el servidor local de prueba (viene con macOS).
- Acceso al panel de Netlify del sitio (`app.netlify.com`) — para configurar la variable de entorno una sola vez.
- Una contraseña compartida de **14 caracteres como mínimo**.

## 4. Configuración inicial, paso a paso

> Estos comandos se ejecutan desde la **raíz del repositorio**.

### Paso 1 — Elige la contraseña y autoriza la escritura

Este paso se hace **una sola vez** (o cada vez que cambien la contraseña). Calcula el valor que autoriza a esa contraseña a guardar cambios:

```zsh
./garage164/tools/generar-hash-escritura.sh
```

Te va a pedir la contraseña y te va a imprimir un valor largo en hexadecimal. Ve al panel de Netlify del sitio:

**Site settings → Environment variables → Add a variable**

- Key: `GARAGE164_WRITE_HASH`
- Value: el valor que imprimió el script

Guarda, y dispara un nuevo deploy (**Deploys → Trigger deploy**) para que la Function la vea — las variables de entorno nuevas no llegan a una función ya desplegada hasta el siguiente deploy.

Guarda también la contraseña en tu gestor de contraseñas ahora, antes de seguir.

### Paso 2 — Crea tu archivo de datos

```zsh
cp garage164/data.example.json garage164/data.json
```

Abre `garage164/data.json` y reemplaza el contenido de ejemplo por tu colección real. El formato de cada campo está en la [sección 7](#7-formato-de-los-datos).

### Paso 3 — Publica por primera vez

```zsh
./garage164/tools/publicar.sh
```

Pide la contraseña (dos veces, para evitar erratas), cifra `data.json` y lo publica directo en la colección en vivo — sin `git push`. Como es la primera vez, no hay nada que sobrescribir.

### Paso 4 — Verifica

Abre <https://www.arnulforeyes.com/garage164/>, ingresa la contraseña y confirma que tu colección aparece.

## 5. Cómo se usa la página

1. Entra a la dirección y escribe la contraseña compartida. El botón **Mostrar** permite verla mientras la escribes.
2. Arriba aparece un resumen: **modelos**, **carritos**, **duplicados** y **por conseguir**.
3. El buscador filtra por modelo, marca, serie, color o ubicación, ignorando acentos y mayúsculas.
4. **+ Agregar carrito** abre un formulario para sumar una pieza nueva a la colección. Solo el modelo es obligatorio.
5. **+ Agregar a la lista de deseos** hace lo mismo para algo que todavía no tienes.
6. Cada tarjeta tiene **Editar** (carga sus datos en el formulario para corregirlos) y **Eliminar** (pide confirmación antes de quitarla).
7. Cualquier alta, edición o borrado se guarda al instante — no hace falta ningún paso adicional, y el cambio ya es visible para quien abra la página después, incluso desde otro teléfono.
8. **Cerrar** recarga la página y vuelve a la pantalla de contraseña. Úsalo si prestas el teléfono o dejas la computadora abierta — la contraseña solo vive en la memoria de esa pestaña mientras está abierta.

## 6. Cuándo usar el formulario y cuándo `publicar.sh`

| Situación | Qué usar |
| --- | --- |
| Compraste un carrito, quieres agregarlo ya | El formulario **+ Agregar carrito**, en la página |
| Corregir un dato de una pieza | **Editar** en su tarjeta |
| Ya no la tienes / te equivocaste al cargarla | **Eliminar** en su tarjeta |
| Vas a reconstruir la colección completa desde cero, o hacer una limpieza grande editando muchas piezas a la vez | Editar `garage164/data.json` y correr `publicar.sh` |
| Cambiaste la contraseña | `generar-hash-escritura.sh` (nueva variable en Netlify) y luego `publicar.sh` con la contraseña nueva |

`publicar.sh` **reemplaza toda la colección** por el contenido de `data.json` — incluido cualquier cambio que se haya hecho desde la página desde la última vez que lo corriste. Si Michel agregó algo hoy y tú corres `publicar.sh` con un `data.json` de la semana pasada, ese carrito nuevo se pierde. Para altas sueltas, siempre es más seguro usar el formulario de la página.

## 7. Formato de los datos

Sin cambios respecto a antes — el mismo objeto, ya sea que lo edites en `data.json` o lo generen los formularios de la página:

```json
{
  "collectionName": "Garage 164",
  "updatedAt": "2026-08-24",
  "cars": [ ... ],
  "wishlist": [ ... ]
}
```

### Cada carrito, dentro de `cars`

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `model` | Sí | El nombre grande de la tarjeta. También agrupa los duplicados |
| `brand` | No | Si falta, se asume “Hot Wheels” |
| `series`, `year`, `color`, `package`, `location` | No | Aparecen como etiquetas |
| `quantity` | No | Si falta, cuenta como 1 |
| `notes` | No | Texto libre bajo el título |

### Cada pieza deseada, dentro de `wishlist`

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `model` | Sí | El nombre de la pieza |
| `priority` | No | `alta`, `media` o `baja`. Si falta, es `media` |
| `series`, `year`, `color`, `where` | No | Se muestran juntos, separados por `·` |
| `notes` | No | Texto libre |

Los campos vacíos simplemente no aparecen en la tarjeta.

## 8. Qué protege esto y qué no

**Lo que sí protege.** El contenido de la colección, igual que antes: AES-256-GCM con una llave derivada por PBKDF2 (600 000 iteraciones). Aunque alguien acceda al almacén de Blobs, sin la contraseña solo obtiene ruido.

**Quién puede escribir.** Esta es la pieza nueva. De la contraseña se derivan **dos valores distintos e independientes**, con propósitos que no se cruzan:

```
   contraseña
       │
       ├── deriva (PBKDF2, sal del vault) ──► llave de cifrado     (nunca sale del navegador)
       │
       └── deriva (PBKDF2, sal fija "garage164-write-token-v1")
                       │
                       ▼
                token de escritura ──se envía──► la Function compara su
                                                   hash contra GARAGE164_WRITE_HASH
```

Al guardar, el navegador manda el token de escritura; la Function calcula su hash y lo compara contra el que guardaste en la variable de entorno. Coincide → acepta el cambio. No coincide → lo rechaza con 403. **La Function sigue sin poder descifrar nada** ni conoce la contraseña — solo verifica una credencial derivada de ella.

**Dos ediciones a la vez.** Cada lectura trae una versión (`ETag`). Al guardar, el navegador manda la versión que leyó; si alguien más guardó un cambio mientras tanto, la Function lo rechaza con 409 y la página recarga la versión más reciente en vez de pisarla en silencio.

**Lo que no protege.** La existencia de la página: al ser hosting mayormente estático, cualquiera que conozca la dirección puede abrir la pantalla de contraseña. Eso es aceptable porque lo que resguarda los datos es el cifrado, no la ruta secreta. `robots.txt` y las cabeceras de `_headers` la mantienen fuera de buscadores, pero no son control de acceso.

**Reglas prácticas:**

- Mantengan la URL y la contraseña fuera de publicaciones, redes y chats de grupo.
- La fortaleza de todo esto es la contraseña: larga y poco predecible.
- Si sospechan que se filtró: elijan una contraseña nueva, repitan el Paso 1 (nuevo `GARAGE164_WRITE_HASH`) y vuelvan a publicar con `publicar.sh`. El token derivado de la contraseña anterior deja de servir en cuanto cambia la variable de entorno.

## 9. Problemas frecuentes

| Qué ves | Por qué pasa | Qué hacer |
| --- | --- | --- |
| “No se encontró el archivo cifrado. Falta completar la configuración inicial.” | Todavía no corriste `publicar.sh` por primera vez | Completa el Paso 3 de la configuración inicial |
| “La contraseña no es correcta.” | Es otra contraseña, o la colección se cifró con una distinta | Verifica cuál se usó en el último `publicar.sh` |
| Al guardar desde el formulario: “No fue posible guardar: credencial de escritura no válida” | `GARAGE164_WRITE_HASH` no está configurada, no coincide con la contraseña, o falta redesplegar tras crearla | Repite el Paso 1; recuerda disparar un deploy nuevo después de guardar la variable |
| “Alguien más actualizó la colección. Recargando…” | Dos personas guardaron casi al mismo tiempo | Normal — la página ya recargó la versión más reciente; repite tu cambio si hacía falta |
| `publish-vault.mjs` dice “Conflicto” | Lo mismo, desde la terminal | Vuelve a correr `publicar.sh` |
| La página queda en blanco | JavaScript está desactivado | La página lo necesita para cifrar y descifrar; actívalo |
| Ves `garage164/data.json` en `git status` | El `.gitignore` no se está aplicando | **No hagas commit.** Revisa `.gitignore` antes de continuar |
