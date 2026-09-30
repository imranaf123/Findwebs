/* Findwebs — app.js — core layer: theme, data loading, directory
   ordering, search, renderers, header/footer/ads, SEO, suggestions,
   mobile panels. Content comes from data/*.json; this file is logic
   only. All links and asset paths are relative. See README.md. */
(function () {
  'use strict';

  /* ---------------- small helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Icons are inline <use> references to the sprite that tools/sync-sprite.js
     embeds in each page, so they render with no request and no server. */
  var warnedIcons = {};
  var spriteIds = null;
  /* The sprite is inlined into every page, so an unknown name can be spotted
     before it renders as an empty square. Falls back to the neutral glyph and
     warns once, the same way a missing JSON key does. Nothing is substituted
     while the sprite is still being parsed — the list is simply empty then. */
  function spriteHas(id) {
    if (typeof document === 'undefined') return true;
    if (!spriteIds) {
      spriteIds = {};
      var syms = document.querySelectorAll('symbol[id^="i-"]');
      Array.prototype.forEach.call(syms, function (el) { spriteIds[el.id] = 1; });
    }
    var any = false;
    for (var k in spriteIds) { any = true; break; }
    if (!any) { spriteIds = null; return true; }
    return !!spriteIds[id];
  }
  function icon(name, cls) {
    var id = String(name || '');
    if (!spriteHas(id)) {
      if (!warnedIcons[id]) {
        warnedIcons[id] = true;
        console.warn(TAG + 'icon "' + id + '" is not in images/icons.svg — using "i-layers".');
      }
      id = 'i-layers';
    }
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false">' +
      '<use href="#' + id + '"></use></svg>';
  }

  /* ---------------- state ---------------- */
  var S = null;             // settings
  var CATEGORIES = [];      // categories (validated)
  var CAT_BY_SLUG = {};     // slug -> category
  var SITES = [];           // sites (validated, _index set)
  var SITE_BY_SLUG = {};    // slug -> site
  var BADGE_MAP = {};       // uppercased badge -> {label, style}
  var dataFailed = false;
  var dataBag = null;       // the raw JSON payloads, as loaded
  var dataPromise = null;   // set by loadData()
  var dataError = '';       // why loading failed, for the error state

  /* ---------------- data ---------------- */
  function validateSites(raw) {
    var seen = {};
    var out = [];
    (raw || []).forEach(function (site, i) {
      site = site || {};
      var problems = [];
      ['slug', 'name', 'url', 'description', 'category', 'dateAdded'].forEach(function (f) {
        if (site[f] === undefined || site[f] === null || site[f] === '') {
          problems.push('missing required field "' + f + '"');
        }
      });
      if (site.slug) {
        if (seen[site.slug]) problems.push('duplicate slug "' + site.slug + '"');
        seen[site.slug] = true;
      }
      if (site.url && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(String(site.url))) {
        problems.push('invalid url "' + site.url + '"');
      }
      if (problems.length) {
        console.warn(TAG + 'sites entry #' + i + (site.name ? ' ("' + site.name + '")' : '') +
          ': ' + problems.join('; ') + ' — skipped.');
        return;
      }
      site._index = i; // original position in the data (tie-breaker only)
      out.push(site);
    });
    return out;
  }

  /* ---------------- data loading ----------------
     The three content files are fetched with a relative path, so they
     load from a domain root, a subfolder, or any static host alike.
     Failure is handled, not assumed away: see showErrorState().        */
  var DATA_FILES = ['settings', 'categories', 'sites', 'content'];

  /* Built-in fallbacks. If a key is missing from data/content.json the site
     still renders: the fallback is used and a warning is logged once. */
  var CONTENT_DEFAULTS = {
    'hero.eyebrow': 'Curated website directory',
    'hero.titleParts.before': 'Discover useful ',
    'hero.titleParts.after': ' across the internet.',
    'hero.typing.enabled': true,
    'hero.typing.words': ['websites', 'tools', 'resources', 'platforms', 'apps', 'communities'],
    'hero.typing.typeSpeedMs': 65,
    'hero.typing.deleteSpeedMs': 32,
    'hero.typing.holdMs': 1600,
    'hero.typing.gapMs': 300,
    'hero.subtitle': 'Search, explore, and discover useful tools, resources, and online platforms.',
    'hero.search.placeholder': 'Search websites, tools, and resources...',
    'hero.search.shortcutHint': '/',
    'hero.popularLabel': 'Popular searches',
    'hero.facts.enabled': true,
    'hero.facts.minSites': 10,
    'hero.facts.template': '{sites} websites · {categories} categories · Updated {updated}',
    'hero.highlights.enabled': true,
    'ui.visitWebsite': 'Visit Website',
    'ui.leaveNotice': "You'll leave Findwebs to open this website.",
    'ui.showMore': 'Show more',
    'ui.noResultsTitle': 'No websites found.',
    'ui.noResultsHint': 'Try another search or browse categories.',
    'ui.loadError': "Couldn't load the directory. Please refresh to try again.",
    'ui.jsNotice': 'Enable JavaScript to browse the directory.',
    'ui.sitesCount.one': '{n} site',
    'ui.sitesCount.other': '{n} sites',
    'ui.websitesCount.one': '{n} website',
    'ui.websitesCount.other': '{n} websites',
    'footer.tagline': 'Discover useful websites across the internet.',
    'footer.note': 'Built for discovery.',
    'footer.copyright': '© {year} {siteName}. All rights reserved.'
  };
  var contentWarned = {};
  var TAG = '[Findwebs] ';

  function loadData(dir) {
    if (!dataPromise) {
      dir = (typeof dir === 'string' && dir ? dir : 'data/').replace(/\/?$/, '/');
      dataPromise = Promise.all(DATA_FILES.map(function (name) {
        var path = dir + name + '.json';
        return fetch(path).then(function (res) {
          if (!res.ok) throw new Error(path + ' (HTTP ' + res.status + ')');
          return res.json().catch(function () { throw new Error(path + ' is not valid JSON'); });
        });
      })).then(function (files) {
        dataBag = { settings: files[0], categories: files[1], sites: files[2], content: files[3] };
        return dataBag;
      }, function (err) {
        dataError = (err && err.message) || 'the data files did not load';
        throw err;
      });
    }
    return dataPromise;
  }

  /* Runs fn once the data has settled — loaded or failed. Each page calls
     this at the end of <body>, so rendering happens in a single pass. */
  function ready(fn) {
    if (!dataPromise) { fn(); return; }
    dataPromise.then(fn, fn);
  }

  /* A category needs a slug and a name; the artwork, tint, and description
     are optional, so a hand-added category still renders. */
  function validateCategories(raw) {
    var out = [];
    (raw || []).forEach(function (cat, i) {
      cat = cat || {};
      if (!cat.slug || !cat.name) {
        console.warn(TAG + 'categories entry #' + i + ': missing "slug" or "name" — skipped.');
        return;
      }
      out.push(cat);
    });
    return out;
  }

  function readData() {
    var bag = dataBag;
    if (!bag || !bag.settings || !Array.isArray(bag.categories) || !Array.isArray(bag.sites)) {
      dataFailed = true;
      dataError = dataError || 'the data files did not load';
      console.error(TAG + 'Directory data unavailable — ' + dataError);
      return;
    }
    S = bag.settings;
    CATEGORIES = validateCategories(bag.categories);
    SITES = validateSites(bag.sites);
    CAT_BY_SLUG = {};
    SITE_BY_SLUG = {};
    CATEGORIES.forEach(function (c) { CAT_BY_SLUG[c.slug] = c; });
    SITES.forEach(function (s) { SITE_BY_SLUG[s.slug] = s; });
    SITES.forEach(function (s) {
      if (!CAT_BY_SLUG[s.category]) {
        console.warn(TAG + '"' + s.slug + '" uses unknown category "' + s.category +
          '" — hidden from category pages, still searchable.');
      }
    });
    BADGE_MAP = {};
    Object.keys(S.badges || {}).forEach(function (k) {
      BADGE_MAP[k.toUpperCase()] = {
        label: S.badges[k].label || k,
        style: S.badges[k].style || 'neutral'
      };
    });
  }

  /* ---------------- content (all visible copy, from content.json) ----------
     get() walks the content tree and falls back to the built-in default, so a
     partially edited content.json can never break the page.                 */
  function get(path) {
    var parts = String(path).split('.');
    var cur = dataBag && dataBag.content;
    for (var i = 0; cur != null && i < parts.length; i++) cur = cur[parts[i]];
    if (cur !== undefined && cur !== null) return cur;
    if (CONTENT_DEFAULTS[path] === undefined && !contentWarned[path]) {
      contentWarned[path] = true;
      console.warn(TAG + 'content.json has no "' + path + '" — using the built-in default.');
    }
    return CONTENT_DEFAULTS[path];
  }

  /* one tiny placeholder formatter: {siteName}, {year}, {n}, … */
  function format(str, vars) {
    return String(str == null ? '' : str).replace(/\{(\w+)\}/g, function (m, key) {
      return vars && vars[key] !== undefined ? String(vars[key]) : m;
    });
  }

  /* plural-aware count string from content.json */
  function countLabel(path, n) {
    return format(n === 1 ? get(path + '.one') : get(path + '.other'), { n: n });
  }

  /* ---------------- data-driven ordering (§15) ----------------
     New first (dateAdded DESC, ties: later in the data), then the
     rest (priority DESC, then name A-Z). No manual order numbers. */
  function daysSince(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return Infinity;
    return Math.floor((new Date().getTime() - d.getTime()) / 86400000);
  }

  function isNew(site) {
    if (!site || site.new !== true) return false;
    var max = S ? S.newMaxAgeDays : null;
    if (max === null || max === undefined) return true;
    return daysSince(site.dateAdded) <= max;
  }

  function compareNew(a, b) {
    var da = String(a.dateAdded || ''), db = String(b.dateAdded || '');
    if (da !== db) return da < db ? 1 : -1;      // dateAdded DESC
    return (b._index || 0) - (a._index || 0);    // later in the data wins
  }

  function compareNormal(a, b) {
    var pa = typeof a.priority === 'number' ? a.priority : 0;
    var pb = typeof b.priority === 'number' ? b.priority : 0;
    if (pa !== pb) return pb - pa;               // priority DESC (missing = 0)
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  }

  function directoryOrder(list) {
    var fresh = [], rest = [];
    (list || []).forEach(function (s) { (isNew(s) ? fresh : rest).push(s); });
    fresh.sort(compareNew);
    rest.sort(compareNormal);
    return fresh.concat(rest);
  }

  function sortByName(list) {
    return (list || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
  }

  function sortByNewest(list) {
    return (list || []).slice().sort(function (a, b) {
      var da = String(a.dateAdded || ''), db = String(b.dateAdded || '');
      if (da !== db) return da < db ? 1 : -1;
      return (b._index || 0) - (a._index || 0);
    });
  }

  /* ---------------- search (§10) ---------------- */
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function searchTokens(query) {
    return normalize(query).split(' ').filter(Boolean);
  }

  function wordPrefixMatch(text, token) {
    var words = normalize(text).split(/[\s,;|&+()]+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(token) === 0) return true;
    }
    return false;
  }

  /* Score: name exact 100 > name prefix 60 > name contains 40 >
     tag 30 > tag prefix 20 > category 15 > description 5.
     Every token must match something or the site is dropped. */
  function scoreSite(site, tokens) {
    var name = normalize(site.name);
    var tags = (site.tags || []).map(normalize).filter(Boolean);
    var cat = CAT_BY_SLUG[site.category];
    var catName = cat ? cat.name : '';
    var desc = normalize(site.description || '');
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var best = 0;
      if (name === t) best = 100;
      else if (name.indexOf(t) === 0) best = 60;
      else if (t.length >= 3 && name.indexOf(t) !== -1) best = 40;
      for (var j = 0; j < tags.length; j++) {
        if (tags[j] === t) { if (best < 30) best = 30; }
        else if (tags[j].indexOf(t) === 0) { if (best < 20) best = 20; }
      }
      if (catName && wordPrefixMatch(catName, t) && best < 15) best = 15;
      if (wordPrefixMatch(desc, t) && best < 5) best = 5;
      if (best === 0) return 0; // every token must match
      total += best;
    }
    return total;
  }

  function searchSites(query, list) {
    list = list || SITES;
    var tokens = searchTokens(query);
    if (!tokens.length) return directoryOrder(list);
    var rank = {};
    directoryOrder(list).forEach(function (s, i) { rank[s.slug] = i; });
    var hits = [];
    list.forEach(function (s) {
      var sc = scoreSite(s, tokens);
      if (sc > 0) hits.push({ site: s, score: sc });
    });
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (rank[a.site.slug] || 0) - (rank[b.site.slug] || 0); // ties -> Directory Order
    });
    return hits.map(function (h) { return h.site; });
  }

  /* ---------------- URLs ----------------
     Every internal link is built here. All four pages sit in one
     folder, so these bare filenames resolve from anywhere.       */
  function qs(params) {
    var p = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        p.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    });
    return p.length ? '?' + p.join('&') : '';
  }

  var url = {
    home: function () { return 'index.html'; },
    browse: function (params) { return 'browse.html' + qs(params); },
    /* explore view is plain browse.html */
    explore: function (params) { return url.browse(params); },
    categories: function () { return 'browse.html?view=categories'; },
    category: function (slug) { return 'browse.html' + qs({ c: slug }); },
    site: function (slug) { return 'site.html' + qs({ s: slug }); },
    /* about.html hosts about / contact / privacy / terms */
    doc: function (name) { return 'about.html' + qs({ p: name === 'about' ? '' : name }); },
    notFound: function () { return 'browse.html?notfound=1'; }
  };

  /* "/images/x.png" only resolves at a domain root, so a leading slash is
     trimmed: asset paths stay relative and work in any subfolder. */
  function assetUrl(p) {
    if (!p) return '';
    p = String(p);
    return p.charAt(0) === '/' && p.charAt(1) !== '/' ? p.slice(1) : p;
  }

  /* Absolute URL, only for canonical / Open Graph / JSON-LD. */
  function absUrl(path) {
    var base = (S && S.siteUrl) || 'https://example.com';
    base = String(base).replace(/\/+$/, '');
    if (path.charAt(0) !== '/') path = '/' + path;
    return base + path;
  }

  /* ---------------- SEO helpers ---------------- */
  function headEl(sel, tag) {
    var el = document.querySelector(sel);
    if (!el) { el = document.createElement(tag); document.head.appendChild(el); }
    return el;
  }
  function setMetaTag(attr, key, content) {
    var m = headEl('meta[' + attr + '="' + key + '"]', 'meta');
    if (!m.hasAttribute(attr)) m.setAttribute(attr, key);
    m.setAttribute('content', content);
  }

  function updateMeta(title, description, canonicalPath, noindex) {
    document.title = title;
    setMetaTag('property', 'og:title', title);
    setMetaTag('name', 'twitter:title', title);
    if (description) {
      [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]
        .forEach(function (k) { setMetaTag(k[0], k[1], description); });
    }
    if (canonicalPath != null) {
      var c = headEl('link[rel="canonical"]', 'link');
      c.href = absUrl(canonicalPath);
      setMetaTag('property', 'og:url', absUrl(canonicalPath));
    }
    var r = document.querySelector('meta[name="robots"]');
    if (noindex) {
      r = r || headEl('meta[name="robots"]', 'meta');
      if (!r.hasAttribute('name')) r.name = 'robots';
      r.content = 'noindex, follow';
    } else if (r) {
      r.remove();
    }
  }

  function setJSONLD(obj) {
    var s = headEl('#fw-jsonld', 'script');
    if (!s.id) { s.id = 'fw-jsonld'; s.type = 'application/ld+json'; }
    /* an array becomes a single @graph document, the form validators expect */
    s.textContent = JSON.stringify(Array.isArray(obj)
      ? { '@context': 'https://schema.org', '@graph': obj.map(function (o) {
          var c = {}; Object.keys(o).forEach(function (k) { if (k !== '@context') c[k] = o[k]; }); return c;
        }) }
      : obj);
  }

  /* ---------------- badge (§16) — data-driven, one function ---------------- */
  function badgeInfo(site) {
    var raw = site && site.badge;
    if (!raw) return null;
    return BADGE_MAP[String(raw).toUpperCase()] || { label: raw, style: 'neutral' };
  }

  function renderBadge(site) {
    var def = badgeInfo(site);
    if (!def) return '';
    return '<span class="badge badge--' + esc(def.style) + '">' + esc(def.label) + '</span>';
  }

  /* ---------------- logo + card (§9) ---------------- */
  function initialOf(name) {
    var n = String(name || '').trim();
    return n ? n.charAt(0).toUpperCase() : '?';
  }

  /* Tint is derived from the site's category, so a site always gets the same
     colour: deterministic, never random, never more than the four tints. */
  /* a logo file that is missing (or blocked) reveals the tinted monogram
     underneath; the box keeps its size, so nothing shifts */
  function logoFail(img) {
    var box = img.parentNode;
    if (box && box.getAttribute('data-fw-logo') !== null) {
      box.className = 'logo logo--' + (box.getAttribute('data-fw-tint') || '1') +
        (box.classList.contains('logo--lg') ? ' logo--lg' : '');
    }
    img.parentNode && img.parentNode.removeChild(img);
  }

  function tintForSite(site) {
    var cat = CAT_BY_SLUG[site && site.category];
    if (cat && cat.tint) return Number(cat.tint);
    var key = String((site && site.category) || '');
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
    return (h % 4) + 1;
  }

  function logoHTML(site, opts) {
    opts = opts || {};
    var cls = 'logo' + (opts.large ? ' logo--lg' : '');
    var tint = ' logo--' + tintForSite(site);
    var mono = '<span class="logo__mono" aria-hidden="true">' + esc(initialOf(site.name)) + '</span>';
    /* the monogram sits underneath the image: if the logo is missing or the
       file fails to load, the tinted monogram is what remains. Either way the
       box is the same size, so a broken image can never change card height. */
    var tintAttr = ' data-fw-tint="' + tintForSite(site) + '"';
    if (!site.logo) return '<span class="' + cls + tint + '" data-fw-logo>' + mono + '</span>';
    /* .has-logo hides the monogram underneath, so the fallback letter can
       never render on top of a real image; logoFail() removes it when the
       image fails, which reveals the monogram again. */
    return '<span class="' + cls + ' has-logo" data-fw-logo' + tintAttr + '>' +
      '<img class="logo__img" src="' + esc(assetUrl(site.logo)) + '" loading="lazy" decoding="async" alt="" ' +
      'onerror="FW_LOGO_FAIL(this)">' +
      mono +
      '</span>';
  }

  function renderCard(site, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var cat = CAT_BY_SLUG[site.category];
    var catIcon = 'i-' + String((cat && cat.icon) || 'layers').replace(/^i-/, '');
    var rel = (S && S.externalLinkRel) || 'noopener noreferrer';
    var href = url.site(site.slug);
    var rating = '';
    if (site.rating !== null && site.rating !== undefined && site.rating !== '' && !isNaN(+site.rating)) {
      rating = '<span class="card__rating" aria-label="Rated ' + (+site.rating) +
        ' out of 5">&#9733; ' + (+site.rating) + '</span>';
    }
    /* One overlay link makes the whole card open the info page; the visit
       button sits above it. No nested anchors. */
    var meta = compact
      ? ''
      : '<div class="card__meta">' +
          '<span class="card__cat">' + icon(catIcon) + '<span>' + esc(cat ? cat.name : 'Uncategorized') + '</span></span>' +
          '<span class="card__right">' + rating +
            '<a class="card__visit" href="' + esc(site.url) + '" target="_blank" rel="' + esc(rel) +
              '" title="' + esc(get('ui.visitWebsite')) + '" aria-label="Visit ' + esc(site.name) +
              ' (opens in new tab)">' + icon('i-external-link') + '</a>' +
          '</span>' +
        '</div>';
    return '<article class="card' + (compact ? ' card--compact' : '') + '">' +
      '<div class="card__top">' +
        logoHTML(site) +
        '<span class="card__head">' +
          '<span class="card__name" data-fw-name>' + esc(site.name) + '</span>' +
          '<span class="card__desc">' + esc(site.description) + '</span>' +
        '</span>' +
        renderBadge(site) +
      '</div>' +
      (compact
        ? '<div class="card__meta">' +
            '<span class="card__right">' + rating +
              '<a class="card__visit" href="' + esc(site.url) + '" target="_blank" rel="' + esc(rel) +
                '" title="' + esc(get('ui.visitWebsite')) + '" aria-label="Visit ' + esc(site.name) +
                ' (opens in new tab)">' + icon('i-external-link') + '</a>' +
            '</span>' +
          '</div>'
        : meta) +
      '<a class="card__link" href="' + esc(href) + '" aria-label="' + esc(site.name) + '">' +
        '<span class="sr-only">' + esc(site.name) + '</span></a>' +
    '</article>';
  }

  /* Category tile — count computed from the data, never stored */
  function renderTile(cat) {
    var n = SITES.filter(function (s) { return s.category === cat.slug; }).length;
    var tint = cat.tint ? ' tint-' + esc(cat.tint) : '';
    /* The icon is an outline symbol on a 24px grid, named by categories.json
       ("icon", e.g. "sparkles"); the tile colour comes from "tint" (1-4). */
    var name = String(cat.icon || 'layers').replace(/^i-/, '');
    return '<a class="cat-tile" href="' + esc(url.category(cat.slug)) + '">' +
      '<span class="cat-tile__icon' + tint + '" aria-hidden="true">' + icon('i-' + name) + '</span>' +
      '<span class="cat-tile__text">' +
        '<span class="cat-tile__name" title="' + esc(cat.name) + '">' + esc(cat.name) + '</span>' +
        '<span class="cat-tile__count">' + countLabel('ui.sitesCount', n) + '</span>' +
      '</span>' +
      icon('i-chevron-right', 'cat-tile__chev') +
    '</a>';
  }

  function popularChipsHTML() {
    return ((S && S.popularSearches) || []).map(function (c) {
      var cat = c.category ? CAT_BY_SLUG[c.category] : null;
      var href = c.category ? url.category(c.category) : url.explore({ q: c.query || c.label || '' });
      var ic = cat ? icon('i-' + String(cat.icon || 'layers').replace(/^i-/, '')) : icon('i-search');
      return '<a class="chip" href="' + esc(href) + '">' + ic + esc(c.label) + '</a>';
    }).join('');
  }

  /* ---------------- hero copy, typing, facts, highlights ----------------
     The static HTML already carries the default sentence and placeholder, so
     a script-blocked or no-JS render still looks finished; this enhances it
     from data/content.json. */
  /* Reserve the longest word's width on the .typed-group wrapper (word and
     caret measured together), so the headline does not jitter while typing.
     The group stays one atomic inline unit: it can still wrap to the next
     line as a whole when the screen is narrow, and the caret can never be
     separated from the word. Nothing is measured or reserved on the bare
     .typed span, which would let the caret wrap onto its own line. */
  function reserveWidth(group, words) {
    if (!group || !words || !words.length || !group.offsetWidth) return;
    var typed = group.querySelector('[data-typed]');
    if (!typed) return;
    var longest = words.reduce(function (a, b) { return String(b).length > String(a).length ? b : a; }, words[0]);
    var now = typed.textContent;
    typed.textContent = longest;
    var w = group.offsetWidth;
    typed.textContent = now;
    if (w) group.style.minWidth = w + 'px';
  }

  function initHeroContent() {
    initShell();
    var hero = $('[data-hero]');
    if (!hero) return;

    var eyebrow = $('[data-hero-eyebrow]', hero);
    if (eyebrow) eyebrow.textContent = get('hero.eyebrow');

    var title = $('[data-hero-title]', hero);
    var typed = $('[data-typed]', title || hero);
    var words = get('hero.typing.words') || ['websites'];
    var typing = get('hero.typing') || {};
    if (typed) {
      reserveWidth(typed.closest ? (typed.closest('.typed-group') || typed.parentNode) : typed.parentNode, words);
      typed.textContent = words[0];
    }
    if (title) {
      title.setAttribute('aria-label',
        get('hero.titleParts.before') + words[0] + get('hero.titleParts.after'));
    }
    if (typed && typing.enabled !== false) {
      typewriter(typed, {
        words: words,
        typeSpeedMs: typing.typeSpeedMs,
        deleteSpeedMs: typing.deleteSpeedMs,
        holdMs: typing.holdMs,
        gapMs: typing.gapMs
      });
    }

    var sub = $('[data-hero-subtitle]', hero);
    if (sub) sub.textContent = get('hero.subtitle');
    var label = $('[data-popular-label]', hero);
    if (label) label.textContent = get('hero.popularLabel');
    var ph = get('hero.search.placeholder') || 'Search websites, tools, and resources...';
    var input = $('#hero-search');
    if (input) input.setAttribute('placeholder', ph);

    /* animated placeholder: types through content.json phrases, then stops for
       good the moment the visitor focuses the field or starts typing */
    var anim = get('hero.search.animatedPlaceholder') || {};
    if (input && anim.enabled !== false && anim.phrases && anim.phrases.length) {
      var prompt = typewriter(input, {
        words: anim.phrases, attribute: 'placeholder',
        typeSpeedMs: 42, deleteSpeedMs: 20, holdMs: 1700, gapMs: 260
      });
      if (prompt) {
        var stopPrompt = function () {
          prompt.pause();
          input.setAttribute('placeholder', ph);
        };
        input.addEventListener('focus', stopPrompt);
        input.addEventListener('input', stopPrompt);
      }
    }

    /* live facts row — computed from the data, never hard-coded */
    var facts = $('[data-hero-facts]', hero);
    if (facts) {
      var fc = get('hero.facts') || {};
      if (fc.enabled === false || SITES.length < (fc.minSites || 0)) {
        facts.remove();
      } else {
        var latest = SITES.reduce(function (a, st) {
          return String(st.dateAdded || '') > a ? String(st.dateAdded) : a;
        }, '');
        var when = latest ? new Date(latest + 'T00:00:00').toLocaleDateString('en-US',
          { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        var html = format(String(fc.template), {
          sites: '<b>' + SITES.length + '</b>',
          categories: '<b>' + CATEGORIES.length + '</b>',
          updated: '<b>' + esc(when) + '</b>'
        });
        facts.innerHTML = html.split(' · ').join('<span class="dot" aria-hidden="true"></span>');
      }
    }

    var hi = $('[data-hero-highlights]', hero);
    if (hi) {
      var hc = get('hero.highlights') || {};
      if (hc.enabled === false || !hc.items || !hc.items.length) hi.remove();
      else {
        hi.innerHTML = hc.items.slice(0, 3).map(function (item) {
          return '<li>' + icon('i-' + String(item.icon || 'layers')) + esc(item.text) + '</li>';
        }).join('');
      }
    }

    /* the "/" shortcut and the hint that advertises it */
    var kbd = $('[data-search-kbd]', hero);
    var form = $('.search', hero);
    if (form && input) {
      form.classList.toggle('is-typed', !!input.value);
      input.addEventListener('input', function () { form.classList.toggle('is-typed', !!input.value); });
    }
    var hint = get('hero.search.shortcutHint') || '/';
    if (kbd) kbd.textContent = hint;
    if (hint && input) {
      document.addEventListener('keydown', function (e) {
        var tag = ((e.target && e.target.tagName) || '').toLowerCase();
        if (e.key === hint && !/input|textarea|select/.test(tag) && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          input.focus();
        }
      });
    }
  }

  /* ---------------- error state ---------------- */
  function showErrorState() {
    var main = document.getElementById('main-content');
    if (!main) return;
    /* Opened from disk, browsers refuse to read local JSON at all — a browser
       rule, not a fault in the data — so say exactly what to do about it. */
    var help = typeof location !== 'undefined' && location.protocol === 'file:'
      ? 'Browsers cannot read local JSON from a double-clicked page. Serve the folder instead ' +
        '(<code>python3 -m http.server</code>) and open <code>http://localhost:8000/</code>.'
      : 'Could not load (' + esc(dataError || 'no response') + '). Check that the three JSON ' +
        'files in <code>data/</code> are next to <code>index.html</code>.';
    var div = document.createElement('div');
    div.className = 'error-state';
    div.setAttribute('role', 'alert');
    div.innerHTML = '<h2 class="error-state__title">Couldn\'t load the directory data.</h2>' +
      '<p>' + help + ' Then refresh the page.</p>';
    main.innerHTML = '';
    main.appendChild(div);
  }

  /* ---------------- header ---------------- */
  /* The mark plus a two-weight live-text wordmark — one image, no dark-mode
     variant needed, and the words stay selectable and translatable. */
  function brandHTML() {
    var name = (S && S.siteName) || 'Findwebs';
    var parts = (S && S.logo && S.logo.wordmark && S.logo.wordmark.parts) || null;
    var word = parts && parts.length === 2
      ? '<b>' + esc(parts[0]) + '</b>' + esc(parts[1])
      : '<b>' + esc(name.slice(0, 4)) + '</b>' + esc(name.slice(4));
    var mark = (S && S.logo && S.logo.mark) || 'images/logo-mark.svg';
    return '<a class="brand" href="' + esc(url.home()) + '" aria-label="' + esc(name) + ' — home">' +
      '<span class="brand__mark"><img src="' + esc(assetUrl(mark)) + '" width="30" height="30" alt="" decoding="async"></span>' +
      '<span class="brand__name">' + word + '</span></a>';
  }

  function renderHeader() {
    var mount = document.getElementById('fw-header');
    if (!mount) return;
    var page = document.body.getAttribute('data-page') || '';
    var name = (S && S.siteName) || 'Findwebs';
    var menuLink = function (href, label, key, current) {
      var on = key === current;
      return '<a class="' + (on ? 'is-active' : '') + '"' + (on ? ' aria-current="page"' : '') +
        ' href="' + esc(href) + '">' + esc(label) + '</a>';
    };
    var navLink = function (href, label, on) {
      return '<a class="site-nav__link' + (on ? ' is-active' : '') + '"' + (on ? ' aria-current="page"' : '') +
        ' href="' + esc(href) + '">' + esc(label) + '</a>';
    };
    /* the header search and the mobile-panel search are one form, twice */
    var searchForm = function (ns, submit) {
      var id = 'fw-' + ns + '-search', sug = id.replace('-search', '-suggest');
      return '<form class="' + ns + '" role="search" action="' + esc(url.explore()) + '" method="get">' +
        '<label class="sr-only" for="' + id + '">Search websites</label>' +
        '<span class="header-search__icon" aria-hidden="true">' + icon('i-search') + '</span>' +
        '<input id="' + id + '" class="' + ns + '__input" type="search" name="q"' +
          ' placeholder="Search websites, tools, and resources..." autocomplete="off"' +
          ' role="combobox" aria-expanded="false" aria-controls="' + sug + '" aria-autocomplete="list">' +
        submit +
        '<div class="suggest" id="' + sug + '" role="listbox" hidden></div>' +
      '</form>';
    };

    mount.innerHTML =
      '<header class="site-header">' +
        '<div class="container site-header__inner">' +
          brandHTML() +
          '<nav class="site-nav" aria-label="Main">' +
            navLink(url.explore(), 'Explore', page === 'browse') +
            navLink(url.categories(), 'Categories', false) +
          '</nav>' +
          '<div class="site-tools">' +
            searchForm('header-search', '<button class="header-search__submit" type="submit" aria-label="Search">' + icon('i-search') + '</button>') +
            '<button type="button" class="icon-btn tool-search" aria-label="Open search">' + icon('i-search') + '</button>' +
            '<button type="button" class="icon-btn theme-toggle" aria-label="Switch to dark theme" aria-pressed="false">' +
              icon('i-moon', 'icon--moon') + icon('i-sun', 'icon--sun') +
            '</button>' +
            '<button type="button" class="icon-btn tool-menu" aria-label="Open menu" aria-expanded="false">' + icon('i-menu') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="mobile-panel" data-panel="search" hidden>' +
          '<div class="mobile-panel__inner">' +
            searchForm('mobile-search', '<button type="button" class="icon-btn" data-panel-close aria-label="Close search">' + icon('i-x') + '</button>') +
          '</div>' +
        '</div>' +
        '<div class="mobile-panel" data-panel="menu" hidden>' +
          '<div class="mobile-panel__inner">' +
            '<button type="button" class="icon-btn mobile-menu__close" data-panel-close aria-label="Close menu">' + icon('i-x') + '</button>' +
            '<nav class="mobile-menu" aria-label="Site">' +
              menuLink(url.home(), 'Home', 'home', page) +
              menuLink(url.explore(), 'Explore', 'browse', page) +
              menuLink(url.categories(), 'Categories', 'categories', page) +
              menuLink(url.doc('about'), 'About', 'about', page) +
              menuLink(url.doc('contact'), 'Contact', 'about', page) +
            '</nav>' +
          '</div>' +
        '</div>' +
      '</header>';
  }

  /* ---------------- footer ---------------- */
  /* Footer/nav links come from settings and may be written either as
     "about.html" or "about.html?p=terms"; both are already relative. */
  function normalizeHref(href) { return href || ''; }

  function renderFooter() {
    var mount = document.getElementById('fw-footer');
    if (!mount) return;
    var name = (S && S.siteName) || 'Findwebs';
    var year = (S && S.copyrightYear) || new Date().getFullYear();
    var tagline = get('footer.tagline') || (S && S.tagline) || '';
    var links = get('footer.links') || (S && S.footerLinks) || [];
    var vars = { year: year, siteName: name };
    var hrefs = { home: 'index.html' };
    mount.innerHTML =
      '<footer class="site-footer">' +
        '<div class="container site-footer__inner">' +
          '<div class="site-footer__brand">' +
            brandHTML() +
            '<p class="site-footer__tagline">' + esc(tagline) + '</p>' +
          '</div>' +
          '<nav class="site-footer__links" aria-label="Footer">' +
            links.map(function (link) {
              return '<a href="' + esc(normalizeHref(link.href)) + '">' + esc(link.label) + '</a>';
            }).join('') +
          '</nav>' +
        '</div>' +
        '<div class="container site-footer__bottom">' +
          '<span>' + esc(format(get('footer.copyright'), vars)) + '</span>' +
          '<span>' + esc(format(get('footer.note'), vars)) + '</span>' +
        '</div>' +
      '</footer>';
  }

  /* ---------------- ads (§7) — isolated in one function ---------------- */
  function mountAds() {
    $all('.ad-slot').forEach(function (el) {
      var key = el.getAttribute('data-ad-slot') || 'top';
      var ads = S && S.ads;
      var slot = ads && ads.enabled && ads.slots ? ads.slots[key] : null;
      if (!slot || slot.mode === 'off') {
        el.remove(); // no gap, page looks complete
        return;
      }
      var inner = $('.ad-slot__inner', el);
      if (!inner) return;
      if (slot.mode === 'live' && slot.html) {
        inner.innerHTML = slot.html;
        // re-create <script> nodes so injected code executes
        $all('script', inner).forEach(function (s) {
          var n = document.createElement('script');
          Array.prototype.forEach.call(s.attributes, function (a) {
            n.setAttribute(a.name, a.value);
          });
          n.textContent = s.textContent;
          s.parentNode.replaceChild(n, s);
        });
      } else if (ads.showPlaceholderText) {
        inner.innerHTML = '<span class="ad-slot__placeholder">Your ad here</span>';
      }
      /* mode "reserved" (default): leave the empty reserved box as-is */
    });
  }

  /* ---------------- theme (§4) ---------------- */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncThemeButton() {
    var btn = $('.theme-toggle');
    if (!btn) return;
    var dark = currentTheme() === 'dark';
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  function initTheme() {
    var btn = $('.theme-toggle');
    if (!btn) return;
    syncThemeButton();
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      var root = document.documentElement;
      root.classList.add('theme-anim');
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('findwebs-theme', next); } catch (e) { /* private mode */ }
      syncThemeButton();
      setTimeout(function () { root.classList.remove('theme-anim'); }, 200);
    });
  }

  /* ---------------- typing engine ----------------
     One engine drives the hero headline and the animated search placeholder.
     It writes to textContent, or to an attribute when `attribute` is set.
     Both callers pause it when the tab is hidden or the element is off-screen,
     and it never runs at all under prefers-reduced-motion. */
  function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function typewriter(el, opts) {
    if (!el || !opts || !opts.words || !opts.words.length) return null;
    var words = opts.words.slice();
    var typeMs = opts.typeSpeedMs || 65;
    var delMs = opts.deleteSpeedMs || 32;
    var holdMs = opts.holdMs || 1600;
    var gapMs = opts.gapMs == null ? 300 : opts.gapMs;
    var attr = opts.attribute || null;
    var i = 0, chars = 0, phase = 'type', timer = null, paused = false, visible = true, stopped = false;

    function write(text) {
      if (attr) el.setAttribute(attr, text);
      else el.textContent = text;
    }
    function step() {
      var word = words[i];
      if (phase === 'type') {
        chars++;
        write(word.slice(0, chars));
        if (chars >= word.length) { phase = 'hold'; timer = setTimeout(step, holdMs); return; }
        timer = setTimeout(step, typeMs);
      } else if (phase === 'hold') {
        phase = 'delete';
        timer = setTimeout(step, gapMs);
      } else {
        chars--;
        write(word.slice(0, chars));
        if (chars <= 0) {
          i = (i + 1) % words.length;
          phase = 'type';
          timer = setTimeout(step, gapMs);
          return;
        }
        timer = setTimeout(step, delMs);
      }
    }
    function schedule(delay) {
      timer = setTimeout(function () { timer = null; if (!paused && !stopped) step(); }, delay);
    }
    var api = {
      start: function () { if (!timer && !paused && !stopped) schedule(60); },
      pause: function () { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
      resume: function () { if (!stopped) return; stopped = false; api.start(); },
      isRunning: function () { return !!timer; }
    };
    if (reducedMotion()) { write(words[0]); return { start: function () {}, pause: function () {}, resume: function () {}, isRunning: function () { return false; } }; }
    if (attr) el.setAttribute(attr, words[0]);
    else el.textContent = words[0];
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        document.hidden ? api.pause() : api.resume();
      });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? api.resume() : api.pause();
      }, { threshold: 0 }).observe(el);
    }
    api.start();
    return api;
  }

  /* header gains its hairline + shadow only after the page moves */
  function initHeaderScroll() {
    var header = $('.site-header');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('is-scrolled', (window.scrollY || 0) > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* scroll reveal — one pass per element, gated on the .js class so nothing
     is ever left invisible when scripts do not run */
  function initReveal() {
    var nodes = $all('[data-reveal]');
    if (!nodes.length) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      nodes.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var group = $all('.card', el);
        (group.length ? group : [el]).forEach(function (child, i) {
          child.style.transitionDelay = Math.min(i, 8) * 40 + 'ms';
        });
        el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* the hero fades in as a short sequence */
  function initHeroLoad() {
    var seq = $all('.hero [data-hero-step]');
    if (!seq.length) return;
    if (reducedMotion()) { seq.forEach(function (n) { n.classList.add('is-in'); }); return; }
    seq.forEach(function (n, i) {
      n.style.transitionDelay = i * 60 + 'ms';
      requestAnimationFrame(function () { n.classList.add('is-in'); });
    });
  }

  /* first render: apply the theme accents from settings, mark the document
     as script-enabled, then start the motion systems */
  function initShell() {
    var root = document.documentElement;
    var t = (S && S.theme) || {};
    if (t.accent) root.style.setProperty('--accent', t.accent);
    if (t.accentDark && currentTheme() === 'dark') root.style.setProperty('--accent', t.accentDark);
    root.classList.add('js');
    initHeaderScroll();
  }

  /* ---------------- suggestion dropdown (combobox / listbox) ---------------- */
  function attachSuggest(form, input, suggestEl) {
    if (!form || !input || !suggestEl) return;
    var timer = null;
    var active = -1;
    var items = [];

    function close() {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
      items = [];
    }

    function highlight(i) {
      var kids = suggestEl.children;
      for (var k = 0; k < kids.length; k++) {
        kids[k].classList.toggle('is-active', k === i);
        kids[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      }
      input.setAttribute('aria-activedescendant', i >= 0 && kids[i] ? kids[i].id : '');
    }

    function goSite(site) { window.location.href = url.site(site.slug); }
    function goAll() { window.location.href = url.explore({ q: input.value.trim() }); }

    function run() {
      var q = input.value;
      if (!q || !q.trim()) { close(); return; }
      var results = searchSites(q, SITES).slice(0, 6);
      if (!results.length) { close(); return; }
      items = results;
      var html = results.map(function (s, i) {
        var cat = CAT_BY_SLUG[s.category];
        return '<div class="suggest__item" id="sugg-' + i + '" role="option" data-i="' + i + '" aria-selected="false">' +
          logoHTML(s, 24) +
          '<span class="suggest__text">' +
            '<span class="suggest__name">' + esc(s.name) + '</span>' +
            '<span class="suggest__cat">' + esc(cat ? cat.name : '') + '</span>' +
          '</span>' +
        '</div>';
      }).join('');
      html += '<div class="suggest__all" id="sugg-all" role="option" aria-selected="false">' +
        icon('i-search') + '<span>See all results for \u201C' + esc(q.trim()) + '\u201D</span></div>';
      suggestEl.innerHTML = html;
      suggestEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 120);
    });
    input.addEventListener('focus', function () { if (input.value.trim()) run(); });

    input.addEventListener('keydown', function (e) {
      var open = !suggestEl.hidden;
      var n = suggestEl.children.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!open || !n) return;
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        highlight(active);
        var el = suggestEl.children[active];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (open && active >= 0) {
          e.preventDefault();
          if (suggestEl.children[active].id === 'sugg-all') goAll();
          else goSite(items[active]);
        }
        /* Enter with nothing highlighted submits the form -> browse.html?q= */
      } else if (e.key === 'Escape') {
        close();
      }
    });

    suggestEl.addEventListener('mousedown', function (e) {
      var item = e.target.closest ? e.target.closest('.suggest__item') : null;
      var all = e.target.closest ? e.target.closest('.suggest__all') : null;
      if (item) {
        e.preventDefault();
        goSite(items[+item.getAttribute('data-i')]);
      } else if (all) {
        e.preventDefault();
        goAll();
      }
    });

    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }

  /* ---------------- mobile panels (search / menu) ---------------- */
  function initPanels() {
    var header = $('.site-header');
    if (!header) return;
    var searchBtn = $('.tool-search', header);
    var menuBtn = $('.tool-menu', header);
    var openPanel = null;
    var lastFocus = null;

    function closePanel(returnFocus) {
      if (!openPanel) return;
      var p = openPanel;
      openPanel = null;
      p.classList.remove('is-open');
      setTimeout(function () {
        if (!p.classList.contains('is-open')) p.hidden = true;
      }, 160);
      [searchBtn, menuBtn].forEach(function (b) { if (b) b.setAttribute('aria-expanded', 'false'); });
      if (returnFocus && lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function openPanelEl(panel, trigger) {
      closePanel(false);
      openPanel = panel;
      lastFocus = trigger;
      panel.hidden = false;
      void panel.offsetHeight; // reflow, then animate
      panel.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      var focusEl = panel.querySelector('input') || panel.querySelector('a, button');
      if (focusEl) setTimeout(function () { focusEl.focus(); }, 30);
    }

    function onKeyDown(e) {
      if (!openPanel) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel(true);
        return;
      }
      if (e.key === 'Tab') {
        var focusables = $all('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])', openPanel);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var activeEl = document.activeElement;
        var inPanel = openPanel.contains(activeEl);
        if (e.shiftKey && (!inPanel || activeEl === first)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inPanel || activeEl === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    if (searchBtn) searchBtn.addEventListener('click', function () {
      if (openPanel) { closePanel(true); return; }
      openPanelEl(header.querySelector('[data-panel="search"]'), searchBtn);
    });
    if (menuBtn) menuBtn.addEventListener('click', function () {
      if (openPanel) { closePanel(true); return; }
      openPanelEl(header.querySelector('[data-panel="menu"]'), menuBtn);
    });
    $all('[data-panel-close]', header).forEach(function (b) {
      b.addEventListener('click', function () { closePanel(true); });
    });
    $all('.mobile-menu a', header).forEach(function (a) {
      a.addEventListener('click', function () { closePanel(false); });
    });
    document.addEventListener('keydown', onKeyDown);
  }

  /* Homepage: reveal the header search once the hero search scrolls out */
  function initHeroSearchReveal() {
    var headerSearch = $('.header-search');
    var heroSearch = $('[data-hero-search]');
    if (!headerSearch || !heroSearch) return;
    if (typeof IntersectionObserver === 'undefined') {
      headerSearch.classList.add('is-revealed');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        headerSearch.classList.toggle('is-revealed', !en.isIntersecting);
      });
    }, { threshold: 0 });
    io.observe(heroSearch);
  }

  function initHeaderSearch() {
    attachSuggest($('.header-search'), $('#fw-header-search'), $('#fw-header-suggest'));
    attachSuggest($('.mobile-search'), $('#fw-mobile-search'), $('#fw-mobile-suggest'));
    attachSuggest($('[data-hero-search]'), $('#hero-search'), $('#hero-suggest'));
    attachSuggest($('[data-page-search]'), $('#page-search'), $('#page-suggest'));
    initPanels();
    initHeroSearchReveal();
  }

  /* ---------------- boot ----------------
     The data/*.js files ran before this one, so everything renders
     in one synchronous pass: no loading state, no skeleton.        */
  var booted = false;

  function init() {
    if (booted) return;   /* the inline call at the end of <body> runs first;
                             this keeps a second DOMContentLoaded call a no-op */
    booted = true;
    readData();
    initShell();
    renderHeader();
    renderFooter();
    if (dataFailed) {
      mountAds();
      initTheme();
      initHeaderSearch();
      showErrorState();
      return;
    }
    /* the homepage's sections come from JSON; other pages build their own
       markup and only need the shared pieces below */
    if (document.getElementById('fw-home')) renderHomeSections();
    mountAds();
    initTheme();
    initHeaderSearch();
    initHeroContent();
    var page = document.body.getAttribute('data-page') || '';
    if (window.FW_PAGES && typeof window.FW_PAGES[page] === 'function') {
      window.FW_PAGES[page]();
    }
    initHeroLoad();
    initReveal();
  }

  /* ---------------- homepage, rendered from content.json ----------------
     Sections come from homepage.sections in the order given. Reordering,
     disabling or adding a section is a JSON edit — no code change. An unknown
     type is skipped with a warning. */
  var SECTION_RENDERERS = {
    categories: function (sec) {
      if (!CATEGORIES.length) return '';
      var grid = '<div class="cat-grid">' + CATEGORIES.map(renderTile).join('') + '</div>';
      return sectionShell(sec, grid, CATEGORIES.length);
    },
    featured: function (sec) {
      var list = directoryOrder(SITES.filter(function (s) { return s.featured === true; }))
        .slice(0, sec.count || 8);
      return list.length ? sectionShell(sec, '<div class="card-grid card-grid--snap">' + list.map(function (s) { return renderCard(s); }).join('') + '</div>') : '';
    },
    recent: function (sec) {
      var list = directoryOrder(SITES.filter(isNew)).slice(0, sec.count || 4);
      if (!list.length) return '';
      var grid = '<div class="card-grid card-grid--snap" data-snap>' +
        list.map(function (s) { return renderCard(s); }).join('') + '</div>';
      /* the band is what gives the page rhythm: only this section sits on it */
      return '<section class="section section--band" id="recent-section" data-reveal>' +
        '<div class="section__inner container">' + sectionHead(sec, list.length) + grid + '</div></section>';
    },
    trending: function (sec) {
      var shown = {};
      directoryOrder(SITES.filter(function (s) { return s.featured === true; }))
        .slice(0, 8).forEach(function (s) { shown[s.slug] = true; });
      directoryOrder(SITES.filter(isNew)).slice(0, 4)
        .forEach(function (s) { shown[s.slug] = true; });
      var list = directoryOrder(SITES.filter(function (s) {
        return s.trending === true && !shown[s.slug];
      })).slice(0, sec.count || 6);
      if (!list.length) return '';
      var grid = '<div class="card-grid card-grid--compact card-grid--snap" data-snap>' +
        list.map(function (s) { return renderCard(s, { compact: true }); }).join('') + '</div>';
      return sectionShell(sec, grid, list.length);
    },
    cta: function (sec) {
      return '<div class="cta-center"><a class="btn" href="' + esc(sec.href || url.explore()) + '">' +
        esc(sec.label || 'Explore All Websites') + icon('i-arrow-right') + '</a></div>';
    },
    ad: function (sec) {
      return adSlotHTML(sec.slot || 'top', sec.slot === 'mid');
    },
    hero: function () { return ''; }
  };

  function sectionHead(sec, count) {
    var link = sec.viewAll && sec.viewAll.label
      ? '<a class="section__link" href="' + esc(sec.viewAll.href || url.explore()) + '">' +
        esc(sec.viewAll.label) + icon('i-arrow-right') + '</a>' : '';
    return '<div class="section__head">' +
      '<div>' +
        '<h2 class="section__title">' + esc(sec.title || '') +
          (count != null ? '<span class="section__count">' + count + '</span>' : '') + '</h2>' +
        (sec.subtitle ? '<p class="section__sub">' + esc(sec.subtitle) + '</p>' : '') +
      '</div>' + link +
    '</div>';
  }

  function sectionShell(sec, body, count) {
    return '<section class="section" id="' + esc(sec.type) + '-section" data-reveal>' +
      '<div class="section__inner container" data-fw-inner>' + sectionHead(sec, count) + body + '</div>' +
    '</section>';
  }

  function renderHomeSections() {
    var host = document.getElementById('fw-home');
    if (!host) return;
    /* The hero and category explorer are written as static markup (they are
       the parts that must exist without scripts). They are detached here and
       re-inserted wherever content.json places them, so the order stays a
       JSON decision while the markup is never duplicated. */
    var heroBlock = document.querySelector('[data-hero-block]');
    var catBlock = document.querySelector('.cat-explorer');
    if (heroBlock && heroBlock.parentNode) heroBlock.parentNode.removeChild(heroBlock);
    if (catBlock && catBlock.parentNode) catBlock.parentNode.removeChild(catBlock);

    var sections = get('homepage.sections') || [];
    var nodes = [];
    sections.forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      if (!SECTION_RENDERERS[sec.type]) {
        console.warn(TAG + 'homepage.sections: unknown type "' + sec.type + '" — skipped.');
        return;
      }
      if (sec.enabled === false) return;
      if (sec.type === 'hero') {
        if (heroBlock) nodes.push(heroBlock);
        return;
      }
      if (sec.type === 'categories') {
        /* the tiles live in the markup already (so the page is complete
           without scripts); this refreshes the heading and the grid, then
           places the section wherever content.json asks for it */
        if (catBlock) {
          var head = $('.section__head', catBlock);
          if (head) {
            var fresh = document.createElement('div');
            fresh.innerHTML = sectionHead(sec, CATEGORIES.length);
            head.parentNode.replaceChild(fresh.firstChild, head);
          }
          var cgrid = $('#category-grid', catBlock);
          if (cgrid) cgrid.innerHTML = CATEGORIES.map(renderTile).join('');
          nodes.push(catBlock);
        }
        return;
      }
      var html = SECTION_RENDERERS[sec.type](sec);
      if (!html) return;
      var holder = document.createElement('div');
      holder.innerHTML = html;
      while (holder.firstChild) nodes.push(holder.removeChild(holder.firstChild));
    });

    /* a section that is switched off in content.json is simply not placed,
       which is what removes the static defaults from the page */

    host.innerHTML = '';
    nodes.forEach(function (node) { host.appendChild(node); });
  }

  /* the canonical ad markup, so the slot CSS and mountAds() stay in one place */
  function adSlotHTML(slot, isMid) {
    return '<aside class="ad-slot' + (isMid ? ' ad-slot--mid' : '') + '" data-ad-slot="' + esc(slot) + '" ' +
      'aria-label="Advertisement"><span class="ad-slot__label">Advertisement</span>' +
      '<div class="ad-slot__inner"></div></aside>';
  }

  /* ---------------- public API (used by pages.js) ---------------- */
  function cfg(path, fallback) {
    var parts = path.split('.');
    var cur = S;
    for (var i = 0; i < parts.length && cur; i++) cur = cur[parts[i]];
    return (cur === undefined || cur === null) ? fallback : cur;
  }

  var FW = {
    boot: init,
    loadData: loadData,
    ready: ready,
    get settings() { return S; },
    get sites() { return SITES; },
    get categories() { return CATEGORIES; },
    /* getters, not captured objects: readData() builds fresh lookup maps */
    get catBySlug() { return CAT_BY_SLUG; },
    get siteBySlug() { return SITE_BY_SLUG; },
    isNew: isNew,
    directoryOrder: directoryOrder,
    sortByName: sortByName,
    sortByNewest: sortByNewest,
    normalize: normalize,
    searchSites: searchSites,
    renderCard: renderCard,
    renderBadge: renderBadge,
    renderTile: renderTile,
    logoHTML: logoHTML,
    popularChipsHTML: popularChipsHTML,
    url: url,
    absUrl: absUrl,
    assetUrl: assetUrl,
    qs: qs,
    updateMeta: updateMeta,
    setJSONLD: setJSONLD,
    esc: esc,
    icon: icon,
    cfg: cfg,
    get: get,
    format: format,
    countLabel: countLabel,
    adSlotHTML: adSlotHTML,
    renderHomeSections: renderHomeSections,
    reserveWidth: reserveWidth,
    initShell: initShell
    /* internal test hook (not UI): lets logic tests inject settings */
  };
  /* Test hook: install settings the way an edit to data/settings.json would,
     then FW.boot() re-renders. Used by the ad-mode and ordering checks. */
  FW._setSettingsForTest = function (s) {
    S = s;
    if (dataBag) dataBag.settings = s;
    booted = false;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FW;
  }
  if (typeof window !== 'undefined') {
    window.FW = FW;
    /* used by the inline onerror on site logos */
    window.FW_LOGO_FAIL = logoFail;
  }

  /* Every page boots through FW.ready(...) so nothing renders — or errors —
     before the JSON has settled. This listener covers a page built without
     that call; init() is idempotent, so whichever runs first wins. */
  if (typeof document !== 'undefined') {
    var fallbackBoot = function () { ready(init); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fallbackBoot);
    } else {
      fallbackBoot();
    }
  }
})();
