# Garage 164 — versión estática privada

Catálogo privado de la colección de carritos, publicado en `/garage164/` dentro del sitio estático. No hay enlaces hacia esta ruta desde ninguna página pública.

Los datos se publican **cifrados**. Quien abra la dirección solo ve una pantalla que pide contraseña; el contenido real se descifra dentro del navegador y nunca viaja en claro ni queda guardado en el repositorio.

---

## 1. Cómo funciona, en palabras simples

El sitio es estático: no hay servidor que valide usuarios ni base de datos donde consultar. Todo lo que se publica queda en archivos que cualquiera podría descargar. La solución es que **el archivo publicado sea ilegible sin la contraseña**.

El flujo completo son tres momentos:

```
  data.json                 vault.enc.json                Navegador
 (texto legible)   ──►      (texto cifrado)      ──►     (vuelve a ser
  solo en tu PC             se publica en la web          legible en pantalla)
                  cifras con              descifras con
                  la contraseña           la misma contraseña
```

1. **Escribes** tu colección en `data.json`, un archivo normal de texto que vive **solo en tu computadora**.
2. **Ciframos** ese archivo con un comando, que produce `vault.enc.json`. Ese sí se publica.
3. **Abres la página** e ingresas la contraseña: el navegador descifra `vault.enc.json` en memoria y muestra la colección.

La contraseña nunca se guarda: ni en el repositorio, ni en el archivo cifrado, ni se envía a ningún servidor. Existe únicamente en la cabeza de quienes la comparten y en el momento en que la escriben.

**Detalle técnico**, para quien lo quiera: la contraseña pasa por PBKDF2-SHA-256 con 600 000 iteraciones para derivar una llave, y con ella se cifra el contenido usando AES-256-GCM. Cada vez que ciframos se generan un `salt` y un `iv` nuevos y aleatorios. Sin la contraseña correcta, el descifrado simplemente falla; no hay forma de leer una parte.

## 2. Qué hay en esta carpeta

| Archivo | ¿Se publica? | Para qué sirve |
| --- | --- | --- |
| `index.html` | Sí | La página: pantalla de contraseña + vista de la colección |
| `styles.css` | Sí | Estilos (tema oscuro) |
| `app.js` | Sí | Descifra en el navegador y dibuja las tarjetas |
| `vault.enc.json` | **Sí** | Tu colección, cifrada. Es el único archivo de datos que se sube |
| `data.example.json` | Sí | Plantilla de ejemplo, con datos inventados |
| `data.json` | **No, nunca** | Tu colección en texto legible. Está en `.gitignore` |
| `tools/encrypt-vault.mjs` | Sí | El comando que convierte `data.json` en `vault.enc.json` |
| `tools/publicar.sh` | Sí | Atajo que cifra, verifica y publica en un solo paso |

La regla que evita accidentes es una sola: **`data.json` se queda en tu computadora, `vault.enc.json` es lo que se publica.**

## 3. Requisitos

- **Node.js** — solo para el paso de cifrado.
- **Python 3** — para levantar el servidor local de prueba (viene con macOS).
- Una contraseña compartida de **14 caracteres como mínimo**. La herramienta rechaza cualquier cosa más corta.

## 4. Configuración inicial, paso a paso

> Estos comandos se ejecutan desde la **raíz del repositorio**, no desde dentro de `garage164/`.

> **Atajo:** una vez creado tu `data.json` (Paso 1), el script `./garage164/tools/publicar.sh` hace los pasos 2, 4 y 5 por ti. Los pasos de abajo explican qué ocurre por dentro; vale la pena leerlos una vez.

### Paso 1 — Crea tu archivo de datos

Copia la plantilla de ejemplo:

```zsh
cp garage164/data.example.json garage164/data.json
```

Ahora abre `garage164/data.json` y reemplaza el contenido de ejemplo por tus carritos reales. El formato de cada campo está explicado en la [sección 7](#7-formato-de-los-datos).

### Paso 2 — Cifra el archivo

Este bloque hace tres cosas: pide la contraseña sin mostrarla en pantalla, ejecuta el cifrado, y borra la contraseña de la sesión.

```zsh
read -s 'GARAGE164_PASSWORD?Contraseña de Garage 164: '; echo
export GARAGE164_PASSWORD
node garage164/tools/encrypt-vault.mjs garage164/data.json garage164/vault.enc.json
unset GARAGE164_PASSWORD
```

Si sale bien verás:

```
Archivo cifrado creado: garage164/vault.enc.json
```

**¿Por qué así y no escribiendo la contraseña en el comando?** Porque `read -s` no la muestra al teclearla y no la deja registrada en el historial de la terminal (`~/.zsh_history`). Si la pusieras directamente en la línea del comando, quedaría guardada en texto plano y visible para cualquiera que revise el historial.

### Paso 3 — Pruébalo en local

Levanta el servidor desde la raíz del repositorio:

```zsh
python3 -m http.server 8001 --bind 127.0.0.1
```

Abre <http://127.0.0.1:8001/garage164/> y prueba la contraseña.

> **No abras `index.html` con doble clic.** La página descarga `vault.enc.json` con `fetch`, y el navegador bloquea esa operación cuando el archivo se abre desde el disco (`file://`). Tiene que ser por HTTP.

Comprueba dos cosas: que la contraseña correcta abre la colección, y que una incorrecta muestra “La contraseña no es correcta”.

### Paso 4 — Verifica antes de publicar

```zsh
git status --short garage164/
```

Debe aparecer `garage164/vault.enc.json`. **No debe aparecer `garage164/data.json`** — está en `.gitignore`, así que si lo ves, algo se configuró mal y hay que detenerse antes de subir nada.

### Paso 5 — Publica

```zsh
git add garage164/vault.enc.json
git commit -m "chore(garage164): actualiza la colección"
git push
```

## 5. Cómo se usa la página

1. Entra a la dirección y escribe la contraseña compartida. El botón **Mostrar** permite verla mientras la escribes, por si el teclado del móvil complica las cosas.
2. Al abrir, arriba aparece un resumen con cuatro números:
   - **modelos** — cuántos modelos distintos hay (los repetidos cuentan como uno)
   - **carritos** — el total de unidades, sumando las cantidades
   - **duplicados** — cuántas unidades sobran de modelos repetidos
   - **por conseguir** — cuántas piezas hay en la lista de deseos
3. El buscador filtra por modelo, marca, serie, color o ubicación. **Ignora acentos y mayúsculas**: escribir `naranja` encuentra `Naranja`.
4. El botón **Cerrar** recarga la página y vuelve a la pantalla de contraseña. Úsalo si prestas el teléfono o dejas la computadora abierta.

La lista de deseos aparece automáticamente solo si tiene elementos.

## 6. Actualizar la colección

Cada vez que agregues o cambies carritos son dos cosas: editar y publicar.

**1. Edita `garage164/data.json`.** Agrega el carrito nuevo o corrige lo que haga falta, y actualiza el campo `updatedAt` con la fecha del día en formato `AAAA-MM-DD`. Es lo que la página muestra como “Actualizado el …”.

**2. Ejecuta el script de publicación.**

```zsh
./garage164/tools/publicar.sh
```

El script se encarga de todo lo demás: valida que el JSON no tenga errores, te muestra un resumen de lo que vas a publicar, pide la contraseña dos veces para evitar erratas, cifra, **comprueba que `data.json` no vaya a colarse en el commit** y te ofrece publicar.

Si prefieres hacerlo a mano, los comandos del Paso 2 de la sección anterior siguen funcionando igual.

Puedes usar la misma contraseña de siempre o cambiarla; si la cambias, todo el que use la página necesitará la nueva.

Como no hay base de datos, **`data.json` es la única fuente real de la colección**. Consérvalo: si lo pierdes, el archivo cifrado no se puede volver a editar, solo leer. Guarda una copia en un lugar seguro (un respaldo cifrado o un gestor de contraseñas con notas), nunca en el repositorio.

Y ojo con el punto de sincronización: si dos personas editan su propia copia de `data.json` por separado, el último que cifre y publique **sobrescribe** el trabajo del otro. Conviene acordar quién edita antes de hacerlo.

## 7. Formato de los datos

El archivo tiene dos campos generales y dos listas:

```json
{
  "collectionName": "Garage 164",
  "updatedAt": "2026-08-23",
  "cars": [ ... ],
  "wishlist": [ ... ]
}
```

| Campo general | Qué hace |
| --- | --- |
| `collectionName` | El título que se ve arriba. Si falta, dice “Garage 164” |
| `updatedAt` | Fecha `AAAA-MM-DD`; se muestra en formato largo, por ejemplo “23 de agosto de 2026” |

### Cada carrito, dentro de `cars`

```json
{
  "model": "Twin Mill",
  "brand": "Hot Wheels",
  "series": "HW Originals",
  "year": 2023,
  "color": "Naranja",
  "package": "Sellado",
  "location": "Vitrina",
  "quantity": 1,
  "notes": ""
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `model` | Sí | El nombre grande de la tarjeta. También es lo que agrupa duplicados |
| `brand` | No | Se muestra arriba del modelo. Si falta, se asume “Hot Wheels” |
| `series` | No | Aparece como etiqueta |
| `year` | No | Aparece como etiqueta |
| `color` | No | Aparece como etiqueta |
| `package` | No | Estado del empaque: `Sellado`, `Abierto`, `Suelto`… Aparece como etiqueta |
| `location` | No | Dónde está guardado: `Vitrina`, `Caja 2`… Aparece como etiqueta |
| `quantity` | No | Cuántas unidades tienes de ese modelo. Si falta, se cuenta como 1 |
| `notes` | No | Texto libre bajo el título. Si va vacío, no se muestra |

Los campos vacíos simplemente no aparecen en la tarjeta, así que puedes dejar en blanco los que no apliquen.

**Sobre los duplicados:** el conteo agrupa por `model`, ignorando mayúsculas y acentos. Si tienes dos entradas del mismo modelo, o una entrada con `"quantity": 2`, en ambos casos cuenta como 1 modelo y 1 duplicado.

### Cada pieza deseada, dentro de `wishlist`

```json
{
  "model": "Toyota Supra MK4",
  "series": "Fast & Furious",
  "year": 2024,
  "color": "Naranja",
  "priority": "alta",
  "where": "",
  "notes": ""
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `model` | Sí | El nombre de la pieza |
| `priority` | No | `alta`, `media` o `baja`. Cambia el color de la etiqueta. Si falta, es `media` |
| `series`, `year`, `color`, `where` | No | Se muestran juntos en una línea, separados por `·` |
| `where` | No | Dónde conseguirla: una tienda, un vendedor, un sitio |
| `notes` | No | Texto libre |

Si `wishlist` está vacía, la sección completa desaparece de la página.

## 8. Qué protege esto y qué no

**Lo que sí protege.** El contenido de la colección. Aunque alguien descargue `vault.enc.json`, sin la contraseña solo obtiene ruido: el cifrado es AES-256-GCM con una llave derivada mediante 600 000 iteraciones, lo que hace que probar contraseñas a la fuerza sea lentísimo.

**Lo que no protege.** La existencia de la página. Al ser hosting estático **no hay control de acceso en el servidor**: cualquiera que conozca la dirección puede abrirla y ver la pantalla de contraseña. Eso es aceptable, porque lo que resguarda los datos es el cifrado, no la ruta secreta.

Medidas complementarias que ya están puestas:

- `robots.txt` en la raíz del sitio bloquea `/garage164/` a los buscadores.
- El archivo `_headers` envía `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` y `Cache-Control: no-store` para esta ruta. Es el formato nativo de Netlify, donde está alojado el sitio, así que se aplica automáticamente en cada despliegue.
- La página declara `referrer: no-referrer`, para que al salir hacia otro sitio no se filtre la dirección de origen.

**Reglas prácticas que hay que sostener:**

- Mantengan la URL y la contraseña fuera de publicaciones, redes y chats de grupo.
- La fortaleza de todo esto es la contraseña. Una larga y poco predecible; nada de fechas ni nombres obvios.
- Compártanla por un canal privado y directo, nunca junto con el enlace en el mismo mensaje.
- Si sospechan que se filtró: cambien la contraseña, vuelvan a cifrar y publiquen el nuevo `vault.enc.json`. El archivo anterior deja de servir.

## 9. Problemas frecuentes

| Qué ves | Por qué pasa | Qué hacer |
| --- | --- | --- |
| “No se encontró el archivo cifrado. Falta completar la configuración inicial.” | `vault.enc.json` no existe todavía, o abriste la página con `file://` | Completa el Paso 2 y sirve el sitio por HTTP |
| “La contraseña no es correcta.” | Es otra contraseña, o el vault se cifró con una distinta | Verifica cuál se usó al cifrar por última vez |
| “El formato del archivo cifrado no es compatible.” | El `vault.enc.json` viene de una versión distinta de la herramienta | Vuelve a cifrar con `tools/encrypt-vault.mjs` de este repositorio |
| “Define GARAGE164_PASSWORD…” al cifrar | La variable no está definida o tiene menos de 14 caracteres | Repite el Paso 2 completo, con una contraseña más larga |
| La página queda en blanco | JavaScript está desactivado | La página lo necesita para descifrar; actívalo |
| Ves `garage164/data.json` en `git status` | El `.gitignore` no se está aplicando | **No hagas commit.** Revisa `.gitignore` antes de continuar |

---

## Estado actual

`data.json` ya está creado a partir de la plantilla, con los datos de ejemplo todavía dentro. Falta lo que solo tú puedes hacer:

1. Reemplazar el contenido de `garage164/data.json` por tu colección real.
2. Elegir la contraseña compartida, guardarla en un gestor y acordarla con Michel.
3. Ejecutar `./garage164/tools/publicar.sh` para generar y publicar el vault.

Mientras `vault.enc.json` no exista, la página abre pero responde que falta completar la configuración.
