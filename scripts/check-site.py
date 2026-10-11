#!/usr/bin/env python3
"""Validación del sitio estático. Solo usa la biblioteca estándar de Python.

Revisa:
  - posts/posts.json es JSON válido y cada entrada tiene sus campos obligatorios.
  - Cada slug tiene su posts/<slug>.md, su imagen y (si la declara) su página estática.
  - Cada post cierra con el texto de despedida acordado.
  - Las URLs de sitemap.xml apuntan a archivos que existen.
  - Las referencias locales (href, src, url()) en HTML y CSS existen en el repo.
  - Las redirecciones de netlify.toml apuntan a páginas que existen.

Uso, desde la raíz del repositorio:
  python3 scripts/check-site.py
"""

import json
import re
import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://www.arnulforeyes.com/"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED_FIELDS = ("slug", "title", "date", "image")
CLOSING_LINES = (
    "Gracias por leer mi publicación. Recibo con mucho agrado los comentarios y las críticas constructivas.",
    "Me pueden encontrar en IG @arnulfo.",
)
REF_RE = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)""")

errors = []


def error(msg):
    errors.append(msg)


def page_exists(path):
    """Resuelve una ruta del sitio como lo hace el servidor: /blog/ → blog/index.html."""
    target = ROOT / path.lstrip("/")
    if path.endswith("/") or target.is_dir():
        target = target / "index.html"
    return target.is_file()


def is_local(ref):
    if ref.startswith(("#", "mailto:", "tel:", "javascript:", "data:", "//")):
        return False
    return not urlparse(ref).scheme


def check_posts():
    index = ROOT / "posts" / "posts.json"
    try:
        posts = json.loads(index.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        error(f"posts/posts.json: no se pudo leer ({exc})")
        return

    seen = set()
    for i, post in enumerate(posts):
        where = f"posts/posts.json[{i}]"
        missing = [f for f in REQUIRED_FIELDS if not post.get(f)]
        if missing:
            error(f"{where}: faltan campos {', '.join(missing)}")
            continue

        slug = post["slug"]
        where = f"posts/posts.json ({slug})"
        if slug in seen:
            error(f"{where}: slug duplicado")
        seen.add(slug)
        if not SLUG_RE.match(slug):
            error(f"{where}: el slug debe ir en minúsculas y con guiones")
        if not DATE_RE.match(post["date"]):
            error(f"{where}: la fecha debe tener formato YYYY-MM-DD")
        if not page_exists(post["image"]):
            error(f"{where}: no existe la imagen {post['image']}")
        if post.get("url") and not page_exists(post["url"]):
            error(f"{where}: no existe la página {post['url']}")

        md = ROOT / "posts" / f"{slug}.md"
        if not md.is_file():
            error(f"{where}: no existe posts/{slug}.md")
            continue
        text = md.read_text(encoding="utf-8")
        for line in CLOSING_LINES:
            if line not in text:
                error(f"posts/{slug}.md: falta el cierre «{line}»")

    for md in (ROOT / "posts").glob("*.md"):
        if md.stem not in seen:
            error(f"posts/{md.name}: no está registrado en posts/posts.json")


def check_sitemap():
    try:
        tree = ET.parse(ROOT / "sitemap.xml")
    except (OSError, ET.ParseError) as exc:
        error(f"sitemap.xml: no se pudo leer ({exc})")
        return
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    for loc in tree.getroot().iterfind("sm:url/sm:loc", ns):
        url = (loc.text or "").strip()
        if not url.startswith(SITE_URL):
            error(f"sitemap.xml: URL fuera del dominio {url}")
            continue
        if not page_exists(url[len(SITE_URL) - 1:]):
            error(f"sitemap.xml: {url} no corresponde a ningún archivo")


def check_local_refs():
    files = [p for p in ROOT.rglob("*") if p.suffix in (".html", ".css")]
    for path in files:
        rel = path.relative_to(ROOT)
        if rel.parts[0] in ("node_modules", ".git") or rel.parts[0].startswith("."):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in REF_RE.finditer(text):
            ref = (match.group(1) or match.group(2)).strip()
            if not ref or not is_local(ref) or "${" in ref:
                continue
            target = urlparse(ref).path
            if not target:
                continue
            if not target.startswith("/"):
                target = "/" + str((path.parent / target).resolve().relative_to(ROOT))
            if not page_exists(target):
                error(f"{rel}: referencia rota «{ref}»")


def check_redirects():
    try:
        config = tomllib.loads((ROOT / "netlify.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        error(f"netlify.toml: no se pudo leer ({exc})")
        return
    for rule in config.get("redirects", []):
        to = rule.get("to", "")
        if to.startswith("/") and not page_exists(urlparse(to).path):
            error(f"netlify.toml: la redirección {rule.get('from')} → {to} apunta a una página inexistente")


def main():
    check_posts()
    check_sitemap()
    check_local_refs()
    check_redirects()
    if errors:
        print(f"✗ {len(errors)} problema(s):")
        for msg in errors:
            print(f"  - {msg}")
        return 1
    print("✓ Sitio válido: posts, sitemap, redirecciones y referencias locales en orden.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
