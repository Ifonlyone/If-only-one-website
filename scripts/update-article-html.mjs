#!/usr/bin/env node
/**
 * Update all HTML pages to use canonical Squarespace CDN image URLs:
 * 1. Article list thumbnails (.ar cards) in articles/index.html
 * 2. Nav dropdown thumbnails in all 6 HTML pages
 * 3. art-nf body placeholder images → thumbnail CDN URL
 * 4. Body images for published articles that still use /img-103.jpg placeholders
 *
 * Uses slugToThumbCdn and slugToBodyImgs from article-thumbs/_map.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAP_PATH = path.join(ROOT, 'article-thumbs', '_map.json');

const { slugToThumbCdn, slugToBodyImgs } = JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));

/**
 * Replace article-list card thumbnails and nav dropdown thumbnails.
 * Pattern: onclick="go('SLUG')"[^>]*><img src="OLD" → same with CDN URL.
 * Also handles: src="/article-thumbs/SLUG.EXT" (from prior local-file run).
 */
function replaceBySlug(html, slug, cdnUrl) {
  let out = html;

  // 1. onclick="go('SLUG')..." followed immediately by <img src="...">
  const goPattern = new RegExp(
    `(onclick="go\\('${escRe(slug)}'\\)[^>]*>)(<img src=")[^"]+(")`,'g'
  );
  out = out.replace(goPattern, `$1$2${cdnUrl}$3`);

  // 2. Any src="/article-thumbs/SLUG.EXT" left from a previous run
  const localPattern = new RegExp(`src="/article-thumbs/${escRe(slug)}\\.[^"]{2,5}"`, 'g');
  out = out.replace(localPattern, `src="${cdnUrl}"`);

  return out;
}

/**
 * For index.html, the nav uses location.href rather than go('slug').
 * We match each <img src="OLD"> in the dropdown positionally.
 * The dropdown is bounded by id="ddar" and the "View all articles" footer link.
 */
function replaceNavIndex(html, orderedSlugs) {
  const startTag = '<div class="dm wide" id="ddar">';
  const endTag   = '<div style="padding:.5rem';
  const s = html.indexOf(startTag);
  const e = html.indexOf(endTag, s);
  if (s === -1 || e === -1) { console.warn('index.html: dropdown section not found'); return html; }

  let section = html.slice(s, e);
  let idx = 0;
  section = section.replace(/<img src="[^"]+"/g, () => {
    const slug = orderedSlugs[idx++];
    const cdnUrl = slug ? (slugToThumbCdn[slug] || '') : '';
    return cdnUrl ? `<img src="${cdnUrl}"` : `<img src=""`;
  });
  return html.slice(0, s) + section + html.slice(e);
}

/**
 * Replace placeholder /img-103.jpg body images within the art-nf page section
 * with the art-nf thumbnail CDN URL (draft has no body content in XML).
 */
function replaceArtNfBody(html) {
  const cdnUrl = slugToThumbCdn['art-nf'];
  if (!cdnUrl) return html;

  const sectionStart = html.indexOf('<div id="pg-art-nf"');
  const sectionEnd   = html.indexOf('<div id="pg-the-navigators-and-other-things-that-are"');
  if (sectionStart === -1 || sectionEnd === -1) return html;

  let section = html.slice(sectionStart, sectionEnd);
  // Replace remaining /article-thumbs/art-nf.* or /img-103.jpg body placeholders
  section = section
    .replace(/<img src="\/article-thumbs\/art-nf\.[^"]+"/g, `<img src="${cdnUrl}"`)
    .replace(/<img src="\/img-103\.jpg" alt="article image"/g, `<img src="${cdnUrl}" alt="article image"`);
  return html.slice(0, sectionStart) + section + html.slice(sectionEnd);
}

/**
 * For published articles whose body sections have /img-103.jpg placeholders,
 * replace them in order using the CDN body images from XML.
 */
function replaceBodyImages(html, slug) {
  const bodyImgs = slugToBodyImgs[slug];
  if (!bodyImgs || bodyImgs.length === 0) return html;

  const sectionId = `id="pg-${slug}"`;
  const sectionStart = html.indexOf(`<div ${sectionId}`);
  if (sectionStart === -1) return html;
  // Find next article section
  const nextSection = html.indexOf('<div id="pg-', sectionStart + 1);
  const sectionEnd  = nextSection !== -1 ? nextSection : html.length;

  let section = html.slice(sectionStart, sectionEnd);
  let imgIdx = 0;
  section = section.replace(/<img src="\/img-103\.jpg" alt="article image"/g, () => {
    const u = bodyImgs[imgIdx % bodyImgs.length];
    imgIdx++;
    return `<img src="${u}" alt="article image"`;
  });
  return html.slice(0, sectionStart) + section + html.slice(sectionEnd);
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Nav dropdown slugs in order (same on all pages) ───────────────────────

const NAV_SLUGS_ORDERED = [
  'art-nf',
  'the-navigators-and-other-things-that-are',
  'what-makes-waiting-so-hard--me',
  'vacuuming-the-red-carpet---a-paen-for-th',
  'grace-for-the-mind--the-christian-and-me',
  'what-does-it-mean-to--sin-willfully----h',
  'the-church--more-than-a-building',
  'the-burden-of-bible-reading',
];

// ── All slugs (for body image replacement) ────────────────────────────────

const ALL_SLUGS = Object.keys(slugToThumbCdn);

// ── Process each page ─────────────────────────────────────────────────────

const pageConfigs = {
  'articles/index.html':  { ops: ['slugThumbsAndNav', 'artNfBody', 'bodyImages'] },
  'about/index.html':     { ops: ['slugThumbsAndNav'] },
  'books/index.html':     { ops: ['slugThumbsAndNav'] },
  'give/index.html':      { ops: ['slugThumbsAndNav'] },
  'contact/index.html':   { ops: ['slugThumbsAndNav'] },
  'index.html':           { ops: ['indexNav'] },
};

let totalReplaced = 0;

for (const [relPath, config] of Object.entries(pageConfigs)) {
  const fullPath = path.join(ROOT, relPath);
  let html = fs.readFileSync(fullPath, 'utf-8');
  const original = html;

  for (const op of config.ops) {
    if (op === 'slugThumbsAndNav') {
      // Replace thumbnails for all slugs (article list + nav dropdown by go(slug))
      for (const slug of ALL_SLUGS) {
        const cdnUrl = slugToThumbCdn[slug];
        if (cdnUrl) html = replaceBySlug(html, slug, cdnUrl);
      }
    } else if (op === 'indexNav') {
      html = replaceNavIndex(html, NAV_SLUGS_ORDERED);
      // Also replace any remaining /article-thumbs/ references
      for (const slug of ALL_SLUGS) {
        const cdnUrl = slugToThumbCdn[slug];
        if (cdnUrl) {
          const localPat = new RegExp(`src="/article-thumbs/${escRe(slug)}\\.[^"]{2,5}"`, 'g');
          html = html.replace(localPat, `src="${cdnUrl}"`);
        }
      }
    } else if (op === 'artNfBody') {
      html = replaceArtNfBody(html);
    } else if (op === 'bodyImages') {
      for (const slug of ALL_SLUGS) {
        html = replaceBodyImages(html, slug);
      }
    }
  }

  if (html !== original) {
    fs.writeFileSync(fullPath, html);
    const remaining = (html.match(/\/img-103\.jpg/g) || []).length +
                      (html.match(/\/article-thumbs\//g) || []).length;
    const replaced = (original.match(/\/img-103\.jpg/g) || []).length +
                     (original.match(/\/article-thumbs\//g) || []).length -
                     remaining;
    console.log(`✓ ${relPath} — replaced ${replaced} (${remaining} remaining)`);
    totalReplaced += replaced;
  } else {
    console.log(`- ${relPath} — no changes`);
  }
}

console.log(`\nTotal: ${totalReplaced} image references updated`);
