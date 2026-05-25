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

  function renderMermaidDiagrams() {
    const diagrams = contentEl.querySelectorAll('pre code.language-mermaid');
    if (!diagrams.length || !window.mermaid) return;

    diagrams.forEach((codeEl) => {
      const figure = document.createElement('figure');
      figure.className = 'post-diagram';
      figure.setAttribute('aria-label', 'Diagrama del modelo');

      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid post-diagram__canvas';
      wrapper.textContent = codeEl.textContent;

      figure.appendChild(wrapper);
      codeEl.closest('pre').replaceWith(figure);
    });

    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      flowchart: {
        curve: 'basis',
        htmlLabels: true,
        nodeSpacing: 56,
        rankSpacing: 64
      },
      themeVariables: {
        fontFamily: '"Open Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        primaryColor: '#f8fafc',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#94a3b8',
        lineColor: '#94a3b8',
        secondaryColor: '#ecfeff',
        tertiaryColor: '#fff7ed',
        clusterBkg: '#f8fafc',
        clusterBorder: '#cbd5e1',
        edgeLabelBackground: '#ffffff'
      }
    });
    window.mermaid.run({ nodes: contentEl.querySelectorAll('.mermaid') }).catch(() => {});
  }

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
      renderMermaidDiagrams();
    })
    .catch(() => {
      titleEl.textContent = 'No se pudo cargar el artículo';
      contentEl.innerHTML = '<p>Intenta nuevamente más tarde o vuelve al <a href="blog.html">listado</a>.</p>';
    });
})();
