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

  // Config común a todos los diagramas (independiente del tema).
  const MERMAID_BASE_CONFIG = {
    startOnLoad: false,
    securityLevel: 'loose',
    fontFamily: '"Open Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    flowchart: {
      curve: 'basis',
      htmlLabels: true,
      nodeSpacing: 56,
      rankSpacing: 64
    }
  };

  // Paleta propia del sitio (solo aplica al tema 'base', el predeterminado).
  const SITE_BASE_THEME_VARIABLES = {
    primaryColor: '#f8fafc',
    primaryTextColor: '#0f172a',
    primaryBorderColor: '#94a3b8',
    lineColor: '#94a3b8',
    secondaryColor: '#ecfeff',
    tertiaryColor: '#fff7ed',
    clusterBkg: '#f8fafc',
    clusterBorder: '#cbd5e1',
    edgeLabelBackground: '#ffffff'
  };

  const ALLOWED_THEMES = ['base', 'default', 'neutral', 'forest', 'dark'];

  // Tema por diagrama: se lee del propio bloque Mermaid (directiva init,
  // frontmatter `config: theme:` o un comentario `%% theme: forest %%`).
  // Sin indicación se usa 'base' con la paleta del sitio.
  function pickTheme(source) {
    const match = source.match(/theme["'\s:]+\s*["']?(base|default|neutral|forest|dark)["']?/i);
    const name = match && match[1].toLowerCase();
    return ALLOWED_THEMES.indexOf(name) !== -1 ? name : 'base';
  }

  function buildMermaidConfig(themeName) {
    const config = Object.assign({}, MERMAID_BASE_CONFIG, { theme: themeName });
    if (themeName === 'base') {
      config.themeVariables = Object.assign(
        { fontFamily: MERMAID_BASE_CONFIG.fontFamily },
        SITE_BASE_THEME_VARIABLES
      );
    }
    return config;
  }

  async function renderMermaidDiagrams() {
    const diagrams = contentEl.querySelectorAll('pre code.language-mermaid');
    if (!diagrams.length || !window.mermaid) return;

    let index = 0;
    for (const codeEl of diagrams) {
      const source = codeEl.textContent;

      const figure = document.createElement('figure');
      figure.className = 'post-diagram';
      figure.setAttribute('aria-label', 'Diagrama del modelo');

      const canvas = document.createElement('div');
      canvas.className = 'post-diagram__canvas';

      figure.appendChild(canvas);
      codeEl.closest('pre').replaceWith(figure);

      // Render aislado por diagrama para que cada uno use su propio tema.
      try {
        window.mermaid.initialize(buildMermaidConfig(pickTheme(source)));
        const { svg } = await window.mermaid.render(`post-diagram-${index++}`, source);
        canvas.innerHTML = svg;
      } catch (err) {
        figure.replaceWith(codeEl.closest('pre') || figure);
      }
    }
  }

  // Envuelve cada tabla del Markdown para permitir scroll horizontal en móvil
  // sin romper el ancho de la columna del artículo.
  function wrapTables() {
    contentEl.querySelectorAll('table').forEach((table) => {
      if (table.closest('.post-table-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'post-table-wrap';
      table.replaceWith(wrap);
      wrap.appendChild(table);
    });
  }

  // Resaltado de sintaxis. Respeta el lenguaje declarado (```python) y, si no
  // hay ninguno, deja que highlight.js lo detecte. Excluye los bloques Mermaid,
  // que se transforman en diagramas, no en código.
  function highlightCode() {
    if (!window.hljs) return;
    contentEl.querySelectorAll('pre code').forEach((block) => {
      if (block.classList.contains('language-mermaid')) return;
      window.hljs.highlightElement(block);
    });
  }

  // Tipografía matemática: espera a que MathJax cargue (async) y compone solo
  // el contenido inyectado dinámicamente.
  function typesetMath() {
    if (!contentEl.textContent.includes('$$') && !contentEl.textContent.includes('\\(') && !contentEl.textContent.includes('\\[')) return;
    const MJ = window.MathJax;
    if (!MJ) {
      setTimeout(typesetMath, 100);
      return;
    }
    const run = () => MJ.typesetPromise([contentEl]).catch(() => {});
    if (MJ.startup && MJ.startup.promise) {
      MJ.startup.promise.then(run).catch(() => {});
    } else if (MJ.typesetPromise) {
      run();
    }
  }

  // Actualiza la descripción y las etiquetas Open Graph/Twitter con los datos
  // del artículo cargado. No ayuda a los scrapers (no ejecutan JS), pero deja
  // la página coherente para quien sí evalúa el DOM.
  function updateMeta(post) {
    const desc = post.subtitle || `Publicación de ${post.author || 'Arnulfo Reyes'}.`;
    const setAttr = (selector, attr, value) => {
      const el = document.head.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    setAttr('meta[name="description"]', 'content', desc);
    setAttr('meta[property="og:title"]', 'content', `${post.title} - Arnulfo Reyes`);
    setAttr('meta[property="og:description"]', 'content', desc);
    setAttr('meta[name="twitter:title"]', 'content', `${post.title} - Arnulfo Reyes`);
    setAttr('meta[name="twitter:description"]', 'content', desc);
    const postUrl = new URL(post.url || `post.html?p=${encodeURIComponent(post.slug)}`, window.location.href);
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = postUrl.href;
    let ogUrl = document.head.querySelector('meta[property="og:url"]');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrl);
    }
    ogUrl.content = postUrl.href;
    if (post.image) {
      const imageUrl = new URL(post.image, window.location.href).href;
      setAttr('meta[property="og:image"]', 'content', imageUrl);
      setAttr('meta[name="twitter:image"]', 'content', imageUrl);
    }
  }

  if (contentEl.dataset.static === 'true') {
    wrapTables();
    highlightCode();
    renderMermaidDiagrams();
    typesetMath();
    return;
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
      updateMeta(post);
      titleEl.textContent = post.title;
      if (post.subtitle) subtitleEl.textContent = post.subtitle; else subtitleEl.remove();
      const date = new Date(`${post.date}T12:00:00`);
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
      // El encabezado de la página ya contiene el h1 del artículo.
      contentEl.querySelectorAll('h1').forEach((heading) => {
        const sectionHeading = document.createElement('h2');
        sectionHeading.innerHTML = heading.innerHTML;
        heading.replaceWith(sectionHeading);
      });
      wrapTables();
      highlightCode();
      renderMermaidDiagrams();
      typesetMath();
    })
    .catch(() => {
      titleEl.textContent = 'No se pudo cargar el artículo';
      contentEl.innerHTML = '<p>Intenta nuevamente más tarde o vuelve al <a href="blog.html">listado</a>.</p>';
    });
})();
