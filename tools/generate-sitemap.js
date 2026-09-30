#!/usr/bin/env node
/* ============================================================
   Findwebs — tools/generate-sitemap.js
   Regenerates sitemap.xml from the JSON content in data/.
   Zero dependencies.

   Usage:  node tools/generate-sitemap.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJSON(name) {
  const file = path.join(ROOT, 'data', name + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`data/${name}.json could not be read — ${err.message}`);
  }
}

const settings = readJSON('settings');
const categories = readJSON('categories');
const sites = readJSON('sites');

/* siteUrl may include a subfolder, e.g. https://example.com/findwebs */
const base = String(settings.siteUrl || 'https://example.com').replace(/\/+$/, '');

const urls = [];
function add(pathname, priority, changefreq) {
  urls.push({ loc: base + '/' + pathname.replace(/^\/+/, ''), priority, changefreq });
}

/* Static pages */
add('index.html', '1.0', 'weekly');
add('browse.html', '0.8', 'weekly');
add('browse.html?view=categories', '0.7', 'weekly');
add('about.html', '0.4', 'monthly');
add('about.html?p=contact', '0.4', 'monthly');
add('about.html?p=privacy', '0.2', 'yearly');
add('about.html?p=terms', '0.2', 'yearly');

/* Every category with at least one site */
const counts = {};
sites.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
categories
  .filter((c) => (counts[c.slug] || 0) > 0)
  .forEach((c) => add(`browse.html?c=${c.slug}`, '0.7', 'weekly'));

/* Every site page.
   Not listed: browse.html?q=… (search), any ?sort=… permutation,
   and browse.html?notfound=1 — all of those are noindex. */
sites.forEach((s) => add(`site.html?s=${s.slug}`, '0.6', 'monthly'));

const today = new Date().toISOString().slice(0, 10);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc.replace(/&/g, '&amp;')}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml written — ${urls.length} URLs based on ${base}`);

/* Sanity warning: unknown category references, matching app.js behaviour */
const known = new Set(categories.map((c) => c.slug));
sites.forEach((s) => {
  if (!known.has(s.category)) {
    console.warn(`[warn] site "${s.slug}" references unknown category "${s.category}"`);
  }
});
