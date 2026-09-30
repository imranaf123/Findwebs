#!/usr/bin/env node
/* ============================================================
   Findwebs — tools/sync-sprite.js
   Copies the icon sprite from images/icons.svg into every HTML
   page, between the markers:

       <!-- fw:sprite:start --> … <!-- fw:sprite:end -->

   Why inline instead of <use href="images/icons.svg#id">:
   external SVG references are blocked when a page is opened
   directly from disk (file://), which is exactly the case this
   project has to support. Inlining the sprite means icons render
   anywhere, with no request at all. The cost is ~5 KB per page.

   Add or change an icon in images/icons.svg, then run:

       node tools/sync-sprite.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const START = '<!-- fw:sprite:start -->';
const END = '<!-- fw:sprite:end -->';

const sprite = fs.readFileSync(path.join(ROOT, 'images/icons.svg'), 'utf8').trim();

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let updated = 0;

pages.forEach((file) => {
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, 'utf8');
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from === -1 || to === -1) {
    console.warn(`[skip] ${file} — no sprite markers`);
    return;
  }
  const next = html.slice(0, from) + START + '\n' + sprite + '\n' + END + html.slice(to + END.length);
  if (next !== html) {
    fs.writeFileSync(full, next, 'utf8');
    updated++;
    console.log(`[ok]   ${file} — sprite synced (${sprite.length} bytes)`);
  } else {
    console.log(`[same] ${file} — already up to date`);
  }
});

console.log(`\n${updated} file(s) updated from images/icons.svg`);
