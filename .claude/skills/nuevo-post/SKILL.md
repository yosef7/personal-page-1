---
name: nuevo-post
description: >-
  Crea o edita una publicación del blog de este sitio estático (página personal
  de Arnulfo Reyes). Usar cuando el usuario pida "nuevo post", "publicar un
  artículo", "agregar una entrada al blog", editar/renombrar un post existente,
  o cuando trabaje sobre posts/*.md y posts/posts.json. Aplica todas las reglas
  de AGENTS.md (slug, imagen, cierre, Mermaid) y deja el post verificado por HTTP.
---

# Publicar un post en el blog

Sitio estático (HTML/CSS/JS vanilla, tema Bootstrap "Clean Blog"). Los posts son
Markdown servidos por `fetch` y renderizados con `marked` desde CDN. **No hay
build tools.** La fuente de verdad de las reglas es [AGENTS.md](../../../AGENTS.md);
este skill las operacionaliza.

## Anatomía de un post

Un post = **dos cambios sincronizados**:

1. `posts/<slug>.md` — contenido en Markdown.
2. Una entrada en `posts/posts.json` (array, JSON válido) con:
   ```json
   {
     "slug": "<slug>",
     "title": "Título directo y práctico",
     "subtitle": "Subtítulo concreto y útil",
     "date": "YYYY-MM-DD",
     "author": "Arnulfo Reyes",
     "image": "assets/img/<imagen>.jpg"
   }
   ```

El listado (`blog.html`) ordena por `date` descendente. La cabecera de
`post.html?p=<slug>` usa el campo `image` como fondo. El `slug` de `posts.json`
**debe** coincidir con el nombre del archivo `.md`.

## Reglas (de AGENTS.md)

- **Slug:** corto, práctico, legible, en minúsculas, con guiones. Evita slugs
  largos y descriptivos.
- **Idioma:** español por defecto.
- **Estilo:** práctico, estructurado, escaneable. Secciones claras, ejemplos
  concretos, conclusiones accionables. Encabezados concisos, sin jerga inflada.
- **Imagen:** relevante al tema, sin marca de agua (Unsplash / Pexels / Pixabay
  o similares). Guárdala en `assets/img/` con un nombre claro y referénciala en
  el campo `image`. Nunca un placeholder genérico.
- **Cierre obligatorio:** todo post termina exactamente con:
  ```
  Gracias por leer mi publicación. Recibo con mucho agrado los comentarios y las críticas constructivas.

  Me pueden encontrar en IG @arnulfo.
  ```
- **Diagramas:** usa Mermaid en bloques ```mermaid ... ```. Deben ser modernos,
  legibles y responsivos; nodos etiquetados, agrupación clara, colores
  contenidos. `js/post.js` los convierte en `<figure class="post-diagram">` y
  los inicializa tras cargar el Markdown.

## Flujo de trabajo

### Crear un post nuevo
1. Define el `slug` (corto, en minúsculas, con guiones).
2. Consigue/guarda la imagen en `assets/img/` y anota su ruta.
3. Crea `posts/<slug>.md` con el contenido y el cierre obligatorio.
4. Añade la entrada al **inicio o donde corresponda** en `posts/posts.json`
   (el orden visual lo da `date`, pero el JSON debe quedar válido).
5. Verifica (ver abajo).

### Editar un post existente
- Cambia solo el `.md` si es contenido; cambia también `posts.json` si tocas
  título, subtítulo, fecha o imagen.

### Renombrar un slug
- Renombra **a la vez** el archivo `posts/<viejo>.md` → `posts/<nuevo>.md` y el
  campo `slug` en `posts.json`. Deben quedar idénticos.

## Verificación (obligatoria)

Las páginas usan `fetch`, así que **no se validan abriendo el HTML directo**.

```bash
python3 -m http.server 8001
```

Luego comprueba:
- `posts/posts.json` es JSON válido (p. ej. `python3 -m json.tool posts/posts.json`).
- Existe `posts/<slug>.md` y el `slug` figura en `posts.json`.
- `http://127.0.0.1:8001/post.html?p=<slug>` carga y devuelve `200 OK`.
- `http://127.0.0.1:8001/blog.html` muestra el post en el listado.
- Si hay diagramas Mermaid, confirma que renderizan tras cargar el Markdown.
- Si hay automatización de navegador disponible, inspecciona la página renderizada.

## Límites

- No agregues build tools, frameworks ni dependencias npm.
- No toques páginas, estilos o scripts ajenos al post.
- Mantén el cambio acotado a lo solicitado.
