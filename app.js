(function () {
  'use strict';

  var state = {
    route: { name: 'home' },
    datasets: [],
    datasetsLoaded: false,
    stats: null,
    detail: null,
    papers: [],
    reproductions: [],
    coverage: null,
    loading: false,
    error: '',
    filters: { query: '', task: 'all', origin: 'all', access: 'all', source: 'all' },
    navOpen: false
  };

  var app = document.getElementById('app');
  var API_BASE = resolveApiBase();

  function resolveApiBase() {
    var configured = String(window.TMLB_API_BASE || '').trim().replace(/\/+$/, '');
    var params = new URLSearchParams(window.location.search);
    var override = String(params.get('api') || '').trim().replace(/\/+$/, '');
    var localContext = window.location.protocol === 'file:' || /^(127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    if (override && (override.indexOf('https://') === 0 || localContext)) configured = override;
    if (!configured && window.location.protocol !== 'file:') configured = window.location.origin + '/api/v1';
    if (window.location.protocol === 'https:' && configured && configured.indexOf('https://') !== 0) return '';
    return configured;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    try {
      var url = new URL(String(value || ''), window.location.href);
      return /^(https?:)$/.test(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function text(value, fallback) {
    var out = value == null ? '' : String(value).trim();
    return out || (fallback == null ? '—' : fallback);
  }

  function number(value) {
    var n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : '—';
  }

  function bytes(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 'Not listed';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
  }

  function date(value) {
    if (!value) return 'Not recorded';
    var d = new Date(value);
    return Number.isNaN(d.valueOf()) ? text(value) : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function slugOf(item) {
    return text(item.slug || item.id || item.canonical_id, '').replace(/^tmleb:/, '');
  }

  function api(path, options) {
    if (!API_BASE) return Promise.reject(new Error('This deployment has no HTTPS API origin configured.'));
    return fetch(API_BASE + path, Object.assign({ headers: { Accept: 'application/json' } }, options || {})).then(function (res) {
      if (!res.ok) {
        var err = new Error('API request failed (' + res.status + ')');
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function optional(path) {
    return api(path).catch(function () { return null; });
  }

  function list(payload) {
    return Array.isArray(payload) ? payload : (payload && Array.isArray(payload.items) ? payload.items : []);
  }

  function loadDatasetPages() {
    var pageSize = 500;
    var maximum = 2000;
    var base = '/datasets?kind=trainable_ml&asset_type=static_dataset&relevance_status=approved&limit=' + pageSize;
    function next(path, collected) {
      return api(path).then(function (payload) {
        var items = list(payload);
        var merged = collected.concat(items);
        var cursor = payload && (payload.next_cursor || payload.nextCursor);
        var total = Number(payload && payload.total);
        if (cursor && merged.length < maximum) {
          return next(base + '&cursor=' + encodeURIComponent(cursor), merged);
        }
        if (Number.isFinite(total) && merged.length < total && merged.length < maximum && items.length) {
          return next(base + '&offset=' + merged.length, merged);
        }
        return { items: merged.slice(0, maximum), total: total || merged.length };
      });
    }
    return next(base, []);
  }

  function first(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function sourceName(item) {
    var sources = Array.isArray(item.sources) ? item.sources : [];
    return text((sources[0] && sources[0].provider) || item.provider || item.source || (item.hf_id ? 'Hugging Face' : ''), 'Unspecified');
  }

  function taskName(item) {
    return text(item.task || item.task_type || item.taskType || item.ml_type || item.domain || item.category, 'Needs task adapter');
  }

  function normalizeDataset(item) {
    var tags = Array.isArray(item.tags) ? item.tags : [];
    var creators = Array.isArray(item.creators) ? item.creators : [];
    var sourceCount = Number(item.source_count);
    var fileCount = Number(item.file_count);
    return {
      raw: item,
      id: text(item.canonical_id || item.id || item.slug, ''),
      slug: slugOf(item),
      name: text(item.name || item.title, 'Untitled dataset'),
      description: text(item.description, 'No descriptive metadata is available yet.'),
      task: taskName(item),
      domain: text(item.domain || item.modality, 'Unclassified'),
      origin: text(item.origin_type || item.origin || item.data_origin, 'unknown').toLowerCase(),
      access: text(item.access_status, item.download_status === 'done' ? 'open' : 'unknown').toLowerCase(),
      license: text(item.license, 'Unknown'),
      source: sourceName(item),
      sourceCount: Number.isFinite(sourceCount) ? sourceCount : (Array.isArray(item.sources) ? item.sources.length : 0),
      fileCount: Number.isFinite(fileCount) ? fileCount : 0,
      totalBytes: Number(item.total_bytes) || 0,
      paperCount: Number(item.paper_count || item.paperCount) || 0,
      reproductionCount: Number(item.reproduction_count || item.submissionCount) || 0,
      releaseCount: Number(item.release_count) || 0,
      updated: item.last_verified || item.updated_at || item.publication_date || '',
      url: safeUrl(item.url || item.landing_url || item.accessLink),
      doi: text(item.doi, ''),
      tags: tags.slice(0, 8),
      creators: creators,
      publisher: text(item.publisher, 'Not recorded'),
      version: text(item.version, 'Not recorded'),
      taskDefinition: text(item.task_definition, ''),
      isMl: !item.kind || item.kind === 'trainable_ml',
      isStatic: !item.asset_type || item.asset_type === 'static_dataset',
      approved: !item.relevance_status || item.relevance_status === 'approved',
      downloadStatus: text(item.download_status, 'not_requested'),
      lastVerified: item.last_verified || ''
    };
  }

  function normalizePaper(item) {
    return {
      id: text(item.paper_id || item.arxiv_id || item.doi || item.id, ''),
      title: text(item.title, 'Untitled paper'),
      authors: Array.isArray(item.authors) ? item.authors.join(', ') : text(item.authors, 'Authors not indexed'),
      year: text(item.year || item.publication_year, '—'),
      url: safeUrl(item.url || item.pdf_url || (item.arxiv_id ? 'https://arxiv.org/abs/' + item.arxiv_id : '')),
      evidence: text(item.evidence || item.usage_evidence, ''),
      dataset: text(item.dataset_name || item.dataset || '', ''),
      status: text(item.access_status || (item.pdf_url ? 'open' : 'unknown'), 'unknown')
    };
  }

  function normalizeReproduction(item) {
    return {
      id: text(item.experiment_id || item.id || item.slug, ''),
      title: text(item.paper_title || item.paperTitle || item.title, 'Paper-specific reproduction'),
      dataset: text(item.dataset_name || item.name || item.dataset || item.slug, 'Dataset not listed'),
      task: text(item.task, 'Task not recorded'),
      track: text(item.protocol_track || item.track, 'paper_only'),
      model: text(item.coding_model || item.model, 'Not recorded'),
      outcome: text(item.outcome || item.state || item.reproStatus, 'executed_unverified'),
      claimed: item.claimed_score != null ? item.claimed_score : item.claimedScore,
      reproduced: item.reproduced_score != null ? item.reproduced_score : item.score,
      metric: text(item.metric, 'Metric not recorded'),
      started: item.started_at || item.startedAt || '',
      evidence: text(item.evidence, ''),
      url: safeUrl(item.url || item.report_url || '')
    };
  }

  function isPublicMl(d) {
    return d.isMl && d.isStatic && d.approved;
  }

  function loadCore() {
    if (state.datasetsLoaded) return Promise.resolve();
    state.loading = true;
    state.error = '';
    render();
    return Promise.all([
      loadDatasetPages().catch(function () {
        return api('/benchmarks?limit=500');
      }),
      optional('/stats')
    ]).then(function (values) {
      state.datasets = list(values[0]).map(normalizeDataset).filter(isPublicMl);
      state.datasetsLoaded = true;
      state.stats = values[1] || {};
    }).catch(function (err) {
      state.error = err.message || 'The catalog could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadDetail(slug) {
    state.loading = true;
    state.error = '';
    state.detail = null;
    render();
    return Promise.all([
      api('/datasets/' + encodeURIComponent(slug)),
      optional('/datasets/' + encodeURIComponent(slug) + '/files?limit=500'),
      optional('/benchmarks/' + encodeURIComponent(slug)),
      optional('/reproductions?dataset=' + encodeURIComponent(slug) + '&limit=100'),
      optional('/runs?dataset=' + encodeURIComponent(slug) + '&limit=100')
    ]).then(function (values) {
      var raw = values[0] || {};
      var benchmark = values[2] || {};
      var dataset = normalizeDataset(Object.assign({}, benchmark, raw));
      var detailPapers = list(raw.papers || benchmark.papers).map(normalizePaper);
      var reproductionPayload = values[3] || values[4];
      var reproductionItems = list(reproductionPayload).filter(function (r) {
        return !r.slug || r.slug === slug || r.dataset_slug === slug;
      }).map(normalizeReproduction);
      var legacy = list(benchmark.submissions).filter(function (s) {
        return s.source === 'ai_reproduced' || s.reproStatus || s.repro_status;
      }).map(function (s) {
        return normalizeReproduction(Object.assign({ dataset_name: dataset.name, task: dataset.task }, s));
      });
      state.detail = {
        dataset: dataset,
        files: list(values[1]),
        sources: Array.isArray(raw.sources) ? raw.sources : [],
        versions: Array.isArray(raw.source_versions) ? raw.source_versions : [],
        releases: Array.isArray(raw.releases) ? raw.releases : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        papers: detailPapers,
        reproductions: reproductionItems.length ? reproductionItems : legacy
      };
    }).catch(function (err) {
      state.error = err.message || 'The dataset could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadPapers() {
    state.loading = true;
    state.error = '';
    render();
    api('/papers?limit=200').then(function (payload) {
      state.papers = list(payload).map(normalizePaper);
    }).catch(function (err) {
      state.error = err.message || 'Paper metadata could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadReproductions() {
    state.loading = true;
    state.error = '';
    render();
    api('/reproductions?limit=200').catch(function () {
      return api('/runs?limit=200');
    }).then(function (payload) {
      state.reproductions = list(payload).map(normalizeReproduction);
    }).catch(function (err) {
      state.error = err.message || 'Reproduction records could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadCoverage() {
    state.loading = true;
    state.error = '';
    render();
    Promise.all([optional('/catalog/coverage'), optional('/stats'), optional('/catalog/sources')]).then(function (values) {
      var sources = list(values[2]).map(function (s) {
        return {
          provider: text(s.provider, 'Unknown source'),
          status: text(s.status, 'unknown'),
          seen: Number(s.records_seen) || 0,
          kept: Number(s.records_kept) || 0,
          lastSync: s.last_sync || '',
          authenticated: Boolean(s.authenticated)
        };
      });
      state.coverage = { summary: values[0] || values[1] || {}, sources: sources };
    }).catch(function (err) {
      state.error = err.message || 'Coverage data could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function logo() {
    return '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3.5 15.5a12 12 0 0 1 17 0M6.7 18.5a7.5 7.5 0 0 1 10.6 0M10.1 21.1a2.7 2.7 0 0 1 3.8 0" stroke="#24d1d8" stroke-width="1.7" stroke-linecap="round"/><path d="M12 3v9" stroke="#5f8dff" stroke-width="1.7"/><circle cx="12" cy="3" r="1.7" fill="#f2b84b"/></svg></span>';
  }

  function navLink(route, label) {
    var active = state.route.name === route || (route === 'datasets' && state.route.name === 'dataset');
    return '<a class="navlink" href="#/' + route + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
  }

  function header() {
    return '<header class="topbar"><nav class="nav" aria-label="Main navigation">' +
      '<a class="brand" href="#/home">' + logo() + '<span class="brand-name">TeleMLEBench</span></a>' +
      '<button class="nav-toggle" data-action="toggle-nav" aria-expanded="' + (state.navOpen ? 'true' : 'false') + '" aria-label="Toggle navigation">Menu</button>' +
      '<div class="navlinks ' + (state.navOpen ? 'open' : '') + '">' +
        navLink('datasets', 'Datasets') + navLink('papers', 'Papers') + navLink('reproductions', 'Reproductions') +
        navLink('methodology', 'Methodology') + navLink('coverage', 'Coverage') +
      '</div>' +
      '<a class="nav-cta" href="#/contribute">Contribute via GitHub</a>' +
    '</nav></header>';
  }

  function footer() {
    return '<footer><div class="container footer-inner"><div>TeleMLEBench · evidence before rank</div>' +
      '<div class="footer-links"><a href="#/methodology">Methods</a><a href="#/coverage">Coverage</a><a href="#/contribute">Contribute</a></div></div></footer>';
  }

  function statusBadge(value) {
    var normalized = text(value, 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return '<span class="status ' + normalized + '">' + esc(text(value, 'unknown').replace(/_/g, ' ')) + '</span>';
  }

  function signalPath(stages) {
    return '<div class="signal-path" aria-label="Evidence signal path">' + stages.map(function (s) {
      return '<div class="signal-node ' + esc(s.state || '') + '"><div class="signal-dot"></div><span>' + esc(s.label) + '</span></div>';
    }).join('') + '</div>';
  }

  function heroSignal() {
    return '<aside class="signal-panel" aria-label="TeleMLEBench evidence model">' +
      '<div class="signal-label">Evidence path / public record</div>' +
      signalPath([{label:'Source'}, {label:'Release'}, {label:'Paper',state:'pending'}, {label:'Reproduce',state:'off'}]) +
      '<div class="signal-readout"><span>Catalog policy</span><strong>ML · static only</strong><span>Standard split</span><strong>70 / 15 / 15</strong><span>Default seed</span><strong>42</strong></div>' +
    '</aside>';
  }

  function statBlock(value, label) {
    return '<div class="stat"><div class="stat-value">' + esc(number(value)) + '</div><div class="stat-label">' + esc(label) + '</div></div>';
  }

  function datasetCard(d) {
    var tags = [d.task, d.origin !== 'unknown' ? d.origin : d.domain].concat(d.tags.slice(0, 1)).filter(Boolean);
    return '<a class="card dataset-card" href="#/dataset/' + encodeURIComponent(d.slug) + '">' +
      '<div class="card-kicker"><span class="id">' + esc(d.id || d.slug) + '</span>' + statusBadge(d.access) + '</div>' +
      '<h3>' + esc(d.name) + '</h3><p>' + esc(d.description) + '</p>' +
      '<div class="tag-row">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<div class="card-footer">' +
        '<div><div class="mini-value">' + esc(d.source) + '</div><div class="mini-label">Primary source</div></div>' +
        '<div><div class="mini-value">' + esc(d.fileCount ? number(d.fileCount) : '—') + '</div><div class="mini-label">Files indexed</div></div>' +
        '<div><div class="mini-value">' + esc(d.paperCount ? number(d.paperCount) : '—') + '</div><div class="mini-label">Papers linked</div></div>' +
      '</div></a>';
  }

  function loading(message) {
    return '<div class="loading"><span class="spinner" aria-hidden="true"></span><p class="muted" style="margin:14px 0 0">' + esc(message || 'Loading evidence…') + '</p></div>';
  }

  function errorBox() {
    return '<div class="error"><h3>Evidence service unavailable</h3><p class="muted">' + esc(state.error) + '</p><button class="btn btn-light" data-action="retry">Retry</button></div>';
  }

  function homePage() {
    var stats = state.stats || {};
    var featured = state.datasets.slice(0, 6);
    return '<main id="main">' +
      '<section class="hero"><div class="container hero-grid"><div>' +
        '<div class="eyebrow">Source-first telecom ML</div>' +
        '<h1>Follow the evidence from <span>dataset</span> to result.</h1>' +
        '<p class="hero-copy">A public catalog of static telecom ML datasets, transparent task releases, paper-use evidence, and controlled reproduction attempts. Every status says what is known—and what is still missing.</p>' +
        '<div class="hero-actions"><a class="btn btn-primary" href="#/datasets">Explore ML datasets</a><a class="btn btn-ghost" href="#/methodology">Read the protocol</a></div>' +
      '</div>' + heroSignal() + '</div></section>' +
      '<section class="stat-band"><div class="container stats">' +
        statBlock(stats.datasets != null ? stats.datasets : state.datasets.length, 'Catalog candidates') +
        statBlock(state.datasets.length || stats.approved_static, 'Public ML datasets') +
        statBlock(stats.confirmed_paper_links || stats.papers, 'Confirmed paper links') +
        statBlock(stats.reproductions, 'Reproduction records') +
      '</div></section>' +
      '<section class="page"><div class="container"><div class="section-head"><div><div class="eyebrow">Current catalog</div><h2>Static datasets with traceable origins</h2></div><p class="section-copy">The active view excludes LLM corpora, evaluation suites, generators, and software. Publication evidence becomes richer as source manifests and task releases are verified.</p></div>' +
      (state.loading ? loading() : state.error ? errorBox() : '<div class="grid card-grid">' + featured.map(datasetCard).join('') + '</div>') +
      (!state.loading && !state.error ? '<div style="margin-top:26px"><a class="btn btn-light" href="#/datasets">View the catalog →</a></div>' : '') +
      '</div></section></main>';
  }

  function filterOptions(values, selected) {
    return '<option value="all">All</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function unique(values) {
    return Array.from(new Set(values.filter(function (v) { return v && v !== 'unknown' && v !== 'Unclassified'; }))).sort();
  }

  function filteredDatasets() {
    var f = state.filters;
    var q = f.query.trim().toLowerCase();
    return state.datasets.filter(function (d) {
      var corpus = [d.name, d.description, d.task, d.domain, d.source].concat(d.tags).join(' ').toLowerCase();
      return (!q || corpus.indexOf(q) >= 0) &&
        (f.task === 'all' || d.task === f.task) &&
        (f.origin === 'all' || d.origin === f.origin) &&
        (f.access === 'all' || d.access === f.access) &&
        (f.source === 'all' || d.source === f.source);
    });
  }

  function datasetsPage() {
    var results = filteredDatasets();
    return '<main id="main" class="page"><div class="container">' +
      '<div class="section-head"><div><div class="eyebrow">ML-only catalog</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 0">Datasets, not benchmark noise.</h1></div><p class="section-copy">Search approved static dataset records. Measured and fixed simulated data remain visibly distinct; uncertain task structure stays unpublished until an adapter is reviewed.</p></div>' +
      '<div class="filters" role="search">' +
        '<div class="field"><label for="filter-query">Search metadata</label><input id="filter-query" data-filter="query" value="' + esc(state.filters.query) + '" placeholder="CSI, handover, spectrum, QoE…"></div>' +
        '<div class="field"><label for="filter-task">Task</label><select id="filter-task" data-filter="task">' + filterOptions(unique(state.datasets.map(function(d){return d.task;})), state.filters.task) + '</select></div>' +
        '<div class="field"><label for="filter-origin">Origin</label><select id="filter-origin" data-filter="origin">' + filterOptions(unique(state.datasets.map(function(d){return d.origin;})), state.filters.origin) + '</select></div>' +
        '<div class="field"><label for="filter-access">Access</label><select id="filter-access" data-filter="access">' + filterOptions(unique(state.datasets.map(function(d){return d.access;})), state.filters.access) + '</select></div>' +
        '<div class="field"><label for="filter-source">Source</label><select id="filter-source" data-filter="source">' + filterOptions(unique(state.datasets.map(function(d){return d.source;})), state.filters.source) + '</select></div>' +
      '</div>' +
      '<div class="result-line"><span>' + esc(number(results.length)) + ' records match</span><span>Active scope: static trainable ML</span></div>' +
      (state.loading ? loading() : state.error ? errorBox() : results.length ? '<div class="grid card-grid">' + results.map(datasetCard).join('') + '</div>' : '<div class="empty"><h3>No matching dataset records</h3><p class="muted">Clear one or more filters to widen the catalog.</p><button class="btn btn-light" data-action="clear-filters">Clear filters</button></div>') +
      '</div></main>';
  }

  function externalButton(url, label) {
    return url ? '<a class="btn btn-ghost" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + ' ↗</a>' : '';
  }

  function detailRail(detail) {
    var d = detail.dataset;
    var hasRelease = detail.releases.length > 0 || d.releaseCount > 0;
    var hasPaper = detail.papers.length > 0 || d.paperCount > 0;
    var hasRepro = detail.reproductions.length > 0;
    var stages = [
      {label:'Source', state:d.source === 'Unspecified' ? 'off' : ''},
      {label:'Release', state:hasRelease ? '' : 'pending'},
      {label:'Paper', state:hasPaper ? '' : 'pending'},
      {label:'Reproduce', state:hasRepro ? '' : 'off'}
    ];
    var copy = [
      {v:d.source, l:d.sourceCount ? d.sourceCount + ' source records' : 'Primary record'},
      {v:hasRelease ? detail.releases.length + ' published' : 'Not published', l:'Immutable task view'},
      {v:hasPaper ? (detail.papers.length || d.paperCount) + ' linked' : 'No confirmed use', l:'Usage evidence'},
      {v:hasRepro ? detail.reproductions.length + ' attempts' : 'No verified run', l:'Controlled protocol'}
    ];
    return '<section class="rail-wrap" aria-label="Dataset provenance signal path">' +
      signalPath(stages) + '<div class="rail-copy">' + copy.map(function (x) {
        return '<div><strong title="' + esc(x.v) + '">' + esc(x.v) + '</strong><span>' + esc(x.l) + '</span></div>';
      }).join('') + '</div></section>';
  }

  function sourceRows(detail) {
    var sources = detail.sources.length ? detail.sources : [{
      provider: detail.dataset.source,
      landing_url: detail.dataset.url,
      external_id: detail.dataset.raw.hf_id || detail.dataset.id,
      access_status: detail.dataset.access
    }];
    return sources.map(function (s) {
      var url = safeUrl(s.landing_url || s.url || s.canonical_link);
      var provider = text(s.provider, 'Source record');
      return '<div class="source-row"><div><div class="row-title">' + esc(provider) + '</div><div class="row-meta">' + esc(text(s.external_id || s.provider_id || s.version, 'identifier not listed')) + '</div></div>' +
        (url ? '<a class="btn btn-light" href="' + esc(url) + '" target="_blank" rel="noopener">Open record ↗</a>' : statusBadge(s.access_status || detail.dataset.access)) + '</div>';
    }).join('');
  }

  function fileRows(detail) {
    if (!detail.files.length) return '<div class="empty"><h3>No provider file manifest</h3><p class="muted">This record remains source-linked until the provider exposes or TeleMLEBench verifies a file inventory.</p></div>';
    return detail.files.slice(0, 30).map(function (f) {
      var url = safeUrl(f.content_url || f.url || f.download_url);
      var open = f.restricted === false || f.is_restricted === false || detail.dataset.access === 'open';
      return '<div class="file-row"><div><div class="row-title mono">' + esc(text(f.filename || f.name || f.path, 'unnamed file')) + '</div><div class="row-meta">' + esc(bytes(f.byte_size || f.size)) + (f.checksum ? ' · checksum indexed' : ' · checksum not listed') + '</div></div>' +
        (url && open ? '<a class="btn btn-light" href="' + esc(url) + '" target="_blank" rel="noopener">Provider file ↗</a>' : statusBadge(f.restricted ? 'restricted' : 'metadata only')) + '</div>';
    }).join('');
  }

  function paperRows(papers) {
    if (!papers.length) return '<div class="empty"><h3>No confirmed paper use yet</h3><p class="muted">A citation alone is not accepted as dataset use. Confirmed relationships require inspectable evidence.</p></div>';
    return papers.map(function (p) {
      return '<article class="paper-row"><div class="card-kicker">' + statusBadge(p.status) + '<span class="id">' + esc(p.year) + '</span></div><h3 style="margin:12px 0 6px">' +
        (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' : esc(p.title)) +
        '</h3><p class="muted" style="font-size:13px">' + esc(p.authors) + '</p>' +
        (p.evidence ? '<div class="evidence"><strong>Usage evidence</strong><br>' + esc(p.evidence) + '</div>' : '<div class="evidence">Relationship metadata exists, but a public evidence span is not available in this API response.</div>') +
      '</article>';
    }).join('');
  }

  function reproductionRows(rows) {
    if (!rows.length) return '<div class="empty"><h3>No controlled reproduction published</h3><p class="muted">This means no result has passed the task harness, server scoring, and conformance gates. It does not mean the paper failed reproduction.</p></div>';
    return '<div style="overflow-x:auto"><table class="repro-table"><thead><tr><th>Paper / claim</th><th>Protocol</th><th>Coding model</th><th>Outcome</th><th>Claimed</th><th>Recomputed</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><strong>' + esc(r.title) + '</strong><div class="row-meta">' + esc(r.metric) + '</div></td><td>' + esc(r.track.replace(/_/g,' ')) + '</td><td>' + esc(r.model) + '</td><td>' + statusBadge(r.outcome) + '</td><td class="mono">' + esc(r.claimed == null ? '—' : r.claimed) + '</td><td class="mono">' + esc(r.reproduced == null ? '—' : r.reproduced) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function detailPage() {
    if (state.loading) return '<main id="main" class="page"><div class="container">' + loading('Loading source, release, paper, and reproduction evidence…') + '</div></main>';
    if (state.error || !state.detail) return '<main id="main" class="page"><div class="container">' + errorBox() + '</div></main>';
    var x = state.detail;
    var d = x.dataset;
    return '<main id="main">' +
      '<section class="detail-hero"><div class="container"><div class="breadcrumbs"><a href="#/datasets">Datasets</a><span>/</span><span>' + esc(d.slug) + '</span></div>' +
        '<div class="detail-title"><div><div class="eyebrow">' + esc(d.task) + '</div><h1>' + esc(d.name) + '</h1><p>' + esc(d.description) + '</p></div>' +
        '<div class="detail-actions">' + externalButton(d.url,'Primary source') + '</div></div></div></section>' +
      '<section class="page"><div class="container"><div style="margin-bottom:22px">' + detailRail(x) + '</div><div class="detail-body"><div>' +
        '<section class="card panel"><div class="panel-head"><div><div class="eyebrow">Task contract</div><h2 style="margin-top:10px">What this data supports</h2></div>' + statusBadge(d.downloadStatus) + '</div>' +
          '<p class="definition">' + esc(d.taskDefinition || 'No reviewed task definition is published yet. The dataset remains discoverable, but no target or task view should be inferred from column order.') + '</p>' +
          '<div class="tag-row">' + [d.task,d.domain,d.origin].concat(d.tags.slice(0,4)).filter(Boolean).map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('') + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Source provenance</h2><span class="id">' + esc(d.sourceCount || x.sources.length) + ' records</span></div><div class="source-list">' + sourceRows(x) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>File inventory</h2><span class="id">' + esc(number(d.fileCount || x.files.length)) + ' files · ' + esc(bytes(d.totalBytes)) + '</span></div><div class="file-list">' + fileRows(x) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Papers using this dataset</h2><span class="id">Evidence required</span></div><div class="paper-list">' + paperRows(x.papers) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Reproduction reports</h2><span class="id">Server-scored only</span></div><div class="repro-list">' + reproductionRows(x.reproductions) + '</div></section>' +
      '</div><aside>' +
        '<section class="card panel"><h3>Record facts</h3><dl class="kv">' +
          '<dt>Canonical ID</dt><dd class="mono">' + esc(d.id) + '</dd>' +
          '<dt>Version</dt><dd>' + esc(d.version) + '</dd>' +
          '<dt>License</dt><dd>' + esc(d.license) + '</dd>' +
          '<dt>Access</dt><dd>' + esc(d.access) + '</dd>' +
          '<dt>Origin</dt><dd>' + esc(d.origin) + '</dd>' +
          '<dt>Publisher</dt><dd>' + esc(d.publisher) + '</dd>' +
          '<dt>Last verified</dt><dd>' + esc(date(d.lastVerified)) + '</dd>' +
          '<dt>DOI</dt><dd class="mono">' + esc(d.doi || 'Not recorded') + '</dd>' +
        '</dl></section>' +
        '<section class="card panel"><h3>Standard release policy</h3><p class="muted" style="line-height:1.65;font-size:13px">The platform split is 70/15/15 with seed 42. Temporal, group, route, site, user, or spatial separation takes precedence over row stratification. No release is implied until a reviewed task adapter exists.</p><a class="btn btn-link" href="#/methodology">Read methodology →</a></section>' +
      '</aside></div></div></section></main>';
  }

  function papersPage() {
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><div class="eyebrow">Literature graph</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 0">Papers connected by evidence.</h1></div><p class="section-copy">Metadata is cataloged broadly. Reproduction requires open-access full text or a lawful user-supplied copy, and dataset use must be confirmed beyond a passing citation.</p></div>' +
      (state.loading ? loading('Loading paper metadata…') : state.error ? errorBox() : state.papers.length ? '<div class="paper-list">' + paperRows(state.papers) + '</div>' : '<div class="empty"><h3>No public papers returned</h3><p class="muted">The literature graph may still be building.</p></div>') +
    '</div></main>';
  }

  function reproductionsPage() {
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><div class="eyebrow">Controlled study</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 0">Attempts, not leaderboard theater.</h1></div><p class="section-copy">Paper-only and artifact-assisted tracks are kept separate. A result is verified only after harness validation, isolated execution, conformance review, and server-side metric recomputation.</p></div>' +
      '<div class="evidence" style="margin-bottom:20px"><strong>Important:</strong> “No verified result” is not a failed reproduction. Access, missing data, unsupported tasks, runtime faults, and under-specified methods remain distinct outcomes.</div>' +
      (state.loading ? loading('Loading reproduction records…') : state.error ? errorBox() : reproductionRows(state.reproductions)) +
    '</div></main>';
  }

  function methodologyPage() {
    return '<main id="main" class="page"><div class="container prose"><div class="eyebrow">Transparent convention</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 24px">One evidence chain, three views of the data.</h1>' +
      '<p>TeleMLEBench separates discovery, publication, and research claims. A source record can be cataloged without being downloadable. A dataset can be mirrored without having a safe ML task adapter. A paper can be linked without being reproducible. Each state stays visible.</p>' +
      '<div class="steps">' +
        '<article class="step"><div><h3>Source and review</h3><p>Harvest machine-readable metadata, preserve every provider version, resolve identity using DOI and explicit relations, then independently review telecom relevance, static-data evidence, license, access, and sensitivity.</p></div></article>' +
        '<article class="step"><div><h3>Immutable release</h3><p>Mirror only when redistribution is allowed. Hash the raw snapshot, assign stable sample IDs, publish a documented task adapter, and preserve the provider split alongside the TeleMLEBench view.</p></div></article>' +
        '<article class="step"><div><h3>Leakage-aware split</h3><p>Use 70/15/15 and seed 42. Time, subscriber, device, cell, site, route, session, or spatial dependencies stay together. Stratified rows are only a proven-safe fallback.</p></div></article>' +
        '<article class="step"><div><h3>Paper-use evidence</h3><p>Find papers from direct identifiers, aliases, and citation graphs. Store the exact passage showing training or evaluation use; a citation alone is not accepted.</p></div></article>' +
        '<article class="step"><div><h3>Controlled reproduction</h3><p>Run paper-only and artifact-assisted tracks independently. Keep missing facts and assumptions explicit, isolate generated code, hide test labels from the training process, and recompute metrics on the server.</p></div></article>' +
      '</div>' +
      '<h2>What the platform does not claim</h2><p>TeleMLEBench does not infer that every execution gap is caused by a paper. It first rules out platform faults, unavailable inputs, unsupported representations, invalid scoring, and generated-code failures. Only comparable, server-scored, faithful attempts support conclusions about reporting completeness.</p>' +
      '<h2>Active scope</h2><p>The public catalog focuses on static datasets used for conventional telecom ML. LLM benchmarks, LLM training corpora, software, generators, model artifacts, papers, and supplementary figures remain available for audit but do not appear as active datasets.</p>' +
    '</div></main>';
  }

  function coveragePage() {
    var c = state.coverage || { summary:{}, sources:[] };
    var s = c.summary || {};
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><div class="eyebrow">Coverage ledger</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 0">Bounded, versioned, honest.</h1></div><p class="section-copy">“All” means the maintained telecom query registry, trusted indexes, and curated gold inventory—not every record on the internet. Source failures and missing credentials remain visible coverage limits.</p></div>' +
      (state.loading ? loading('Loading source coverage…') : state.error ? errorBox() :
        '<div class="grid coverage-grid">' +
          '<article class="card coverage-card"><strong>' + esc(number(s.datasets || s.discovered)) + '</strong><h3>Discovered candidates</h3><p>Raw candidates before relevance, usability, license, and publication review.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.approved_static || s.published || state.datasets.length)) + '</strong><h3>Active ML records</h3><p>Static trainable records exposed by the current API after active-scope filtering.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.confirmed_paper_links || s.paper_linked)) + '</strong><h3>Confirmed paper links</h3><p>Relationships requiring evidence of real dataset use rather than citation alone.</p></article>' +
        '</div>' +
        '<div class="section-head" style="margin-top:46px"><div><div class="eyebrow">Source registry</div><h2>Synchronization state</h2></div><p class="section-copy">Operational errors are summarized, not exposed with internal URLs or credentials.</p></div>' +
        '<div class="grid coverage-grid">' + c.sources.map(function (src) {
          return '<article class="card coverage-card"><div class="card-kicker"><span class="id">' + esc(src.authenticated ? 'authenticated' : 'anonymous') + '</span>' + statusBadge(src.status) + '</div><h3>' + esc(src.provider) + '</h3><p>' + esc(number(src.seen)) + ' records seen · ' + esc(number(src.kept)) + ' retained<br>Last complete sync: ' + esc(date(src.lastSync)) + '</p></article>';
        }).join('') + '</div>') +
    '</div></main>';
  }

  function contributePage() {
    return '<main id="main" class="page"><div class="container prose"><div class="eyebrow">Community path</div><h1 style="font-size:clamp(38px,5vw,60px);margin:14px 0 24px">Improve the record in public.</h1><p>Prototype contributions happen through GitHub issues and pull requests. There are no platform accounts, prediction uploads, hidden-label scores, or private dispute forms.</p>' +
      '<div class="grid card-grid" style="margin-top:28px">' +
        '<article class="card panel"><h3>Suggest a dataset</h3><p class="muted">Provide a landing page, stable identifier, license, task description, and why it contains static telecom ML data.</p><a class="btn btn-light" href="https://github.com/MrAntonS/TeleMLEBench/issues/new" target="_blank" rel="noopener">Open an issue ↗</a></article>' +
        '<article class="card panel"><h3>Link a paper</h3><p class="muted">Name the dataset version and quote the passage showing actual training or evaluation use.</p><a class="btn btn-light" href="https://github.com/MrAntonS/TeleMLEBench/issues/new" target="_blank" rel="noopener">Submit evidence ↗</a></article>' +
        '<article class="card panel"><h3>Correct or remove</h3><p class="muted">Report a license, provenance, sensitivity, identity, or takedown concern with supporting evidence.</p><a class="btn btn-light" href="https://github.com/MrAntonS/TeleMLEBench/issues/new" target="_blank" rel="noopener">Report a correction ↗</a></article>' +
      '</div><h2>Pull requests</h2><p>Code, documentation, source adapters, reviewed task recipes, and test fixtures are welcome. Do not commit dataset payloads, credentials, paywalled papers, or personal data.</p></div></main>';
  }

  function currentPage() {
    if (state.route.name === 'datasets') return datasetsPage();
    if (state.route.name === 'dataset') return detailPage();
    if (state.route.name === 'papers') return papersPage();
    if (state.route.name === 'reproductions') return reproductionsPage();
    if (state.route.name === 'methodology') return methodologyPage();
    if (state.route.name === 'coverage') return coveragePage();
    if (state.route.name === 'contribute') return contributePage();
    return homePage();
  }

  function render() {
    app.innerHTML = '<div class="shell">' + header() + currentPage() + footer() + '</div>';
    document.title = pageTitle();
  }

  function pageTitle() {
    var labels = { datasets:'Datasets', dataset:state.detail ? state.detail.dataset.name : 'Dataset', papers:'Papers', reproductions:'Reproductions', methodology:'Methodology', coverage:'Coverage', contribute:'Contribute' };
    return (labels[state.route.name] ? labels[state.route.name] + ' — ' : '') + 'TeleMLEBench';
  }

  function parseRoute() {
    var raw = (window.location.hash || '#/home').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    var allowed = ['home','datasets','papers','reproductions','methodology','coverage','contribute'];
    if (parts[0] === 'dataset' && parts[1]) return { name:'dataset', slug:decodeURIComponent(parts.slice(1).join('/')) };
    return { name:allowed.indexOf(parts[0]) >= 0 ? parts[0] : 'home' };
  }

  function syncRoute() {
    state.route = parseRoute();
    state.navOpen = false;
    state.error = '';
    window.scrollTo(0, 0);
    if (state.route.name === 'home' || state.route.name === 'datasets') loadCore();
    else if (state.route.name === 'dataset') loadDetail(state.route.slug);
    else if (state.route.name === 'papers') loadPapers();
    else if (state.route.name === 'reproductions') loadReproductions();
    else if (state.route.name === 'coverage') loadCoverage();
    else render();
  }

  function retry() {
    state.error = '';
    if (state.route.name === 'dataset') loadDetail(state.route.slug);
    else if (state.route.name === 'papers') loadPapers();
    else if (state.route.name === 'reproductions') loadReproductions();
    else if (state.route.name === 'coverage') loadCoverage();
    else { state.datasetsLoaded = false; loadCore(); }
  }

  app.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'toggle-nav') {
      state.navOpen = !state.navOpen;
      render();
    } else if (action === 'retry') retry();
    else if (action === 'clear-filters') {
      state.filters = { query:'', task:'all', origin:'all', access:'all', source:'all' };
      render();
    }
  });

  app.addEventListener('input', function (event) {
    var key = event.target.getAttribute('data-filter');
    if (!key) return;
    state.filters[key] = event.target.value;
    var caret = event.target.selectionStart;
    render();
    if (key === 'query') {
      var input = document.getElementById('filter-query');
      if (input) { input.focus(); input.setSelectionRange(caret, caret); }
    }
  });

  app.addEventListener('change', function (event) {
    var key = event.target.getAttribute('data-filter');
    if (!key) return;
    state.filters[key] = event.target.value;
    render();
  });

  window.addEventListener('hashchange', syncRoute);
  syncRoute();
}());
