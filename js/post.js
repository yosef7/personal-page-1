(function () {
  function qs(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const slug = qs('p');
  const titleEl = document.getElementById('post-title');
  const subtitleEl = document.getElementById('post-subtitle');
  const metaEl = document.getElementById('post-meta');
  const headerEl = document.getElementById('post-header');
  const contentEl = document.getElementById('post-content');

  if (!slug) {
    titleEl.textContent = 'Publicación no encontrada';
    contentEl.innerHTML = '<p>No se especificó ninguna publicación. <a href="blog.html">Volver al blog</a>.</p>';
    return;
  }

  fetch('posts/posts.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((posts) => {
      const post = posts.find((p) => p.slug === slug);
      if (!post) throw new Error('not-found');

      document.title = `${post.title} - Arnulfo Reyes`;
      titleEl.textContent = post.title;
      if (post.subtitle) subtitleEl.textContent = post.subtitle; else subtitleEl.remove();
      const date = new Date(post.date);
      metaEl.textContent = `Publicado por ${post.author || 'Arnulfo Reyes'} el ${date.toLocaleDateString('es-PA', { year: 'numeric', month: 'short', day: 'numeric' })}`;
      if (post.image && headerEl) {
        headerEl.style.backgroundImage = `url('${post.image}')`;
      }

      return fetch(`posts/${encodeURIComponent(slug)}.md`, { cache: 'no-store' });
    })
    .then((r) => {
      if (!r.ok) throw new Error('md-missing');
      return r.text();
    })
    .then((md) => {
      contentEl.innerHTML = window.marked ? marked.parse(md) : md;
    })
    .catch(() => {
      titleEl.textContent = 'No se pudo cargar el artículo';
      contentEl.innerHTML = '<p>Intenta nuevamente más tarde o vuelve al <a href="blog.html">listado</a>.</p>';
    });
})();

