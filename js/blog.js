// Render blog index from posts/posts.json
(function () {
  const container = document.getElementById('posts-list');
  if (!container) return;

  fetch('posts/posts.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((posts) => {
      posts
        .sort((a, b) => (a.date > b.date ? -1 : 1))
        .forEach((post) => {
          const date = (window.dayjs ? dayjs(post.date).format('MMM D, YYYY') : post.date);
          const el = document.createElement('div');
          el.className = 'post-preview';
          el.innerHTML = `
            <a href="post.html?p=${encodeURIComponent(post.slug)}">
              <h2 class="post-title">${post.title}</h2>
              ${post.subtitle ? `<h3 class="post-subtitle">${post.subtitle}</h3>` : ''}
            </a>
            <p class="post-meta">Publicado por ${post.author || 'Arnulfo Reyes'} el ${date}</p>
          `;
          container.appendChild(el);
          const hr = document.createElement('hr');
          hr.className = 'my-4';
          container.appendChild(hr);
        });

      if (!posts || posts.length === 0) {
        container.innerHTML = '<p>No hay publicaciones aún.</p>';
      }
    })
    .catch(() => {
      container.innerHTML = '<p>No se pudo cargar el listado de publicaciones.</p>';
    });
})();

