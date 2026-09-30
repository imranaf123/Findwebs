/* ============================================================
   Findwebs — pages.js — one renderer per <body data-page="…">:
   home (index.html), browse (explore / categories / category / search /
   not-found via ?c= ?view= ?q= ?notfound=), site (site.html?s=slug),
   about (about.html?p=…). Loaded after app.js; copy comes from
   data/content.json and records from data/sites.json.
   ============================================================ */
(function () {
  'use strict';

  window.FW_PAGES = window.FW_PAGES || {};
  var F = window.FW;

  function byId(id) { return document.getElementById(id); }
  function esc(s) { return F.esc(s); }
  function fill(id, html) { var el = byId(id); if (el) el.innerHTML = html; }
  function cards(list, opts) {
    return list.map(function (s) { return F.renderCard(s, opts); }).join('');
  }
  function dropSection(id) {
    var el = byId(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  /* author text from content.json, escaped for markup */
  function t(path, fallback) {
    var v = F.get(path);
    return v === undefined || v === null ? (fallback || '') : v;
  }
  function emptyHTML(title, hint, cta, h1) {
    return '<div class="empty">' +
      '<span class="empty__icon">' + F.icon('i-search') + '</span>' +
      '<' + (h1 ? 'h1' : 'p') + ' class="empty__title">' + esc(title) + '</' + (h1 ? 'h1' : 'p') + '>' +
      '<p class="empty__sub">' + esc(hint) + '</p>' + (cta || '') +
    '</div>';
  }

  /* ============ HOME — index.html ============
     The section list, the order, and which sections appear are decided by
     data/content.json → homepage.sections (rendered by app.js). The hero copy,
     typing words, facts row and highlights are filled in there too.        */
  window.FW_PAGES['home'] = function () {
    /* the hero + category explorer markup is static (so the page is complete
       without scripts); this fills their data-driven parts */
    var chips = byId('popular-chips');
    if (chips) chips.innerHTML = F.popularChipsHTML();
  };

  /* ============ BROWSE — browse.html. Four presentations, one file, all
     from the query string: (none) explore | ?view=categories | ?c=slug |
     ?q=… search | ?notfound=1 the 404 state. ========================== */
  window.FW_PAGES['browse'] = function () {
    var PAGE_SIZE = F.cfg('pagination.itemsPerPage', 12) || 12;
    var p = new URLSearchParams(location.search);
    var state = {
      q: p.get('q') || '',
      c: p.get('c') || '',
      sort: p.get('sort') || '',
      view: p.get('view') || '',
      notfound: p.get('notfound') === '1'
    };
    var visibleCount = PAGE_SIZE;
    var filterQ = '';
    var view = state.notfound ? 'notfound'
      : (state.view === 'categories' ? 'categories'
        : (state.c ? 'category' : 'explore'));

    function el(name) { return document.querySelector('[data-view="' + name + '"]'); }
    function showView(name) {
      ['explore', 'categories', 'category', 'notfound'].forEach(function (v) {
        var node = el(v);
        if (node) node.hidden = (v !== name);
      });
      var shell = byId('browse-shell');
      if (shell) shell.hidden = false;
    }

    function chipsHTML() {
      var html = '<a class="chip' + (state.c === '' ? ' is-active' : '') +
        '" href="' + esc(F.url.explore({ q: state.q, sort: state.sort })) + '" data-cat=""' +
        (state.c === '' ? ' aria-current="true"' : '') + '>All</a>';
      return html + F.categories.map(function (c) {
        var active = state.c === c.slug;
        return '<a class="chip' + (active ? ' is-active' : '') + '" href="' +
          esc(F.url.explore({ q: state.q, c: c.slug, sort: state.sort })) +
          '" data-cat="' + esc(c.slug) + '"' + (active ? ' aria-current="true"' : '') + '>' +
          esc(c.name) + '</a>';
      }).join('');
    }

    function currentList() {
      var list = F.sites.slice();
      if (state.c) list = list.filter(function (s) { return s.category === state.c; });
      var relevance = false;
      var query = view === 'category' ? filterQ : state.q;
      if (query) { list = F.searchSites(query, list); relevance = true; }
      if (state.sort === 'az') list = F.sortByName(list);
      else if (state.sort === 'newest') list = F.sortByNewest(list);
      else if (!relevance) list = F.directoryOrder(list);
      return list;
    }

    function emptyStateHTML() {
      var chips = F.categories.slice(0, 6).map(function (c) {
        return '<a class="chip" href="' + esc(F.url.category(c.slug)) + '">' + esc(c.name) + '</a>';
      }).join('');
      return emptyHTML(t('ui.noResultsTitle', 'No websites found.'),
        t('ui.noResultsHint', 'Try another search or browse categories.'),
        '<div class="chips empty__chips">' + chips + '</div>', false);
    }

    /* ---------- explore ---------- */
    var exploreGrid = byId('explore-grid');
    var exploreCount = byId('result-count');
    var exploreMoreWrap = byId('explore-showmore-wrap');
    var exploreMoreBtn = byId('explore-showmore');
    var exploreChips = byId('explore-chips');
    var exploreInput = byId('page-search');
    var exploreForm = byId('browse-search-form');
    var exploreTitle = byId('browse-title');
    var browseSub = byId('browse-sub');
    var browseCrumb = byId('page-breadcrumb');
    var sortSel = byId('sort-select');

    /* the shared page heading: every browse view rewrites it, so the page has
       one h1 and its text always comes from content.json */
    function setHeading(title, sub, crumbHTML) {
      if (exploreTitle && title) exploreTitle.textContent = title;
      if (browseSub) { browseSub.textContent = sub || ''; browseSub.hidden = !sub; }
      if (browseCrumb) {
        if (crumbHTML) { browseCrumb.innerHTML = crumbHTML; browseCrumb.hidden = false; }
        else { browseCrumb.innerHTML = ''; browseCrumb.hidden = true; }
      }
    }

    function renderExplore() {
      if (exploreChips) exploreChips.innerHTML = chipsHTML();
      setHeading(
        state.q ? F.format(t('pages.search.title', 'Results for “{q}”'), { q: state.q })
                : t('pages.explore.title', 'Explore Websites'),
        state.q ? F.format(t('pages.search.subtitle', ''), { q: state.q })
                : t('pages.explore.subtitle', ''),
        '');
      if (exploreTitle) {
        document.title = exploreTitle.textContent + ' | Findwebs';
      }
      var list = currentList();
      if (exploreCount) exploreCount.textContent = F.countLabel('ui.websitesCount', list.length);
      var shown = list.slice(0, visibleCount);
      if (exploreGrid) exploreGrid.innerHTML = shown.length ? cards(shown) : emptyStateHTML();
      if (exploreMoreWrap) exploreMoreWrap.hidden = shown.length >= list.length;
      if (exploreInput && document.activeElement !== exploreInput) exploreInput.value = state.q;
    }

    /* ---------- categories ---------- */
    function renderCategories() {
      setHeading(t('pages.categories.title', 'Categories'),
        t('pages.categories.subtitle', ''), '');
      fill('cat-index-grid', F.categories.map(F.renderTile).join(''));
    }

    /* ---------- one category ---------- */
    var catGrid = byId('cat-grid');
    var catFilter = byId('cat-filter');
    var catSort = byId('cat-sort');
    var catMoreWrap = byId('cat-showmore-wrap');
    var catMoreBtn = byId('cat-showmore');

    function currentCat() { return F.catBySlug[state.c]; }

    function renderCategory() {
      var cat = currentCat();
      var catSites = F.sites.filter(function (s) { return s.category === state.c; });
      setHeading(cat.name, cat.description || '',
        '<a href="' + esc(F.url.home()) + '">Home</a><span class="breadcrumb__sep" aria-hidden="true">›</span>' +
        '<a href="' + esc(F.url.categories()) + '">Categories</a><span class="breadcrumb__sep" aria-hidden="true">›</span>' +
        '<span aria-current="page">' + esc(cat.name) + '</span>');
      fill('cat-head',
        '<p class="page-count" id="cat-count">' + F.countLabel('ui.websitesCount', catSites.length) + '</p>');
      if (catFilter) catFilter.placeholder = 'Filter ' + cat.name + ' ' + t('ui.filterPlaceholder', 'websites…');
      var list = currentList();
      var countEl = byId('cat-count');
      if (countEl) countEl.textContent = F.countLabel('ui.websitesCount', list.length);
      var shown = list.slice(0, visibleCount);
      if (catGrid) {
        catGrid.innerHTML = shown.length
          ? '<div class="card-grid">' + cards(shown) + '</div>'
          : emptyHTML(t('ui.noResultsTitle', 'No websites found.'),
              t('ui.noResultsHint', 'Try another search or browse categories.'), '', false);
      }
      if (catMoreWrap) catMoreWrap.hidden = shown.length >= list.length;

      F.setJSONLD([
        { '@type': 'BreadcrumbList', 'itemListElement': [
          { '@type': 'ListItem', position: 1, name: 'Home', item: F.absUrl('/index.html') },
          { '@type': 'ListItem', position: 2, name: 'Categories', item: F.absUrl('browse.html?view=categories') },
          { '@type': 'ListItem', position: 3, name: cat.name }
        ] },
        { '@type': 'ItemList', name: cat.name + ' websites on Findwebs',
          'itemListElement': catSites.map(function (s, i) {
            return { '@type': 'ListItem', position: i + 1, name: s.name, url: F.absUrl(F.url.site(s.slug)) };
          }) }
      ]);
    }

    function applyMeta() {
      var cat = state.c ? currentCat() : null;
      if (view === 'notfound' || (view === 'category' && !cat)) {
        F.updateMeta('Page not found | Findwebs',
          'The page you are looking for does not exist.', 'browse.html', true);
        return;
      }
      if (view === 'categories') {
        F.updateMeta(cat ? '' : 'Categories | Findwebs',
          F.categories.map(function (c) { return c.name; }).join(', ') + '.',
          'browse.html?view=categories', false);
        return;
      }
      if (view === 'category') {
        F.updateMeta(cat.name + ' Websites & Tools | Findwebs',
          cat.description || '', F.url.category(cat.slug), false);
        return;
      }
      F.updateMeta(
        state.q ? F.format(t('pages.search.title', 'Results for “{q}”'), { q: state.q }) + ' | Findwebs'
                : t('pages.explore.title', 'Explore Websites') + ' | Findwebs',
        state.q ? F.format(t('pages.search.subtitle', ''), { q: state.q }) : t('pages.explore.subtitle', ''),
        'browse.html', !!(state.q || state.sort));
    }

    function writeQuery(params) { return 'browse.html' + F.qs(params); }
    function push(params) { history.pushState({}, '', writeQuery(params)); }
    function replace(params) { history.replaceState({}, '', writeQuery(params)); }

    /* ---------- hooks ---------- */
    if (exploreForm) exploreForm.addEventListener('submit', function (e) {
      e.preventDefault();
      state.q = (exploreInput.value || '').trim();
      visibleCount = PAGE_SIZE;
      push({ q: state.q, c: state.c, sort: state.sort });
      applyMeta(); renderExplore();
    });
    if (exploreChips) exploreChips.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      var chip = e.target.closest ? e.target.closest('.chip') : null;
      if (!chip) return;
      e.preventDefault();
      state.c = chip.getAttribute('data-cat') || '';
      visibleCount = PAGE_SIZE;
      push({ q: state.q, c: state.c, sort: state.sort });
      applyMeta(); renderExplore();
    });
    if (sortSel) sortSel.addEventListener('change', function () {
      state.sort = sortSel.value;
      visibleCount = PAGE_SIZE;
      replace({ q: state.q, c: state.c, sort: state.sort });
      applyMeta(); renderExplore();
    });
    if (exploreMoreBtn) exploreMoreBtn.addEventListener('click', function () {
      visibleCount += PAGE_SIZE;
      renderExplore();
    });
    var filterTimer = null;
    if (catFilter) catFilter.addEventListener('input', function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(function () {
        filterQ = (catFilter.value || '').trim();
        visibleCount = PAGE_SIZE;
        renderCategory();
      }, 120);
    });
    var catFilterForm = byId('cat-filter-form');
    if (catFilterForm) catFilterForm.addEventListener('submit', function (e) {
      e.preventDefault();
      filterQ = (catFilter.value || '').trim();
      visibleCount = PAGE_SIZE;
      renderCategory();
    });
    if (catSort) catSort.addEventListener('change', function () {
      state.sort = catSort.value;
      visibleCount = PAGE_SIZE;
      replace({ q: '', c: state.c, sort: state.sort });
      renderCategory();
    });
    if (catMoreBtn) catMoreBtn.addEventListener('click', function () {
      visibleCount += PAGE_SIZE;
      renderCategory();
    });
    window.addEventListener('popstate', function () { location.reload(); });

    /* ---------- boot the view ---------- */
    if (view === 'category' && !currentCat()) {
      fill('notfound', emptyHTML('Category not found.',
        'This category does not exist or has no websites yet.',
        '<p><a class="btn" href="' + esc(F.url.categories()) + '">Browse all categories</a></p>', true));
      showView('notfound'); applyMeta(); return;
    }
    if (view === 'notfound') {
      var nf = el('notfound');
      if (nf && !nf.innerHTML.trim()) {
        nf.innerHTML = emptyHTML('Page not found.',
          'The page you are looking for does not exist or has moved.',
          '<p><a class="btn" href="' + esc(F.url.home()) + '">Go to the homepage</a></p>', true);
      }
      showView('notfound'); applyMeta(); return;
    }
    showView(view);
    applyMeta();
    if (view === 'explore') {
      if (sortSel) sortSel.value = state.sort;
      renderExplore();
    } else if (view === 'categories') {
      renderCategories();
    } else {
      renderCategory();
    }
    /* the header nav highlights the section you are actually in */
    var nav = document.querySelectorAll('.site-nav__link');
    var catActive = (view === 'categories' || view === 'category');
    nav.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var on = catActive ? href.indexOf('view=categories') !== -1 : href === 'browse.html';
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  };

  /* ============ SITE — site.html (?s=slug): information about the site. ==== */
  window.FW_PAGES['site'] = function () {
    var p = new URLSearchParams(location.search);
    var site = F.siteBySlug[p.get('s') || ''];
    var notFound = byId('site-notfound');
    var layout = byId('site-layout');

    if (!site) {
      if (layout) layout.hidden = true;
      var mc0 = byId('site-cta-mobile');
      if (mc0) mc0.hidden = true;
      dropSection('site-related');
      if (notFound) {
        notFound.hidden = false;
        notFound.innerHTML = emptyHTML('Website not found.',
          'This page does not exist or the website was removed.',
          '<p><a class="btn" href="' + esc(F.url.explore()) + '">Explore all websites</a></p>', true);
      }
      F.updateMeta('Website not found | Findwebs',
        'This website information page does not exist.', 'site.html', true);
      return;
    }

    var cat = F.catBySlug[site.category];
    var rel = (F.settings && F.settings.externalLinkRel) || 'noopener noreferrer';
    F.updateMeta(site.name + ' — Website Information | Findwebs', site.description,
      F.url.site(site.slug), false);

    var domain = '';
    try { domain = new URL(site.url).hostname.replace(/^www\./, ''); } catch (e) { domain = ''; }

    var ctaLink = '<a class="btn btn--primary" href="' + esc(site.url) + '" target="_blank" rel="' +
      esc(rel) + '" aria-label="' + esc(t('ui.visitWebsite', 'Visit Website')) + ' ' + esc(site.name) +
      ' (opens in new tab)">' + F.icon('i-external-link') + esc(t('ui.visitWebsite', 'Visit Website')) + '</a>';
    var leave = '<p class="cta-helper">' + esc(t('ui.leaveNotice', '')) + '</p>';

    var html =
      '<nav class="breadcrumb" aria-label="Breadcrumb">' +
        '<a href="' + esc(F.url.home()) + '">Home</a><span class="breadcrumb__sep" aria-hidden="true">›</span>' +
        (cat ? '<a href="' + esc(F.url.category(cat.slug)) + '">' + esc(cat.name) +
          '</a><span class="breadcrumb__sep" aria-hidden="true">›</span>' : '') +
        '<span aria-current="page">' + esc(site.name) + '</span>' +
      '</nav>' +
      '<div class="site-eyebrow">' + esc(t('pages.site.eyebrow', 'Website information')) + '</div>' +
      '<div class="site-head">' + F.logoHTML(site, { large: true }) +
        '<div class="site-head__body">' +
          '<h1>' + esc(site.name) + '</h1>' +
          '<div class="site-head__meta">' + F.renderBadge(site) +
            (cat ? '<a class="site-cat-link" href="' + esc(F.url.category(cat.slug)) + '">' +
              esc(cat.name) + '</a>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="site-short">' + esc(site.description) + '</p>';

    if (site.longDescription) {
      html += '<div class="site-long">' + String(site.longDescription).split(/\n\n+/).map(function (par) {
        return '<p>' + esc(par) + '</p>';
      }).join('') + '</div>';
    }
    if (site.tags && site.tags.length) {
      html += '<div class="site-tags">' + site.tags.map(function (tg) {
        return '<a class="tag-pill" href="' + esc(F.url.explore({ q: tg })) + '">' + esc(tg) + '</a>';
      }).join('') + '</div>';
    }
    var rows = '';
    if (domain) {
      rows += '<div class="info-list__row"><span class="info-list__label">Website</span>' +
        '<span class="info-list__value">' + esc(domain) + '</span></div>';
    }
    (site.info || []).forEach(function (row) {
      if (row && row.label) {
        rows += '<div class="info-list__row"><span class="info-list__label">' + esc(row.label) +
          '</span><span class="info-list__value">' + esc(row.value == null ? '' : row.value) + '</span></div>';
      }
    });
    if (rows) html += '<div class="info-list">' + rows + '</div>';
    html += '<div class="site-cta-block">' + ctaLink + leave + '</div>';
    fill('site-main', html);

    fill('site-side', '<div class="site-side__card">' + ctaLink + leave +
      (domain ? '<p class="site-side__domain">' + esc(domain) + '</p>' : '') + '</div>');

    var mobileCta = byId('site-cta-mobile');
    if (mobileCta) { mobileCta.hidden = false; mobileCta.innerHTML = ctaLink; }

    /* Related: same category, ranked by shared tags, then Directory Order. */
    var selfTags = (site.tags || []).map(F.normalize);
    var others = F.sites.filter(function (s) {
      return s.slug !== site.slug && s.category === site.category;
    }).map(function (s) {
      s._shared = (s.tags || []).filter(function (x) {
        return selfTags.indexOf(F.normalize(x)) !== -1;
      }).length;
      return s;
    });
    var baseOrder = F.directoryOrder(others);
    var orderIndex = {};
    baseOrder.forEach(function (s, i) { orderIndex[s.slug] = i; });
    baseOrder.sort(function (a, b) {
      return (b._shared - a._shared) || (orderIndex[a.slug] - orderIndex[b.slug]);
    });
    var related = baseOrder.slice(0, 4);
    var relSection = byId('site-related');
    var relGrid = byId('site-related-grid');
    if (relGrid) relGrid.innerHTML = '<div class="card-grid">' + cards(related) + '</div>';
    if (relSection) {
      if (!related.length) dropSection('site-related');
      else relSection.hidden = false;
    }

    F.setJSONLD([
      { '@type': 'WebPage', name: site.name + ' — Website Information',
        url: F.absUrl(F.url.site(site.slug)), description: site.description, about: site.name,
        isPartOf: { '@type': 'WebSite', name: (F.settings && F.settings.siteName) || 'Findwebs',
          url: F.absUrl('/index.html') } },
      { '@type': 'BreadcrumbList', 'itemListElement': [
        { '@type': 'ListItem', position: 1, name: 'Home', item: F.absUrl('/index.html') },
        cat ? { '@type': 'ListItem', position: 2, name: cat.name, item: F.absUrl(F.url.category(cat.slug)) } : null,
        { '@type': 'ListItem', position: cat ? 3 : 2, name: site.name }
      ].filter(Boolean) }
    ]);
  };

  /* ============ ABOUT — about.html (?p=…) shows one of four documents. ====== */
  window.FW_PAGES['about'] = function () {
    var DOCS = {
      about: { title: 'About | Findwebs', description: 'What Findwebs is and how websites are chosen.' },
      contact: { title: 'Contact | Findwebs', description: 'Contact the Findwebs team.' },
      privacy: { title: 'Privacy Policy | Findwebs', description: 'Privacy policy for Findwebs.' },
      terms: { title: 'Terms of Use | Findwebs', description: 'Terms of use for Findwebs.' }
    };
    var p = new URLSearchParams(location.search);
    var doc = p.get('p') || 'about';
    if (!DOCS[doc]) doc = 'about';
    document.querySelectorAll('[data-doc]').forEach(function (node) {
      node.hidden = node.getAttribute('data-doc') !== doc;
    });
    /* the mailto address comes from settings (one place to edit it) */
    var email = (F.settings && F.settings.contactEmail) || '';
    if (email) {
      document.querySelectorAll('[data-contact-email]').forEach(function (a) {
        a.setAttribute('href', 'mailto:' + email);
        a.textContent = (a.getAttribute('data-contact-prefix') || '') + email;
      });
    }
    F.updateMeta(DOCS[doc].title, DOCS[doc].description,
      doc === 'about' ? 'about.html' : 'about.html?p=' + doc, false);
  };
})();
