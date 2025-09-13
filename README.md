# Página Web Personal

 Lenguajes de programación utilizados (**HTML, CSS y JavaScript**)

- Por: Arnulfo Reyes

## Blog: cómo publicar fácilmente

El sitio ahora incluye un blog dinámico basado en archivos Markdown.

Pasos para crear una nueva publicación:

1) Agrega el archivo Markdown
- Crea un archivo en `posts/` con el slug de tu post, por ejemplo: `posts/mi-nuevo-articulo.md`.
- Escribe el contenido en Markdown (títulos, párrafos, listas, etc.).

2) Registra la publicación en `posts/posts.json`
- Añade un objeto con los metadatos, por ejemplo:
```json
{
  "slug": "mi-nuevo-articulo",
  "title": "Mi nuevo artículo",
  "subtitle": "Una breve descripción",
  "date": "2025-01-01",
  "author": "Arnulfo Reyes",
  "image": "assets/img/post-bg.jpg"
}
```

3) Visualiza
- Abre `blog.html` para ver el listado.
- Abre `post.html?p=mi-nuevo-articulo` para ver el artículo.

Notas:
- El listado se ordena por `date` (descendente).
- La imagen del encabezado de cada post se toma del campo `image`.
- El contenido se renderiza con Markdown usando `marked` desde CDN.
