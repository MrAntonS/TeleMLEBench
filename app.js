// TeleMLEBench — standalone implementation of TeleMLEBench.dc.html
// Ported from the claude.ai/design "design comp" (which ran inside the proprietary
// support.js React runtime). This version is dependency-free vanilla JS/DOM.
//
// Data is loaded live from the TeleMLEBench REST API (base path /api/v1):
//   GET /benchmarks            -> leaderboard cards (home + datasets grid)
//   GET /benchmarks/{slug}     -> full benchmark detail (leaderboard + features)
//   GET /stats                 -> hero counters
// The API base URL comes from (in priority order):
//   ?api=<url> query param  ->  window.TMLB_API_BASE  ->  <meta name="tmlb-api-base">
//   ->  http://localhost:8080/api/v1 (default, matches `uvicorn api:app --port 8080`).
//
// Logic functions (fmtScore, fmtDelta, fmtDate, topVerified, displayRow, buildRows,
// categories, renderVals) are faithful ports of the original component; the data layer
// (API client + adapters + loading/error states) is the new part.

(function () {
  "use strict";

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var root = document.getElementById('app');

  // ------------------------------------------------------------- API client
  function getApiBase() {
    var qp = null;
    try { qp = new URLSearchParams(location.search).get('api'); } catch (e) {}
    if (qp) return qp.replace(/\/+$/, '');
    if (window.TMLB_API_BASE) return String(window.TMLB_API_BASE).replace(/\/+$/, '');
    var meta = document.querySelector('meta[name="tmlb-api-base"]');
    if (meta && meta.getAttribute('content')) return meta.getAttribute('content').replace(/\/+$/, '');
    return 'http://localhost:8080/api/v1';
  }

  // GET a path under the API base; resolves to parsed JSON, rejects with an Error
  // carrying .status and .code (parsed from the API's { error: {...} } envelope).
  function apiGet(path) {
    var url = getApiBase() + path;
    return fetch(url).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        if (txt) { try { body = JSON.parse(txt); } catch (e) { body = null; } }
        if (!res.ok) {
          var msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.code = body && body.error && body.error.code;
          throw err;
        }
        return body;
      });
    });
  }

  function friendlyErr(err) {
    var base = getApiBase();
    if (err && err.status) {
      return 'API responded ' + err.status + ' from ' + base + (err.message ? ' — ' + err.message : '') + '.';
    }
    return 'Could not reach the API at ' + base + '. Check that it is running and that CORS allows this origin.';
  }

  // ------------------------------------------------------------------ state
  var state = {
    route: 'home',
    activeId: null,
    query: '',
    catFilter: 'All',
    sortMode: 'reproduced',
    panelSubId: null,
    disputeOpen: false,
    submitOpen: false,

    // data + async status
    cards: [],
    cardsLoading: false,
    cardsError: null,
    statsData: null,
    detailCache: {},
    detailLoading: false,
    detailError: null,
    detailErrorStatus: null,

    // live runs
    runSlug: null,
    workers: [],
    download: null,
    scan: null,

    // AI relevance judgments
    judgments: null,
    judgLoading: false,
    judgError: null,
    judgFold: false,
    judgOpenIdx: null,
    judgMore: [],
    judgMoreLoading: false,

    // full approved catalog (all is_telecom datasets, papers or not)
    catalogItems: [],
    catalogLoading: false,
    catalogError: null,
    catalogDone: false,
    catalogQuery: '',
    runsList: [],
    runsLoading: false,
    runsError: null,
    runDetail: null,
    runLoading: false,
    runError: null,
    runSel: null,      // selected attempt number (defaults to latest)
    runDiff: false
  };

  var pendingFocus = null; // {id, caret} — restore caret into a search box after re-render

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  // --------------------------------------------------------------- adapters
  function numOrDash(v) { return (v === null || v === undefined) ? '—' : v; }

  // Mirror the API's metric_meta display rule so Claimed/Verified/Δ stay consistent:
  // fraction metrics (suffix "%") are shown ×100 when the stored value is a fraction
  // (|v| <= 1.5). The API delivers `score`/`topScore` already display-normalized; this
  // also normalizes any raw value (e.g. an un-scaled claimedScore) the same way.
  function toDisplay(v, suffix) {
    if (v === null || v === undefined) return null;
    if (suffix === '%' && Math.abs(v) <= 1.5) return v * 100;
    return v;
  }

  // /benchmarks card -> the view-model cardHTML/search expect.
  function adaptCard(b) {
    b = b || {};
    var meta = { decimals: (b.decimals != null ? b.decimals : 3), suffix: (b.suffix != null ? b.suffix : '') };
    return {
      id: b.id,
      name: b.name || b.id || 'Untitled',
      category: b.category || '',
      desc: b.description || '',           // /benchmarks cards may omit description
      taskType: b.taskType || '',          // and taskType — used only for search text
      metric: b.metric || '—',
      subCount: (b.submissionCount != null ? b.submissionCount : 0),
      paperCount: (b.paperCount != null ? b.paperCount : 0),
      reproRunning: !!b.reproRunning,
      topScore: (b.topScore != null ? fmtScore(toDisplay(b.topScore, meta.suffix), meta) : '—')
    };
  }

  // /benchmarks/{slug} submission -> row shape used by displayRow/buildRows.
  function adaptSub(s, suffix) {
    s = s || {};
    return {
      id: s.id,
      source: s.source,
      paperTitle: s.paperTitle || '',
      authors: s.authors || '',
      paperLink: s.paperLink || '#',
      codeLink: s.codeLink || null,
      claimedScore: toDisplay((s.claimedScore != null ? s.claimedScore : null), suffix),
      score: toDisplay((s.score != null ? s.score : null), suffix),
      reproStatus: s.reproStatus || 'n/a',
      reproLink: s.reproLink || null,
      date: s.date || '',
      flag: s.flag || null,
      note: s.note || ''
    };
  }

  // /benchmarks/{slug} detail -> the dataset object the renderer expects, with safe
  // defaults so null/missing fields (taskType, features.dist, …) never break rendering.
  function adaptDetail(d) {
    d = d || {};
    var f = d.features || {};
    var dist = f.dist || {};
    var suffix = (d.suffix != null ? d.suffix : '');
    function part(p) { p = p || {}; return { rows: numOrDash(p.rows), size: numOrDash(p.size) }; }
    return {
      id: d.id,
      name: d.name || d.id || 'Untitled',
      category: d.category || '',
      taskType: d.taskType || '—',
      mlType: d.mlType || '—',
      description: d.description || '',
      taskDef: d.taskDef || '—',
      metric: d.metric || '—',
      decimals: (d.decimals != null ? d.decimals : 3),
      suffix: suffix,
      higherIsBetter: d.higherIsBetter !== false,   // default true
      accessLink: d.accessLink || '#',
      features: {
        samples: numOrDash(f.samples),
        split: numOrDash(f.split),
        format: numOrDash(f.format),
        size: numOrDash(f.size),
        columns: Array.isArray(f.columns) ? f.columns : [],
        rows: Array.isArray(f.rows) ? f.rows : [],
        dist: {
          train: part(dist.train),
          val: part(dist.val),
          test: part(dist.test),
          subFile: dist.subFile || 'submission.csv',
          subLines: Array.isArray(dist.subLines) ? dist.subLines : []
        }
      },
      submissions: Array.isArray(d.submissions) ? d.submissions.map(function (s) { return adaptSub(s, suffix); }) : []
    };
  }

  function adaptStats(s, cards, total) {
    s = s || {};
    function pick(keys) { for (var i = 0; i < keys.length; i++) { if (s[keys[i]] != null) return s[keys[i]]; } return null; }
    var benchmarks = pick(['live_benchmarks', 'benchmarks', 'benchmark_count']);
    var submissions = pick(['submissions', 'submission_count']);
    var reproductions = pick(['reproductions', 'reproduction_count']);
    var papers = pick(['papers', 'paper_count', 'papers_tracked']);
    // Best-effort fallbacks from the cards feed if /stats omits a counter.
    if (benchmarks == null && total != null) benchmarks = total;
    if (Array.isArray(cards)) {
      if (submissions == null) submissions = cards.reduce(function (a, c) { return a + (c.subCount || 0); }, 0) || null;
      if (papers == null) papers = cards.reduce(function (a, c) { return a + (c.paperCount || 0); }, 0) || null;
    }
    return {
      benchmarks: numOrDash(benchmarks),
      submissions: numOrDash(submissions),
      papers: numOrDash(papers),
      reproductions: numOrDash(reproductions)
    };
  }

  // ----------------------------------------------------------- data loading
  function loadCards() {
    setState({ cardsLoading: true, cardsError: null });
    Promise.all([
      apiGet('/benchmarks?limit=200'),
      apiGet('/stats').catch(function () { return null; })   // stats is non-critical
    ]).then(function (res) {
      var list = res[0] || {};
      var statsRaw = res[1];
      var items = Array.isArray(list.items) ? list.items : [];
      var cards = items.map(adaptCard);
      setState({
        cards: cards,
        statsData: adaptStats(statsRaw, cards, list.total),
        cardsLoading: false,
        cardsError: null
      });
    }).catch(function (err) {
      setState({ cardsLoading: false, cardsError: friendlyErr(err) });
    });
  }

  function loadDetail(slug) {
    if (!slug) return;
    setState({ detailLoading: true, detailError: null, detailErrorStatus: null });
    apiGet('/benchmarks/' + encodeURIComponent(slug)).then(function (d) {
      var cache = Object.assign({}, state.detailCache);
      cache[slug] = adaptDetail(d);
      setState({ detailCache: cache, detailLoading: false, detailError: null, detailErrorStatus: null });
    }).catch(function (err) {
      setState({ detailLoading: false, detailError: friendlyErr(err), detailErrorStatus: err && err.status });
    });
  }

  // ------------------------------------------------------------ live runs
  function loadRuns(silent) {
    if (!silent) setState({ runsLoading: true, runsError: null });
    Promise.all([
      apiGet('/runs'),
      apiGet('/workers').catch(function () { return null; })  // status strip is best-effort
    ]).then(function (res) {
      setState({
        runsList: (res[0] && res[0].items) || [],
        workers: (res[1] && res[1].items) || state.workers,
        download: res[1] ? (res[1].download || null) : state.download,
        scan: res[1] ? (res[1].scan || null) : state.scan,
        runsLoading: false, runsError: null
      });
    }).catch(function (err) {
      setState({ runsLoading: false, runsError: silent ? state.runsError : friendlyErr(err) });
    });
  }

  function loadRun(slug, silent) {
    if (!slug) return;
    if (!silent) setState({ runLoading: true, runError: null });
    apiGet('/runs/' + encodeURIComponent(slug)).then(function (d) {
      var sel = state.runSel;
      var atts = (d && d.attempts) || [];
      if (!sel || !atts.some(function (a) { return a.n === sel; })) {
        sel = atts.length ? atts[atts.length - 1].n : null;
      }
      setState({ runDetail: d, runLoading: false, runError: null, runSel: sel });
    }).catch(function (err) {
      setState({ runLoading: false, runError: silent ? state.runError : friendlyErr(err) });
    });
  }

  function loadJudgments(silent) {
    if (!silent) setState({ judgLoading: true, judgError: null });
    Promise.all([
      apiGet('/judgments?limit=10'),
      apiGet('/workers').catch(function () { return null; })
    ]).then(function (res) {
      setState({
        judgments: res[0],
        workers: (res[1] && res[1].items) || state.workers,
        scan: res[1] ? (res[1].scan || null) : state.scan,
        judgLoading: false, judgError: null
      });
    }).catch(function (err) {
      setState({ judgLoading: false, judgError: silent ? state.judgError : friendlyErr(err) });
    });
  }

  function loadCatalog(reset) {
    if (reset) setState({ catalogItems: [], catalogDone: false });
    var offset = reset ? 0 : state.catalogItems.length;
    setState({ catalogLoading: true, catalogError: null });
    var q = state.catalogQuery ? '&q=' + encodeURIComponent(state.catalogQuery) : '';
    apiGet('/datasets?limit=30&offset=' + offset + q).then(function (d) {
      var items = (d && d.items) || [];
      setState({
        catalogItems: (reset ? [] : state.catalogItems).concat(items),
        catalogDone: items.length < 30,
        catalogLoading: false
      });
    }).catch(function (err) {
      setState({ catalogLoading: false, catalogError: friendlyErr(err) });
    });
  }

  // Poll while a live-runs page is visible: silent refreshes keep the epoch bar,
  // console line and attempt list moving without flickering the whole page.
  setInterval(function () {
    if (state.route === 'run' && state.runSlug) loadRun(state.runSlug, true);
    else if (state.route === 'runs') loadRuns(true);
    else if (state.route === 'judgments') loadJudgments(true);
  }, 4000);

  // ------------------------------------------------------- text escaping
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------- formatting
  function fmtScore(v, ds) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v.toFixed(ds.decimals) + ds.suffix).replace('-', '−');
  }
  function fmtDelta(d, ds) {
    if (d === null || d === undefined) return '—';
    var sign = d > 0.0001 ? '+' : (d < -0.0001 ? '−' : '±');
    return sign + Math.abs(d).toFixed(ds.decimals) + ds.suffix;
  }
  function fmtDate(s) {
    if (!s) return '—';
    var p = s.split('-').map(Number);
    var mo = MONTHS[p[1] - 1];
    if (!mo || isNaN(p[2]) || isNaN(p[0])) return s;
    return mo + ' ' + p[2] + ', ' + p[0];
  }

  function topVerified(ds) {
    var c = ds.submissions.filter(function (s) {
      return s.score != null && s.reproStatus !== 'failed' && s.flag !== 'suspect';
    });
    if (!c.length) return null;
    return c.reduce(function (b, s) {
      return (ds.higherIsBetter ? s.score > b.score : s.score < b.score) ? s : b;
    });
  }

  // --------------------------------------------------------- row view-model
  function displayRow(sub, ds, opts) {
    opts = opts || {};
    var isAI = sub.source === 'ai_reproduced';
    var isAuthor = sub.source === 'author_submitted';
    var isBase = sub.source === 'baseline';
    var suspect = sub.flag === 'suspect';

    var badgeLabel, badgeStyle;
    if (isBase) { badgeLabel = 'Official baseline'; badgeStyle = 'background:#f1f2f4;color:#5b616e;border:1px solid #e3e5e9;'; }
    else if (isAuthor) { badgeLabel = 'Author-verified'; badgeStyle = 'background:#2563eb;color:#fff;border:1px solid #2563eb;'; }
    else { badgeLabel = 'AI-reproduced'; badgeStyle = 'background:#fff;color:#2563eb;border:1px solid #b9ccf7;'; }

    var claimedDisp = fmtScore(sub.claimedScore, ds);
    var verifiedDisp = fmtScore(sub.score, ds);

    var deltaDisp = '—', deltaStyle = 'color:#9aa0ab;';
    if (sub.claimedScore != null && sub.score != null) {
      var draw = sub.claimedScore - sub.score;
      deltaDisp = fmtDelta(draw, ds);
      var worse = ds.higherIsBetter ? (sub.score < sub.claimedScore) : (sub.score > sub.claimedScore);
      var better = ds.higherIsBetter ? (sub.score > sub.claimedScore) : (sub.score < sub.claimedScore);
      var mag = Math.abs(draw);
      var bigThresh = ds.suffix === '%' ? 3 : (ds.suffix === ' dB' ? 1.5 : 0.04);
      if (suspect) deltaStyle = 'color:#b45309;font-weight:600;';
      else if (worse && mag >= bigThresh) deltaStyle = 'color:#dc2626;font-weight:600;';
      else if (worse) deltaStyle = 'color:#dc2626;';
      else if (better) deltaStyle = 'color:#15803d;';
      else deltaStyle = 'color:#5b616e;';
    }

    var statusLabel = null, statusStyle = '';
    if (isAI) {
      if (suspect) { statusLabel = 'suspect'; statusStyle = 'background:#fff7ed;color:#b45309;border:1px solid #fed7aa;'; }
      else if (sub.reproStatus === 'success') { statusLabel = 'reproduced'; statusStyle = 'background:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;'; }
      else if (sub.reproStatus === 'partial') { statusLabel = 'partial'; statusStyle = 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;'; }
      else if (sub.reproStatus === 'failed') { statusLabel = 'failed'; statusStyle = 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;'; }
      else if (sub.reproStatus === 'queued') { statusLabel = 'queued'; statusStyle = 'background:#f5f8ff;color:#2563eb;border:1px solid #dbe6fd;'; }
      else if (sub.reproStatus === 'running') { statusLabel = 'reproducing'; statusStyle = 'background:#eef4ff;color:#2563eb;border:1px solid #b9ccf7;'; }
      else if (sub.reproStatus === 'blocked') { statusLabel = 'cannot reproduce'; statusStyle = 'background:#f1f2f4;color:#5b616e;border:1px solid #e3e5e9;'; }
    }

    var rankLabel = opts.isBaseline ? 'base' : ((opts.failed || opts.queued) ? '—' : String(opts.rank));

    var rowStyle = 'background:#fff;';
    if (opts.isBaseline) rowStyle = 'background:#fafbfc;box-shadow:inset 3px 0 0 #d4d7dd;';
    else if (opts.rank === 1) rowStyle = 'background:#f5f8ff;box-shadow:inset 3px 0 0 #2563eb;';
    if (opts.failed) rowStyle = 'background:#fff;opacity:0.6;';
    if (isAI) rowStyle += 'cursor:pointer;';

    return {
      id: sub.id, rankLabel: rankLabel, isTop: opts.rank === 1, isBaseline: !!opts.isBaseline, failed: !!opts.failed,
      paperTitle: sub.paperTitle, authors: sub.authors, paperLink: sub.paperLink, codeLink: sub.codeLink, hasCode: !!sub.codeLink,
      badgeLabel: badgeLabel, badgeStyle: badgeStyle, claimedDisp: claimedDisp, verifiedDisp: verifiedDisp, deltaDisp: deltaDisp, deltaStyle: deltaStyle,
      statusLabel: statusLabel, statusStyle: statusStyle, hasStatus: !!statusLabel, isAI: isAI,
      running: sub.reproStatus === 'running',
      date: fmtDate(sub.date), reproLink: sub.reproLink, hasRepro: isAI && !!sub.reproLink,
      dateRepro: fmtDate(sub.date), note: sub.note,
      rowStyle: rowStyle,
      titleStyle: opts.failed ? 'text-decoration:line-through;text-decoration-color:#cbd0d8;' : '',
      openPanelId: isAI ? sub.id : null
    };
  }

  function buildRows(ds, sortMode) {
    var subs = ds.submissions;
    var baseline = subs.find(function (s) { return s.source === 'baseline'; });
    var failed = subs.filter(function (s) { return s.reproStatus === 'failed'; });
    var UNRANKED = { queued: 1, running: 1, blocked: 1 };
    var queued = subs.filter(function (s) { return UNRANKED[s.reproStatus]; });
    // running first, then queued, blocked last
    var qOrder = { running: 0, queued: 1, blocked: 2 };
    queued.sort(function (a, b) { return qOrder[a.reproStatus] - qOrder[b.reproStatus]; });
    var ranked = subs.filter(function (s) { return s.source !== 'baseline' && s.reproStatus !== 'failed' && !UNRANKED[s.reproStatus] && s.score != null; });
    var key = sortMode === 'claimed' ? 'claimedScore' : 'score';
    ranked.sort(function (a, b) {
      var av = (a[key] != null ? a[key] : a.score), bv = (b[key] != null ? b[key] : b.score);
      return ds.higherIsBetter ? bv - av : av - bv;
    });
    var out = [];
    if (baseline) out.push(displayRow(baseline, ds, { isBaseline: true }));
    ranked.forEach(function (s, i) { out.push(displayRow(s, ds, { rank: i + 1 })); });
    queued.forEach(function (s) { out.push(displayRow(s, ds, { queued: true })); });
    failed.forEach(function (s) { out.push(displayRow(s, ds, { failed: true })); });
    return out;
  }

  function categories() {
    var set = ['All'];
    (state.cards || []).forEach(function (c) { if (c.category && set.indexOf(c.category) === -1) set.push(c.category); });
    var active = state.catFilter;
    return set.map(function (c) {
      return {
        label: c,
        active: c === active,
        style: c === active
          ? 'background:#14161a;color:#fff;border:1px solid #14161a;padding:8px 15px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;'
          : 'background:#fff;color:#5b616e;border:1px solid #e3e5e9;padding:8px 15px;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer;white-space:nowrap;'
      };
    });
  }

  function renderVals() {
    var s = state;
    var cardsArr = s.cards || [];
    var q = s.query.trim().toLowerCase();
    var filtered = cardsArr.filter(function (c) {
      var okCat = s.catFilter === 'All' || c.category === s.catFilter;
      var okQ = !q || (c.name + ' ' + c.desc + ' ' + c.taskType + ' ' + c.category).toLowerCase().indexOf(q) !== -1;
      return okCat && okQ;
    });

    var ds = s.activeId ? (s.detailCache[s.activeId] || null) : null;
    var detail = null, rows = [], preview = null, splits = [], subFile = '', subLines = [];
    if (ds) {
      rows = buildRows(ds, s.sortMode);
      preview = ds.features;
      var D = ds.features.dist;
      splits = [
        { label: 'Train split', parts: 'X + y', rows: D.train.rows, size: D.train.size, withheld: false },
        { label: 'Validation split', parts: 'X + y', rows: D.val.rows, size: D.val.size, withheld: false },
        { label: 'Test split', parts: 'X only', rows: D.test.rows, size: D.test.size, withheld: true }
      ];
      subFile = D.subFile; subLines = D.subLines;
      var top = topVerified(ds);
      detail = {
        name: ds.name, category: ds.category, description: ds.description, taskDef: ds.taskDef, taskType: ds.taskType, mlType: ds.mlType,
        metric: ds.metric, metricDir: ds.higherIsBetter ? 'higher is better' : 'lower is better',
        accessLink: ds.accessLink,
        topVerifiedDisp: top ? fmtScore(top.score, ds) : '—',
        reproCount: ds.submissions.filter(function (x) { return x.source === 'ai_reproduced'; }).length
      };
    }

    var panel = null;
    if (s.panelSubId && ds) {
      var sub = ds.submissions.find(function (x) { return x.id === s.panelSubId; });
      if (sub) panel = displayRow(sub, ds, {});
    }

    return Object.assign(runVals(s), {
      isHome: s.route === 'home',
      isDatasets: s.route === 'datasets',
      isDataset: s.route === 'dataset',
      routeDs: (s.route === 'datasets' || s.route === 'dataset'),
      routeRuns: (s.route === 'runs' || s.route === 'run'),
      activeId: s.activeId,
      query: s.query,
      stats: s.statsData || { benchmarks: '—', submissions: '—', papers: '—', reproductions: '—' },
      cardsLoading: s.cardsLoading, cardsError: s.cardsError,
      featured: cardsArr.slice(0, 12), filtered: filtered, filteredCount: filtered.length, cats: categories(),
      detail: detail, rows: rows, preview: preview, splits: splits, subFile: subFile, subLines: subLines, sortMode: s.sortMode,
      detailLoading: s.detailLoading, detailError: s.detailError, detailErrorStatus: s.detailErrorStatus,
      panel: panel, panelOpen: !!panel,
      disputeOpen: s.disputeOpen,
      submitOpen: s.submitOpen
    });
  }

  // -------------------------------------------------------------- icons
  function iconDownload(stroke, size) {
    size = size || 16; stroke = stroke || 'currentColor';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
  }
  function iconFile(stroke) {
    stroke = stroke || 'currentColor';
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
  }
  function iconCode(stroke) {
    stroke = stroke || 'currentColor';
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
  }
  function iconCheck() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>';
  }
  function iconPlus() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  }
  function iconUpload() {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9aa0ab" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>';
  }
  function iconSearch(size) {
    size = size || 18;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  }

  // ------------------------------------------------------ loading / error UI
  function loadingBlock(label) {
    return '<div style="border:1px solid #e9eaee;background:#fff;border-radius:14px;padding:46px 28px;text-align:center;color:#6b7280;font-size:14px;">' +
      '<span class="tml-spinner"></span>' +
      '<div style="margin-top:13px;">' + esc(label || 'Loading…') + '</div>' +
    '</div>';
  }
  function stateBlock(title, message, actLabel, act, tone) {
    var isErr = tone === 'error';
    var btn = act
      ? '<button data-act="' + esc(act) + '" class="tml-primary" style="margin-top:16px;background:#2563eb;color:#fff;border:none;border-radius:9px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">' + esc(actLabel || 'Retry') + '</button>'
      : '';
    return '<div style="border:1px solid ' + (isErr ? '#fecaca' : '#e9eaee') + ';background:' + (isErr ? '#fef2f2' : '#fff') + ';border-radius:14px;padding:46px 28px;text-align:center;">' +
      '<div style="font-size:15.5px;font-weight:600;color:' + (isErr ? '#b91c1c' : '#14161a') + ';">' + esc(title) + '</div>' +
      (message ? '<div style="font-size:13.5px;color:' + (isErr ? '#b45309' : '#6b7280') + ';margin-top:8px;line-height:1.55;max-width:540px;margin-left:auto;margin-right:auto;">' + esc(message) + '</div>' : '') +
      btn +
    '</div>';
  }

  // cards grid, or the appropriate loading / error / empty state.
  function cardsSection(v, list) {
    if (v.cardsError) return stateBlock('Couldn’t reach the API', v.cardsError, 'Retry', 'retry-cards', 'error');
    if (v.cardsLoading && !(list && list.length)) return loadingBlock('Loading benchmarks…');
    if (!(list && list.length)) {
      return stateBlock('No benchmarks found', v.query ? 'Try a different search or filter.' : 'The API returned no benchmarks yet.', null, null, 'neutral');
    }
    return '<div class="tml-cardgrid">' + list.map(cardHTML).join('') + '</div>';
  }

  // -------------------------------------------------------------- views
  function navHTML(v) {
    var navBase = 'font-size:14px;font-weight:500;padding:7px 13px;border-radius:7px;border:none;background:none;cursor:pointer;';
    var homeStyle = navBase + (v.isHome ? 'color:#14161a;background:#f1f2f4;' : 'color:#5b616e;');
    var dsStyle = navBase + (v.routeDs ? 'color:#14161a;background:#f1f2f4;' : 'color:#5b616e;');
    var runsStyle = navBase + (v.routeRuns ? 'color:#14161a;background:#f1f2f4;' : 'color:#5b616e;');
    var judgStyle = navBase + (v.isJudgments ? 'color:#14161a;background:#f1f2f4;' : 'color:#5b616e;');
    var catStyle = navBase + (v.isCatalog ? 'color:#14161a;background:#f1f2f4;' : 'color:#5b616e;');
    return '' +
    '<header style="position:sticky;top:0;z-index:30;background:rgba(255,255,255,0.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #ececef;">' +
      '<div style="max-width:1120px;margin:0 auto;padding:0 28px;height:62px;display:flex;align-items:center;justify-content:space-between;">' +
        '<div data-act="home" style="display:flex;align-items:center;gap:11px;cursor:pointer;">' +
          '<div style="width:28px;height:28px;border-radius:7px;background:#2563eb;display:flex;align-items:flex-end;justify-content:center;gap:2.5px;padding:7px 6px;">' +
            '<div style="width:3px;height:7px;background:#fff;border-radius:1px;opacity:.65;"></div>' +
            '<div style="width:3px;height:11px;background:#fff;border-radius:1px;opacity:.82;"></div>' +
            '<div style="width:3px;height:15px;background:#fff;border-radius:1px;"></div>' +
          '</div>' +
          '<span style="font-size:16px;font-weight:600;letter-spacing:-0.02em;">TeleMLEBench</span>' +
        '</div>' +
        '<nav style="display:flex;gap:4px;align-items:center;">' +
          '<button data-act="home" style="' + homeStyle + '">Home</button>' +
          '<button data-act="datasets" style="' + dsStyle + '">Datasets</button>' +
          '<button data-act="runs" style="' + runsStyle + '">Live runs</button>' +
          '<button data-act="judgments" style="' + judgStyle + '">Judgments</button>' +
          '<button data-act="catalog" style="' + catStyle + '">Catalog</button>' +
          '<a href="#" data-stop style="font-size:14px;font-weight:500;color:#5b616e;padding:7px 13px;border-radius:7px;text-decoration:none;">About</a>' +
        '</nav>' +
      '</div>' +
    '</header>';
  }

  function statBlock(num, label, color) {
    return '<div>' +
      '<div class="mono" style="font-size:34px;font-weight:600;letter-spacing:-0.02em;' + (color ? 'color:' + color + ';' : '') + '">' + esc(num) + '</div>' +
      '<div style="font-size:13.5px;color:#8a8f9a;margin-top:4px;">' + esc(label) + '</div>' +
    '</div>';
  }

  function cardHTML(card) {
    var runningChip = card.reproRunning
      ? '<span style="display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#2563eb;background:#eef4ff;border:1px solid #b9ccf7;padding:4px 9px;border-radius:6px;margin-left:7px;"><span class="tml-spinner-xs"></span>reproducing</span>'
      : '';
    return '' +
    '<div data-open="' + esc(card.id) + '" class="tml-card' + (card.reproRunning ? ' tml-running' : '') + '">' +
      '<div style="display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#2563eb;background:#f5f8ff;border:1px solid #e2ebfd;padding:4px 9px;border-radius:6px;">' + esc(card.category) + '</div>' + runningChip +
      '<h3 style="margin:13px 0 8px;font-size:18px;font-weight:600;letter-spacing:-0.015em;line-height:1.25;">' + esc(card.name) + '</h3>' +
      '<p class="tml-clamp2" style="margin:0;font-size:13.5px;line-height:1.5;color:#6b7280;">' + esc(card.desc) + '</p>' +
      '<div style="margin:18px 0 0;padding-top:15px;border-top:1px solid #f1f2f4;display:flex;align-items:flex-end;justify-content:space-between;">' +
        '<div>' +
          '<div style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">Top verified</div>' +
          '<div class="mono" style="font-size:18px;font-weight:600;">' + esc(card.topScore) + '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:12.5px;color:#6b7280;font-weight:500;">' + esc(card.metric) + '</div>' +
          '<div style="font-size:12px;color:#9aa0ab;margin-top:2px;">' + esc(card.subCount) + ' submissions</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function homeHTML(v) {
    return '' +
    '<main>' +
      '<section class="tml-herosec" style="max-width:1120px;margin:0 auto;padding:96px 28px 64px;">' +
        '<h1 class="tml-hero" style="margin:0;font-size:54px;line-height:1.04;letter-spacing:-0.033em;font-weight:600;max-width:880px;">Every telecom-ML benchmark, with the numbers actually reproduced.</h1>' +
        '<p style="margin:24px 0 0;font-size:19px;line-height:1.55;color:#5b616e;max-width:660px;">A searchable catalog of channel estimation, beamforming, modulation classification and more — where each leaderboard shows not just what a paper <em style="font-style:normal;color:#14161a;">claims</em>, but what we independently <em style="font-style:normal;color:#14161a;">reproduced</em>.</p>' +
        '<div style="margin-top:36px;max-width:600px;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #e3e5e9;border-radius:13px;padding:6px 6px 6px 16px;box-shadow:0 1px 2px rgba(20,22,26,0.04);">' +
          iconSearch(18) +
          '<input id="home-search" data-query value="' + esc(v.query) + '" placeholder="Search benchmarks, tasks, or datasets…" style="flex:1;border:none;outline:none;font-size:15.5px;background:transparent;color:#14161a;padding:8px 0;" />' +
          '<button data-act="search" class="tml-primary" style="background:#2563eb;color:#fff;border:none;border-radius:9px;padding:11px 20px;font-size:14.5px;font-weight:600;cursor:pointer;">Search</button>' +
        '</div>' +
        '<div style="margin-top:56px;display:flex;flex-wrap:wrap;gap:48px;border-top:1px solid #ececef;padding-top:34px;">' +
          statBlock(v.stats.benchmarks, 'Benchmarks') +
          statBlock(v.stats.submissions, 'Submissions') +
          statBlock(v.stats.papers, 'Papers tracked') +
          statBlock(v.stats.reproductions, 'Independent reproductions', '#2563eb') +
        '</div>' +
      '</section>' +
      '<section style="max-width:1120px;margin:0 auto;padding:8px 28px 110px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:22px;">' +
          '<h2 style="margin:0;font-size:21px;font-weight:600;letter-spacing:-0.02em;">Featured benchmarks</h2>' +
          '<button data-act="datasets" class="tml-primary" style="background:none;border:none;color:#2563eb;font-size:14px;font-weight:600;cursor:pointer;padding:0;">Browse all →</button>' +
        '</div>' +
        cardsSection(v, v.featured) +
      '</section>' +
    '</main>';
  }

  function datasetsHTML(v) {
    var chips = v.cats.map(function (c) {
      return '<button data-cat="' + esc(c.label) + '" style="' + c.style + '">' + esc(c.label) + '</button>';
    }).join('');
    var countLine = (v.cardsLoading || v.cardsError) ? '' : (esc(v.filteredCount) + ' datasets');
    return '' +
    '<main style="max-width:1120px;margin:0 auto;padding:54px 28px 110px;">' +
      '<h1 style="margin:0;font-size:34px;font-weight:600;letter-spacing:-0.03em;">Datasets</h1>' +
      '<p style="margin:11px 0 0;font-size:16px;color:#6b7280;max-width:620px;">Telecom-ML benchmark datasets across tasks. Each links to a leaderboard comparing reported and reproduced scores.</p>' +
      '<div style="margin-top:28px;display:flex;align-items:center;gap:10px;max-width:560px;background:#fff;border:1.5px solid #e3e5e9;border-radius:12px;padding:4px 6px 4px 14px;">' +
        iconSearch(17) +
        '<input id="ds-search" data-query value="' + esc(v.query) + '" placeholder="Filter datasets…" style="flex:1;border:none;outline:none;font-size:14.5px;background:transparent;padding:9px 0;" />' +
      '</div>' +
      '<div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:8px;">' + chips + '</div>' +
      '<div style="margin-top:26px;font-size:13px;color:#9aa0ab;">' + countLine + '</div>' +
      '<div style="margin-top:14px;">' + cardsSection(v, v.filtered) + '</div>' +
    '</main>';
  }

  function cell(label, valueHTML, pad) {
    return '<div style="background:#fff;padding:' + (pad || '17px 20px') + ';">' +
      '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.04em;">' + esc(label) + '</div>' +
      valueHTML +
    '</div>';
  }

  function splitCard(sp, accessLink) {
    return '' +
    '<div style="border:1px solid #e9eaee;border-radius:13px;padding:18px;display:flex;flex-direction:column;gap:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span style="font-size:14.5px;font-weight:600;">' + esc(sp.label) + '</span>' +
        (sp.withheld ? '<span style="font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;background:#fff7ed;color:#b45309;border:1px solid #fed7aa;white-space:nowrap;">labels hidden</span>' : '') +
      '</div>' +
      '<div class="mono" style="display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:#6b7280;">' +
        '<span>' + esc(sp.parts) + '</span><span style="color:#cfd3da;">·</span><span>' + esc(sp.rows) + '</span><span style="color:#cfd3da;">·</span><span>' + esc(sp.size) + '</span>' +
      '</div>' +
      '<a href="' + esc(accessLink) + '" target="_blank" rel="noopener" data-stop class="tml-dl">' + iconDownload('currentColor', 15) + 'Download</a>' +
    '</div>';
  }

  function rowHTML(r) {
    var cls = (r.openPanelId ? 'tml-row-ai' : '') + (r.running ? ' tml-running-row' : '');
    var panelAttr = r.openPanelId ? ' data-panel="' + esc(r.openPanelId) + '"' : '';
    var statusHTML = r.hasStatus
      ? '<span style="display:inline-block;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;margin-top:6px;' + r.statusStyle + '">' + (r.running ? '<span class="tml-spinner-xs"></span>' : '') + esc(r.statusLabel) + '</span>'
      : '';
    var codeHTML = r.hasCode
      ? '<a href="' + esc(r.codeLink) + '" target="_blank" rel="noopener" data-stop title="Code" class="tml-iconlink">' + iconCode() + '</a>'
      : '';
    var reproHTML = r.hasRepro
      ? '<span title="View reproduction" style="color:#2563eb;display:inline-flex;cursor:pointer;">' + iconCheck() + '</span>'
      : '';
    var cellBorder = 'border-bottom:1px solid #f1f2f4;vertical-align:top;';
    return '' +
    '<tr class="' + cls + '"' + panelAttr + ' style="' + r.rowStyle + '">' +
      '<td class="mono" style="padding:15px 14px;' + cellBorder + 'font-size:14px;font-weight:600;color:#6b7280;">' + esc(r.rankLabel) + '</td>' +
      '<td style="padding:15px 14px;' + cellBorder + '">' +
        '<div style="font-size:14.5px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;' + r.titleStyle + '">' + esc(r.paperTitle) + '</div>' +
        '<div style="font-size:12.5px;color:#9aa0ab;margin-top:3px;">' + esc(r.authors) + '</div>' +
      '</td>' +
      '<td style="padding:15px 14px;' + cellBorder + '">' +
        '<span style="display:inline-block;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;white-space:nowrap;' + r.badgeStyle + '">' + esc(r.badgeLabel) + '</span>' +
        statusHTML +
      '</td>' +
      '<td class="mono" style="padding:15px 14px;' + cellBorder + 'text-align:right;font-size:14px;color:#9aa0ab;">' + esc(r.claimedDisp) + '</td>' +
      '<td class="mono" style="padding:15px 14px;' + cellBorder + 'text-align:right;font-size:15px;font-weight:600;color:#14161a;">' + esc(r.verifiedDisp) + '</td>' +
      '<td class="mono" style="padding:15px 14px;' + cellBorder + 'text-align:right;font-size:13.5px;' + r.deltaStyle + '">' + esc(r.deltaDisp) + '</td>' +
      '<td style="padding:15px 14px;' + cellBorder + 'font-size:13px;color:#9aa0ab;white-space:nowrap;">' + esc(r.date) + '</td>' +
      '<td style="padding:15px 14px;' + cellBorder + '">' +
        '<div style="display:flex;gap:11px;align-items:center;">' +
          '<a href="' + esc(r.paperLink) + '" target="_blank" rel="noopener" data-stop title="Paper" class="tml-iconlink">' + iconFile() + '</a>' +
          codeHTML + reproHTML +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function th(label, extra) {
    return '<th style="text-align:left;padding:13px 14px;font-size:11px;font-weight:600;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;' + (extra || '') + '">' + label + '</th>';
  }

  function backBtn() {
    return '<button data-act="datasets" class="tml-primary" style="background:none;border:none;color:#6b7280;font-size:13.5px;font-weight:500;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:6px;margin-bottom:24px;">← All datasets</button>';
  }

  function detailHTML(v) {
    var d = v.detail;

    // loading / error / not-found states (no detail loaded yet)
    if (!d) {
      var inner;
      if (v.detailLoading) {
        inner = loadingBlock('Loading benchmark…');
      } else if (v.detailError) {
        if (v.detailErrorStatus === 404) {
          inner = stateBlock('Benchmark not found', 'No benchmark matches “' + (v.activeId || '') + '”.', 'Back to datasets', 'datasets', 'error');
        } else {
          inner = stateBlock('Couldn’t load this benchmark', v.detailError, 'Retry', 'retry-detail', 'error');
        }
      } else {
        inner = loadingBlock('Loading benchmark…');
      }
      return '<main style="max-width:1120px;margin:0 auto;padding:34px 28px 120px;">' + backBtn() + inner + '</main>';
    }

    var p = v.preview;

    var segBase = 'border:none;background:none;padding:8px 15px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';
    var segActive = 'background:#fff;color:#14161a;box-shadow:0 1px 2px rgba(20,22,26,0.1);';
    var segIdle = 'color:#8a8f9a;';
    var sortReproStyle = segBase + (v.sortMode === 'reproduced' ? segActive : segIdle);
    var sortClaimStyle = segBase + (v.sortMode === 'claimed' ? segActive : segIdle);

    var colHeads = p.columns.map(function (col) {
      return '<th class="mono" style="text-align:left;padding:11px 16px;font-size:12px;font-weight:600;color:#2563eb;white-space:nowrap;">' + esc(col) + '</th>';
    }).join('');

    var bodyRows = p.rows.map(function (row, i) {
      var cellsHTML = row.map(function (clv) {
        return '<td class="mono" style="padding:12px 16px;border-bottom:1px solid #f1f2f4;font-size:13px;color:#3d424c;white-space:nowrap;">' + esc(clv) + '</td>';
      }).join('');
      return '<tr>' +
        '<td class="mono" style="text-align:right;padding:12px 14px;border-bottom:1px solid #f1f2f4;font-size:12px;color:#c2c7d0;">' + i + '</td>' +
        cellsHTML +
      '</tr>';
    }).join('');

    var previewTable = (p.columns.length || p.rows.length)
      ? '<div style="margin-top:14px;border:1px solid #e9eaee;border-radius:13px;overflow:hidden;">' +
          '<div style="overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;min-width:520px;">' +
            '<thead><tr style="background:#fafbfc;border-bottom:1px solid #e9eaee;">' +
              '<th style="text-align:right;padding:11px 14px;width:36px;"></th>' + colHeads +
            '</tr></thead>' +
            '<tbody>' + bodyRows + '</tbody>' +
          '</table></div>' +
        '</div>'
      : '';

    return '' +
    '<main style="max-width:1120px;margin:0 auto;padding:34px 28px 120px;">' +
      backBtn() +

      '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:24px;">' +
        '<div style="max-width:680px;">' +
          '<div style="display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#2563eb;background:#f5f8ff;border:1px solid #e2ebfd;padding:4px 9px;border-radius:6px;">' + esc(d.category) + '</div>' +
          '<h1 style="margin:13px 0 0;font-size:33px;font-weight:600;letter-spacing:-0.03em;">' + esc(d.name) + '</h1>' +
          '<p style="margin:13px 0 0;font-size:16px;line-height:1.6;color:#5b616e;">' + esc(d.description) + '</p>' +
        '</div>' +
        '<a href="' + esc(d.accessLink) + '" target="_blank" rel="noopener" data-stop class="tml-dark" style="flex:none;display:inline-flex;align-items:center;gap:8px;background:#14161a;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-size:14.5px;font-weight:600;">' + iconDownload('currentColor', 16) + 'Access dataset</a>' +
      '</div>' +

      // meta strip
      '<div class="tml-grid1 tml-metastrip" style="margin-top:30px;">' +
        cell('Task', '<div style="font-size:14.5px;font-weight:500;margin-top:5px;line-height:1.35;">' + esc(d.taskType) + '</div>') +
        cell('ML type', '<div style="font-size:14.5px;font-weight:500;margin-top:5px;line-height:1.35;">' + esc(d.mlType) + '</div>') +
        cell('Metric', '<div class="mono" style="font-size:14.5px;font-weight:500;margin-top:5px;">' + esc(d.metric) + '</div><div style="font-size:11.5px;color:#9aa0ab;margin-top:3px;">' + esc(d.metricDir) + '</div>') +
        cell('Top verified', '<div class="mono" style="font-size:14.5px;font-weight:600;margin-top:5px;color:#2563eb;">' + esc(d.topVerifiedDisp) + '</div>') +
        cell('Reproductions', '<div class="mono" style="font-size:14.5px;font-weight:500;margin-top:5px;">' + esc(d.reproCount) + '</div>') +
      '</div>' +

      // task definition
      '<div style="margin-top:18px;background:#fafbfc;border:1px solid #eef0f2;border-radius:13px;padding:18px 22px;">' +
        '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:7px;">Task definition</div>' +
        '<p style="margin:0;font-size:14.5px;line-height:1.6;color:#3d424c;">' + esc(d.taskDef) + '</p>' +
      '</div>' +

      // dataset features
      '<div style="margin-top:42px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;gap:14px;">' +
          '<h2 style="margin:0;font-size:18px;font-weight:600;letter-spacing:-0.018em;">Dataset features</h2>' +
          '<span class="mono" style="font-size:12.5px;color:#9aa0ab;">df.head(5)</span>' +
        '</div>' +
        '<div class="tml-grid1 tml-featstrip">' +
          cell('Samples', '<div class="mono" style="font-size:14.5px;font-weight:600;margin-top:5px;">' + esc(p.samples) + '</div>', '15px 18px') +
          cell('Train / val / test', '<div class="mono" style="font-size:14.5px;font-weight:600;margin-top:5px;">' + esc(p.split) + '</div>', '15px 18px') +
          cell('Format', '<div class="mono" style="font-size:13px;font-weight:500;margin-top:5px;line-height:1.4;">' + esc(p.format) + '</div>', '15px 18px') +
          cell('Size', '<div class="mono" style="font-size:14.5px;font-weight:600;margin-top:5px;">' + esc(p.size) + '</div>', '15px 18px') +
        '</div>' +
        previewTable +
      '</div>' +

      // download splits
      '<div style="margin-top:42px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;gap:14px;">' +
          '<h2 style="margin:0;font-size:18px;font-weight:600;letter-spacing:-0.018em;">Download splits</h2>' +
          '<span class="mono" style="font-size:12.5px;color:#9aa0ab;">prediction-file submission</span>' +
        '</div>' +
        '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5b616e;max-width:720px;">Train however you like — locally, in a notebook, anywhere. Run inference on the <strong style="color:#14161a;font-weight:600;">test inputs</strong> and submit a predictions file; it’s scored against the held-out ground truth with <span class="mono" style="color:#14161a;">' + esc(d.metric) + '</span> and the leaderboard updates. Test labels are never released.</p>' +
        '<div class="tml-splitgrid">' + v.splits.map(function (sp) { return splitCard(sp, d.accessLink); }).join('') + '</div>' +
        '<div style="margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;background:#fafbfc;border:1px solid #eef0f2;border-radius:12px;padding:13px 16px;">' +
          '<span style="font-size:13.5px;color:#5b616e;">Need the layout? Grab a sample submission keyed by test <span class="mono">id</span>.</span>' +
          '<a href="' + esc(d.accessLink) + '" target="_blank" rel="noopener" data-stop style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;font-size:13.5px;font-weight:600;color:#2563eb;">↓ sample_submission</a>' +
        '</div>' +
      '</div>' +

      // leaderboard header + toggle
      '<div style="margin-top:46px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;">' +
        '<div>' +
          '<h2 style="margin:0;font-size:22px;font-weight:600;letter-spacing:-0.02em;">Leaderboard</h2>' +
          '<p style="margin:6px 0 0;font-size:13.5px;color:#9aa0ab;">Click any AI-reproduced row to inspect the reproduction.</p>' +
        '</div>' +
        '<div style="display:inline-flex;background:#f1f2f4;border-radius:10px;padding:3px;">' +
          '<button data-sort="reproduced" style="' + sortReproStyle + '">Rank by reproduced</button>' +
          '<button data-sort="claimed" style="' + sortClaimStyle + '">Rank by claimed</button>' +
        '</div>' +
      '</div>' +

      // table
      '<div style="margin-top:18px;border:1px solid #e9eaee;border-radius:14px;overflow:hidden;">' +
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:880px;">' +
          '<thead><tr style="background:#fafbfc;border-bottom:1px solid #e9eaee;">' +
            th('#', 'width:54px;') + th('Paper') + th('Source', 'width:150px;') +
            th('Claimed', 'text-align:right;width:110px;') + th('Verified', 'text-align:right;width:120px;') +
            '<th title="gap between reported and reproduced score" style="text-align:right;padding:13px 14px;font-size:11px;font-weight:600;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;width:96px;cursor:help;">Δ</th>' +
            th('Date', 'width:108px;') + th('Links', 'width:96px;') +
          '</tr></thead>' +
          '<tbody>' + (v.rows.length ? v.rows.map(rowHTML).join('') : '<tr><td colspan="8" style="padding:34px 14px;text-align:center;color:#9aa0ab;font-size:13.5px;">No reproduced baselines or approved submissions yet.</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +

      // legend
      '<div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px;color:#8a8f9a;">' +
        '<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:11px;height:11px;border-radius:3px;background:#2563eb;"></span>Author-verified</span>' +
        '<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:11px;height:11px;border-radius:3px;background:#fff;border:1.5px solid #b9ccf7;"></span>AI-reproduced</span>' +
        '<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:11px;height:11px;border-radius:3px;background:#f1f2f4;border:1px solid #e3e5e9;"></span>Official baseline</span>' +
        '<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:11px;height:11px;border-radius:3px;background:#fff7ed;border:1px solid #fed7aa;"></span>Suspect — gap implies leakage / trivialized task</span>' +
      '</div>' +

      // floating submit FAB
      '<div style="position:fixed;left:24px;bottom:24px;z-index:35;">' +
        '<button data-act="open-submit" class="tml-fab">' +
          '<span class="tml-fab-ico">' + iconPlus() + '</span>' +
          '<span class="tml-fab-label">Submit</span>' +
        '</button>' +
      '</div>' +
    '</main>';
  }

  function submitModalHTML(v) {
    var d = v.detail;
    var lines = v.subLines.map(function (ln) { return '<div>' + esc(ln) + '</div>'; }).join('');
    return '' +
    '<div data-act="close-submit" style="position:fixed;inset:0;background:rgba(20,22,26,0.42);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;animation:tmlFade .16s ease;">' +
      '<div data-stop style="background:#fff;border-radius:16px;width:min(480px,100%);box-shadow:0 24px 70px rgba(20,22,26,0.28);animation:tmlPop .22s cubic-bezier(.2,.7,.3,1);overflow:hidden;">' +
        '<div style="padding:24px 26px 0;">' +
          '<h3 style="margin:0;font-size:19px;font-weight:600;letter-spacing:-0.02em;">Submit test-set predictions</h3>' +
          '<p style="margin:9px 0 0;font-size:14px;line-height:1.55;color:#6b7280;">Run inference on the test inputs and upload your predictions. We score the file against the held-out ground truth with <strong style="color:#14161a;">' + esc(d.metric) + '</strong> and update the leaderboard — labels are never released.</p>' +
        '</div>' +
        '<div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px;">' +
          '<div>' +
            '<label style="display:block;font-size:12.5px;font-weight:600;color:#5b616e;margin-bottom:7px;">Expected format · <span class="mono" style="color:#2563eb;">' + esc(v.subFile) + '</span></label>' +
            '<div class="mono" style="background:#f6f7f9;border:1px solid #eef0f2;border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.7;color:#3d424c;">' + lines + '</div>' +
          '</div>' +
          '<div class="tml-dz">' + iconUpload() +
            '<div style="font-size:14px;color:#3d424c;">Drop <strong class="mono">' + esc(v.subFile) + '</strong> here, or <span style="color:#2563eb;font-weight:600;">browse</span></div>' +
            '<div style="font-size:12px;color:#9aa0ab;margin-top:4px;">one row per test id · max 50 MB</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:0 26px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
          '<a href="' + esc(d.accessLink) + '" target="_blank" rel="noopener" data-stop style="font-size:13px;font-weight:600;color:#2563eb;text-decoration:none;">↓ sample_submission</a>' +
          '<div style="display:flex;gap:10px;">' +
            '<button data-act="close-submit" style="padding:11px 18px;border:1.5px solid #e3e5e9;background:#fff;color:#5b616e;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>' +
            '<button data-act="close-submit" class="tml-primary" style="padding:11px 20px;border:none;background:#2563eb;color:#fff;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;">Score &amp; submit</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function panelHTML(v) {
    var pn = v.panel;
    var statusBadge = pn.statusLabel
      ? '<span style="display:inline-block;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:7px;' + pn.statusStyle + '">' + esc(pn.statusLabel) + '</span>'
      : '';
    return '' +
    '<div data-act="close-panel" style="position:fixed;inset:0;background:rgba(20,22,26,0.32);z-index:40;animation:tmlFade .18s ease;"></div>' +
    '<aside style="position:fixed;top:0;right:0;bottom:0;width:min(460px,94vw);background:#fff;z-index:41;box-shadow:-12px 0 40px rgba(20,22,26,0.14);animation:tmlSlide .24s cubic-bezier(.2,.7,.3,1);overflow-y:auto;">' +
      '<div style="padding:24px 26px;border-bottom:1px solid #ececef;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;position:sticky;top:0;background:#fff;">' +
        '<div>' +
          '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Reproduction</div>' +
          '<h3 style="margin:7px 0 0;font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-0.015em;">' + esc(pn.paperTitle) + '</h3>' +
          '<div style="font-size:12.5px;color:#9aa0ab;margin-top:4px;">' + esc(pn.authors) + '</div>' +
        '</div>' +
        '<button data-act="close-panel" style="flex:none;background:#f1f2f4;border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;color:#5b616e;line-height:1;">✕</button>' +
      '</div>' +
      '<div style="padding:24px 26px;">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div style="border:1px solid #eef0f2;border-radius:12px;padding:16px;">' +
            '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.04em;">Claimed</div>' +
            '<div class="mono" style="font-size:26px;font-weight:600;color:#6b7280;margin-top:8px;">' + esc(pn.claimedDisp) + '</div>' +
          '</div>' +
          '<div style="border:1.5px solid #c9d6f5;border-radius:12px;padding:16px;background:#f7faff;">' +
            '<div style="font-size:11.5px;color:#2563eb;text-transform:uppercase;letter-spacing:0.04em;">Reproduced</div>' +
            '<div class="mono" style="font-size:26px;font-weight:600;color:#14161a;margin-top:8px;">' + esc(pn.verifiedDisp) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">' +
          statusBadge +
          '<span style="font-size:13px;color:#6b7280;">Δ <span class="mono" style="' + pn.deltaStyle + '">' + esc(pn.deltaDisp) + '</span> vs. paper</span>' +
          '<span style="font-size:13px;color:#9aa0ab;margin-left:auto;">' + esc(pn.dateRepro) + '</span>' +
        '</div>' +
        '<div style="margin-top:22px;">' +
          '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">How we reproduced this</div>' +
          '<p style="margin:0;font-size:14px;line-height:1.62;color:#3d424c;">' + esc(pn.note || 'No reproduction note provided.') + '</p>' +
        '</div>' +
        '<div style="margin-top:22px;display:flex;flex-direction:column;gap:9px;">' +
          (pn.reproLink ? '<a href="' + esc(pn.reproLink) + '" target="_blank" rel="noopener" data-stop class="tml-linkrow">' +
            '<span style="display:inline-flex;align-items:center;gap:9px;">' + iconCode('#2563eb') + ' Reproduction code &amp; logs</span>' +
            '<span style="color:#9aa0ab;">↗</span>' +
          '</a>' : '') +
          '<a href="' + esc(pn.paperLink) + '" target="_blank" rel="noopener" data-stop class="tml-linkrow">' +
            '<span style="display:inline-flex;align-items:center;gap:9px;">' + iconFile('#5b616e') + ' Original paper</span>' +
            '<span style="color:#9aa0ab;">↗</span>' +
          '</a>' +
        '</div>' +
        '<button data-act="open-dispute" class="tml-disputebtn">Claim or dispute this result</button>' +
      '</div>' +
    '</aside>';
  }

  function disputeModalHTML() {
    return '' +
    '<div data-act="close-dispute" style="position:fixed;inset:0;background:rgba(20,22,26,0.42);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;animation:tmlFade .16s ease;">' +
      '<div data-stop style="background:#fff;border-radius:16px;width:min(460px,100%);box-shadow:0 24px 70px rgba(20,22,26,0.28);animation:tmlPop .22s cubic-bezier(.2,.7,.3,1);overflow:hidden;">' +
        '<div style="padding:24px 26px 0;">' +
          '<h3 style="margin:0;font-size:19px;font-weight:600;letter-spacing:-0.02em;">Claim or dispute this result</h3>' +
          '<p style="margin:9px 0 0;font-size:14px;line-height:1.55;color:#6b7280;">Authors can claim ownership of a reproduced entry or flag a discrepancy in the reproduction. Our team reviews submissions within 5 business days.</p>' +
        '</div>' +
        '<div style="padding:22px 26px;">' +
          '<label style="display:block;font-size:12.5px;font-weight:600;color:#5b616e;margin-bottom:7px;">Your role</label>' +
          '<div style="display:flex;gap:8px;margin-bottom:18px;">' +
            '<button data-stop style="flex:1;padding:10px;border:1.5px solid #2563eb;background:#f5f8ff;color:#2563eb;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;">Paper author</button>' +
            '<button data-stop style="flex:1;padding:10px;border:1.5px solid #e3e5e9;background:#fff;color:#6b7280;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer;">Other</button>' +
          '</div>' +
          '<label style="display:block;font-size:12.5px;font-weight:600;color:#5b616e;margin-bottom:7px;">Message</label>' +
          '<textarea class="tml-textarea" placeholder="Describe the claim or discrepancy…"></textarea>' +
        '</div>' +
        '<div style="padding:0 26px 24px;display:flex;gap:10px;justify-content:flex-end;">' +
          '<button data-act="close-dispute" style="padding:11px 18px;border:1.5px solid #e3e5e9;background:#fff;color:#5b616e;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>' +
          '<button data-act="close-dispute" class="tml-primary" style="padding:11px 20px;border:none;background:#2563eb;color:#fff;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;">Submit for review</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function footerHTML() {
    return '' +
    '<footer style="border-top:1px solid #ececef;background:#fafbfc;">' +
      '<div style="max-width:1120px;margin:0 auto;padding:30px 28px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">' +
        '<div style="font-size:13px;color:#9aa0ab;">TeleMLEBench — verified telecom-ML baselines.</div>' +
        '<div style="font-size:13px;color:#9aa0ab;">Claimed vs. independently reproduced.</div>' +
      '</div>' +
    '</footer>';
  }

  // ------------------------------------------------------ live runs pages
  function diffLines(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ sign: ' ', text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ sign: '-', text: a[i] }); i++; }
      else { out.push({ sign: '+', text: b[j] }); j++; }
    }
    while (i < n) out.push({ sign: '-', text: a[i++] });
    while (j < m) out.push({ sign: '+', text: b[j++] });
    return out;
  }

  var RUN_CHIPS = {
    scored: 'background:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;',
    compile_failed: 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;',
    runtime_error: 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;',
    failed: 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;',
    running: 'background:#f5f8ff;color:#2563eb;border:1px solid #b9ccf7;'
  };
  function attemptChip(a) {
    if (a.status === 'scored') return { label: a.score != null ? ('scored ' + a.score) : 'scored', style: RUN_CHIPS.scored };
    if (a.status === 'running') return { label: 'running', style: RUN_CHIPS.running };
    if (a.status === 'compile_failed') return { label: 'compile failed', style: RUN_CHIPS.compile_failed };
    if (a.status === 'runtime_error') return { label: 'runtime error', style: RUN_CHIPS.runtime_error };
    return { label: a.status || '—', style: RUN_CHIPS.failed };
  }
  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function runVals(s) {
    var r = s.runDetail;
    var out = {
      isRuns: s.route === 'runs', isRun: s.route === 'run',
      runsList: (s.runsList || []).map(function (x) {
        var chip = x.state === 'running'
          ? { label: (x.step || 'running') + ' · attempt ' + (x.attempt || 1) + '/' + (x.budget || '?'), style: RUN_CHIPS.running }
          : (x.state === 'succeeded' ? { label: 'succeeded', style: RUN_CHIPS.scored }
                                     : { label: 'failed', style: RUN_CHIPS.failed });
        return {
          slug: x.slug, name: x.name || x.slug, category: x.category || '',
          paperTitle: x.paperTitle || '(no confirmed paper)',
          running: x.state === 'running',
          chipLabel: chip.label, chipStyle: chip.style,
          started: fmtTime(x.startedAt)
        };
      }),
      runsLoading: s.runsLoading, runsError: s.runsError,
      runLoading: s.runLoading, runError: s.runError,
      workers: (s.workers || []).map(function (w) {
        // green = doing something now, blue = live & idle, red = down
        var color = !w.live ? '#dc2626' : (w.busy ? '#15803d' : '#2563eb');
        var bg = !w.live ? '#fef2f2' : (w.busy ? '#ecfdf3' : '#f5f8ff');
        var border = !w.live ? '#fecaca' : (w.busy ? '#bbf7d0' : '#b9ccf7');
        return {
          name: w.name,
          label: !w.live ? 'down' : (w.busy ? (w.task || 'working') : 'idle'),
          dotStyle: 'width:8px;height:8px;border-radius:50%;background:' + color + ';'
            + (w.busy && w.live ? 'animation:tmlPulse 1.6s ease-out infinite;' : ''),
          chipStyle: 'background:' + bg + ';color:' + color + ';border:1px solid ' + border + ';'
        };
      }),
      isJudgments: s.route === 'judgments',
      judgmentsData: s.judgments, judgLoading: s.judgLoading, judgError: s.judgError,
      judgFold: s.judgFold, judgOpenIdx: s.judgOpenIdx,
      judgMore: s.judgMore, judgMoreLoading: s.judgMoreLoading,
      isCatalog: s.route === 'catalog',
      catalogItems: s.catalogItems, catalogLoading: s.catalogLoading,
      catalogError: s.catalogError, catalogDone: s.catalogDone,
      catalogQuery: s.catalogQuery,
      scan: (function (sc) {
        if (!sc) return null;
        return {
          pct: sc.pct,
          barStyle: 'width:' + (sc.pct != null ? sc.pct : 4) + '%;',
          label: sc.done + ' of ' + sc.total + (sc.pct != null ? ' · ' + sc.pct + '%' : ''),
          current: sc.current || ''
        };
      })(s.scan),
      download: (function (d) {
        if (!d) return null;
        var mb = function (b) { return b == null ? '?' : (b / 1e6 >= 1000 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB'); };
        return {
          name: d.name || d.slug,
          pct: d.pct,
          barStyle: 'width:' + (d.pct != null ? d.pct : 4) + '%;' + (d.pct == null ? 'animation:tmlPulse 1.6s ease-out infinite;' : ''),
          label: mb(d.doneBytes) + (d.totalBytes ? ' of ' + mb(d.totalBytes) : '') + (d.pct != null ? ' · ' + d.pct + '%' : '')
        };
      })(s.download),
      run: null
    };
    if (!r || s.route !== 'run') return out;

    var atts = r.attempts || [];
    var sel = s.runSel || (atts.length ? atts[atts.length - 1].n : 1);
    var selAtt = atts.find(function (a) { return a.n === sel; }) || null;
    var prevAtt = atts.find(function (a) { return a.n === sel - 1; }) || null;

    // code panel (plain or diff vs previous attempt)
    var codeLines = [], added = 0, removed = 0;
    var codeSubtitle = 'attempt ' + sel;
    var selCode = (selAtt && selAtt.code) ? selAtt.code.replace(/\r/g, '').split('\n') : [];
    if (s.runDiff && prevAtt && prevAtt.code) {
      var d = diffLines(prevAtt.code.replace(/\r/g, '').split('\n'), selCode);
      var num = 0;
      codeLines = d.map(function (ln) {
        if (ln.sign !== '-') num++;
        if (ln.sign === '+') added++;
        if (ln.sign === '-') removed++;
        return {
          num: ln.sign === '-' ? '' : String(num),
          sign: ln.sign === '-' ? '−' : (ln.sign === '+' ? '+' : ''),
          signStyle: ln.sign === '+' ? 'color:#15803d;font-weight:600;' : (ln.sign === '-' ? 'color:#dc2626;font-weight:600;' : 'color:transparent;'),
          bg: ln.sign === '+' ? 'background:#ecfdf3;' : (ln.sign === '-' ? 'background:#fef2f2;' : ''),
          text: ln.text || ' '
        };
      });
      codeSubtitle = 'attempt ' + sel + ' · diff vs attempt ' + (sel - 1);
    } else {
      codeLines = selCode.map(function (t, i) {
        return { num: String(i + 1), sign: '', signStyle: 'color:transparent;', bg: '', text: t || ' ' };
      });
      if (s.runDiff) codeSubtitle = 'attempt ' + sel + ' · no previous attempt to diff';
    }
    if (!codeLines.length) codeLines = [{ num: '', sign: '', signStyle: 'color:transparent;', bg: '', text: '(code not captured yet)' }];

    // header chip
    var chipBase = 'flex:none;display:inline-flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:99px;letter-spacing:0.02em;';
    var dotBase = 'width:8px;height:8px;border-radius:50%;';
    var head;
    if (r.state === 'running') {
      head = { label: 'RUNNING — ' + (r.step || '…').toUpperCase() + ' · ATTEMPT ' + (r.attempt || 1) + ' OF ' + (r.budget || '?'),
               style: chipBase + 'background:#f5f8ff;color:#2563eb;border:1px solid #b9ccf7;',
               dot: dotBase + 'background:#2563eb;animation:tmlPulse 1.6s ease-out infinite;' };
    } else if (r.state === 'succeeded') {
      head = { label: 'REPRODUCED' + (r.score != null ? ' — ' + r.score + (r.metric ? ' ' + r.metric : '') : ''),
               style: chipBase + 'background:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;',
               dot: dotBase + 'background:#15803d;' };
    } else if (r.state === 'failed') {
      head = { label: 'FAILED — BUDGET EXHAUSTED',
               style: chipBase + 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;',
               dot: dotBase + 'background:#dc2626;' };
    } else {
      head = { label: 'NO RUN YET', style: chipBase + 'background:#f1f2f4;color:#5b616e;border:1px solid #e3e5e9;', dot: dotBase + 'background:#9aa0ab;' };
    }

    // steps
    var steps = (r.steps || []).map(function (st, i, arr) {
      var dotBase2 = "flex:none;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600;font-family:'JetBrains Mono',ui-monospace,monospace;";
      var mark = String(i + 1), dotStyle;
      if (st.state === 'failed') { dotStyle = dotBase2 + 'background:#fef2f2;color:#dc2626;border:1.5px solid #fecaca;'; mark = '✕'; }
      else if (st.state === 'done') { dotStyle = dotBase2 + 'background:#2563eb;color:#fff;border:1.5px solid #2563eb;'; mark = '✓'; }
      else if (st.state === 'current') { dotStyle = dotBase2 + 'background:#f5f8ff;color:#2563eb;border:1.5px solid #2563eb;animation:tmlPulse 1.6s ease-out infinite;'; }
      else { dotStyle = dotBase2 + 'background:#fff;color:#9aa0ab;border:1.5px solid #e3e5e9;'; }
      return {
        mark: mark, dotStyle: dotStyle, hasLine: i < arr.length - 1,
        title: st.title, desc: st.desc,
        titleStyle: 'font-size:13.5px;font-weight:600;line-height:1.4;' + (st.state === 'current' ? 'color:#2563eb;' : (st.state === 'pending' ? 'color:#9aa0ab;' : 'color:#14161a;'))
      };
    });

    // progress + console
    var prog = r.progress || {};
    var pct = r.state === 'succeeded' ? 100 : (prog.pct != null ? prog.pct : (r.state === 'running' ? 4 : 0));
    var progressLabel = prog.line || (r.state === 'running' ? 'waiting for container output…' : '');
    var currentStep = r.state === 'running'
      ? ((r.steps || []).filter(function (x) { return x.state === 'current'; }).map(function (x) { return x.title; })[0] || r.step || '…')
        + (prog.epoch != null ? ' — epoch ' + prog.epoch + '/' + prog.epochs : '')
      : (r.state === 'succeeded' ? 'Complete — scored ' + (r.score != null ? r.score : '') + ' ' + (r.metric || '')
        : (r.state === 'failed' ? 'Stopped — no attempt produced a score' : 'Idle'));
    var consoleDot = r.state === 'running' ? 'background:#4ade80;animation:tmlPulse 1.6s ease-out infinite;'
      : (r.state === 'failed' ? 'background:#f87171;' : 'background:#4ade80;');

    // extracted methodology (method_spec.json) — known sections in order, then
    // any extra keys, each rendered as a labelled value / pretty-JSON block
    var specSections = [];
    var specConfidence = null;
    if (r.methodSpec && typeof r.methodSpec === 'object') {
      var SPEC_LABELS = [
        ['task_type', 'Task type'],
        ['model_architecture', 'Model architecture'],
        ['training_procedure', 'Training procedure'],
        ['preprocessing', 'Preprocessing'],
        ['reported_metric', 'Reported metric'],
        ['reported_metrics', 'Reported metrics']
      ];
      var seenKeys = { arxiv_id: 1, extraction_confidence: 1 };
      SPEC_LABELS.forEach(function (kv) { seenKeys[kv[0]] = 1; });
      var specKeys = SPEC_LABELS.concat(
        Object.keys(r.methodSpec).filter(function (k) { return !seenKeys[k]; })
          .map(function (k) { return [k, k.replace(/_/g, ' ')]; }));
      specKeys.forEach(function (kv) {
        var val = r.methodSpec[kv[0]];
        if (val === null || val === undefined) return;
        if (Array.isArray(val) && !val.length) return;
        var isScalar = (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean');
        specSections.push({ label: kv[1], body: isScalar ? String(val) : JSON.stringify(val, null, 2), scalar: isScalar });
      });
      if (r.methodSpec.extraction_confidence != null) specConfidence = r.methodSpec.extraction_confidence;
    }

    var lastFinished = atts.filter(function (a) { return a.status !== 'running'; }).slice(-1)[0];
    out.run = {
      specSections: specSections, specConfidence: specConfidence,
      name: r.name, category: r.category || 'Uncategorized', slug: r.slug,
      paperTitle: r.paperTitle || '(no confirmed paper)', arxivId: r.arxivId,
      paperLink: r.arxivId ? 'https://arxiv.org/abs/' + r.arxivId : null,
      headLabel: head.label, headStyle: head.style, headDot: head.dot,
      codeLines: codeLines, codeSubtitle: codeSubtitle, added: added, removed: removed,
      diffOn: s.runDiff,
      diffTrack: s.runDiff ? 'background:#2563eb;' : 'background:#d4d7dd;',
      diffKnob: s.runDiff ? 'left:16px;' : 'left:2px;',
      diffLabel: s.runDiff ? 'color:#2563eb;' : 'color:#9aa0ab;',
      showDiffCounts: s.runDiff && (added + removed) > 0,
      steps: steps,
      currentStep: currentStep,
      progressStyle: 'width:' + pct + '%;',
      progressLabel: progressLabel,
      consoleLine: prog.line || currentStep, consoleDot: consoleDot,
      budget: r.budget != null ? String(r.budget) : '—',
      attemptsLeft: r.state === 'running' ? Math.max(0, (r.budget || 0) - (r.attempt || 0)) + ' of ' + (r.budget || '—') : '0 of ' + (r.budget || '—'),
      compiledLabel: lastFinished ? (lastFinished.status === 'compile_failed' ? '✕ No — attempt ' + lastFinished.n : '✓ Yes — attempt ' + lastFinished.n) : '—',
      compiledStyle: lastFinished && lastFinished.status === 'compile_failed' ? 'color:#dc2626;' : 'color:#15803d;',
      attempts: atts.map(function (a) {
        var chip = attemptChip(a);
        var isSel = a.n === sel;
        return {
          n: a.n, numLabel: '#' + a.n,
          title: 'Attempt ' + a.n + (a.started_at ? ' · ' + fmtTime(a.started_at) : ''),
          detail: a.detail || (a.status === 'running' ? 'in progress…' : (a.status === 'scored' ? 'produced a score' : '')),
          chipLabel: chip.label, chipStyle: chip.style,
          rowStyle: 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;'
            + (isSel ? 'border:1.5px solid #2563eb;background:#f5f8ff;' : 'border:1.5px solid #eef0f2;background:#fff;')
        };
      })
    };
    return out;
  }

  function judgmentsHTML(v) {
    var mono = "font-family:'JetBrains Mono',ui-monospace,monospace;";
    var j = v.judgmentsData;
    var body;
    if (v.judgLoading && !j) body = loadingBlock('Loading judgments…');
    else if (v.judgError) body = stateBlock('Couldn’t load judgments', v.judgError, 'Retry', 'retry-judgments', 'error');
    else if (!j) body = '';
    else {
      var curList = Array.isArray(j.current) ? j.current : (j.current ? [j.current] : []);
      var curHTML = curList.length
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:22px;">' + curList.map(function (cur) { return '<div class="tml-running" style="border:1px solid #dbe6fd;border-radius:14px;background:#f5f8ff;padding:16px 18px;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#2563eb;"><span class="tml-spinner-xs"></span>Judging now' + (cur.keywordPrior != null ? '<span style="font-weight:500;text-transform:none;letter-spacing:0;color:#5b616e;">· keyword prior: ' + (cur.keywordPrior ? 'telecom' : 'not telecom') + '</span>' : '') + '</div>' +
            '<div style="margin-top:8px;font-size:17px;font-weight:600;">' + esc(cur.name || cur.slug) + '</div>' +
            (cur.hfId ? '<div style="font-size:12px;color:#9aa0ab;' + mono + 'margin-top:2px;">' + esc(cur.hfId) + '</div>' : '') +
            '<div style="margin-top:10px;font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">What the AI sees</div>' +
            '<p style="margin:5px 0 0;font-size:13px;line-height:1.55;color:#3d424c;max-height:120px;overflow-y:auto;">' + esc(cur.description || ((cur.fields && cur.fields.length) ? '(no description — judging from the data schema and tags below)' : '(no description)')) + '</p>' +
            (cur.tags && cur.tags.length ? '<div style="margin-top:9px;display:flex;flex-wrap:wrap;gap:5px;">' + cur.tags.slice(0, 18).map(function (t) {
              return '<span style="font-size:10.5px;' + mono + 'background:#fff;border:1px solid #e2ebfd;color:#5b616e;padding:2px 7px;border-radius:5px;">' + esc(t) + '</span>';
            }).join('') + '</div>' : '') +
            (cur.fields && cur.fields.length ? '<div style="margin-top:9px;"><span style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Schema</span><div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:5px;">' + cur.fields.slice(0, 20).map(function (f) {
              return '<span style="font-size:10.5px;' + mono + 'background:#eef4ff;border:1px solid #b9ccf7;color:#2563eb;padding:2px 7px;border-radius:5px;">' + esc(f) + '</span>';
            }).join('') + '</div></div>' : '') +
          '</div>'; }).join('') + '</div>'
        : '<div style="border:1px solid #e9eaee;border-radius:14px;background:#fff;padding:16px 20px;margin-bottom:22px;font-size:13.5px;color:#6b7280;">No dataset under judgment right now — the feed below is the full history (' + (j.total || 0) + ' judged).</div>';
      var seenKeys = {};
      var allItems = (j.items || []).concat(v.judgMore).filter(function (it) {
        var k = (it.slug || '') + '|' + (it.at || '');
        if (seenKeys[k]) return false;
        seenKeys[k] = 1;
        return true;
      });
      var rows = allItems.map(function (it, idx) {
        var kept = !!it.verdict;
        var open = v.judgOpenIdx === idx;
        var chip = kept ? 'background:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;' : 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;';
        var evidence = !open ? '' :
          '<div style="margin-top:9px;background:#fafbfc;border:1px solid #eef0f2;border-radius:9px;padding:10px 12px;">' +
            '<div style="font-size:10.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Evidence the AI saw</div>' +
            '<p style="margin:5px 0 0;font-size:12px;line-height:1.55;color:#3d424c;max-height:130px;overflow-y:auto;">' + esc(it.description || '(no description)') + '</p>' +
            ((it.fields && it.fields.length) ? '<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px;">' + it.fields.slice(0, 20).map(function (f) { return '<span style="font-size:10px;' + mono + 'background:#eef4ff;border:1px solid #b9ccf7;color:#2563eb;padding:1px 6px;border-radius:4px;">' + esc(f) + '</span>'; }).join('') + '</div>' : '') +
            ((it.tags && it.tags.length) ? '<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px;">' + it.tags.slice(0, 18).map(function (t) { return '<span style="font-size:10px;' + mono + 'background:#fff;border:1px solid #e3e5e9;color:#8a8f9a;padding:1px 6px;border-radius:4px;">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
          '</div>';
        return '<div data-judgrow="' + idx + '" style="display:flex;gap:14px;align-items:flex-start;border:1px solid ' + (open ? '#b9ccf7' : '#eef0f2') + ';border-radius:12px;background:#fff;padding:13px 16px;cursor:pointer;">' +
          '<span style="flex:none;display:inline-block;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:5px;white-space:nowrap;margin-top:2px;' + chip + '">' + (kept ? 'telecom ✓' : 'rejected ✕') + '</span>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13.5px;font-weight:600;">' + esc(it.name || it.slug) + (it.hfId ? ' <span style="font-weight:400;color:#9aa0ab;' + mono + 'font-size:11px;">' + esc(it.hfId) + '</span>' : '') + '</div>' +
            '<div style="font-size:12.5px;color:#5b616e;margin-top:3px;line-height:1.5;">' + esc(it.reason || '') + '</div>' +
            '<div style="font-size:11px;color:#c2c7d0;' + mono + 'margin-top:4px;">' + esc((it.at || '').replace('T', ' ').slice(0, 19)) + (it.keywordPrior != null && it.keywordPrior !== it.verdict ? ' · overruled keyword filter' : '') + '</div>' +
            evidence +
          '</div>' +
          '<span style="flex:none;color:#c2c7d0;font-size:11px;margin-top:3px;">' + (open ? '▲' : '▼') + '</span>' +
        '</div>';
      }).join('');
      body = curHTML +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px;">' +
          '<h2 style="margin:0;font-size:17px;font-weight:600;">Judgment history</h2>' +
          '<div style="display:flex;align-items:baseline;gap:14px;">' +
            '<span style="font-size:12.5px;color:#9aa0ab;">' + (j.total || 0) + ' total · newest first</span>' +
            '<button data-act="toggle-judgfold" style="background:none;border:1px solid #e3e5e9;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:600;color:#5b616e;cursor:pointer;">' + (v.judgFold ? '▸ Unfold' : '▾ Fold') + '</button>' +
          '</div>' +
        '</div>' +
        (v.judgFold ? '' : '<div style="display:flex;flex-direction:column;gap:8px;">' + (rows || '<div style="font-size:13px;color:#9aa0ab;">Nothing judged yet.</div>') + '</div>' +
          (allItems.length < (j.total || 0)
            ? '<div style="text-align:center;margin-top:14px;"><button data-act="judg-more" style="background:#fff;border:1px solid #e3e5e9;border-radius:9px;padding:9px 22px;font-size:13px;font-weight:600;color:#5b616e;cursor:pointer;">' + (v.judgMoreLoading ? 'Loading…' : 'Load 10 more (' + ((j.total || 0) - allItems.length) + ' older)') + '</button></div>'
            : ''));
    }
    var scanNote = v.scan
      ? '<div style="margin:0 0 18px;border:1px solid #e9eaee;background:#fafbfc;border-radius:12px;padding:11px 15px;font-size:12.5px;color:#5b616e;"><span class="tml-spinner-xs"></span><strong style="color:#14161a;">Metadata scan in progress</strong> — ' + esc(v.scan.label) + ' · judging starts when the scan finishes.' +
          '<div style="margin-top:8px;height:4px;border-radius:99px;background:#ececef;overflow:hidden;"><div style="height:100%;background:#2563eb;transition:width .8s ease;' + v.scan.barStyle + '"></div></div></div>'
      : '';
    return '<main style="max-width:900px;width:100%;margin:0 auto;padding:34px 28px 120px;flex:1;">' +
      '<h1 style="margin:0 0 6px;font-size:27px;font-weight:600;letter-spacing:-0.025em;">AI relevance judgments</h1>' +
      '<p style="margin:0 0 22px;font-size:14px;color:#6b7280;">What the harvest AI is looking at in real time — the evidence it sees and the verdict it gives. Updates live.</p>' +
      scanNote + body + '</main>';
  }

  function catalogHTML(v) {
    var mono = "font-family:'JetBrains Mono',ui-monospace,monospace;";
    var rows = v.catalogItems.map(function (d) {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;border:1px solid #eef0f2;border-radius:12px;background:#fff;padding:12px 16px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:13.5px;font-weight:600;">' + esc(d.name || d.slug) +
            (d.hf_id ? ' <a href="' + esc(d.url || '#') + '" target="_blank" rel="noopener" style="font-weight:400;color:#9aa0ab;' + mono + 'font-size:11px;text-decoration:none;">' + esc(d.hf_id) + '</a>' : '') + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;">' +
            (d.domain ? '<span style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:#2563eb;background:#f5f8ff;border:1px solid #e2ebfd;padding:2px 7px;border-radius:5px;">' + esc(d.domain) + '</span>' : '') +
            (d.task ? '<span style="font-size:10.5px;' + mono + 'background:#fff;border:1px solid #e3e5e9;color:#5b616e;padding:2px 7px;border-radius:5px;">' + esc(d.task) + '</span>' : '') +
            (d.kind ? '<span style="font-size:10.5px;' + mono + 'background:#fff;border:1px solid #e3e5e9;color:#5b616e;padding:2px 7px;border-radius:5px;">' + esc(d.kind) + '</span>' : '') +
            (d.expected_metric ? '<span style="font-size:10.5px;' + mono + 'background:#fff;border:1px solid #e3e5e9;color:#5b616e;padding:2px 7px;border-radius:5px;">metric: ' + esc(d.expected_metric) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<span style="flex:none;font-size:11px;color:#9aa0ab;' + mono + '">' + esc(d.download_status || 'not downloaded') + '</span>' +
      '</div>';
    }).join('');
    var more = v.catalogDone ? '' :
      '<div style="text-align:center;margin-top:14px;"><button data-act="catalog-more" style="background:#fff;border:1px solid #e3e5e9;border-radius:9px;padding:9px 22px;font-size:13px;font-weight:600;color:#5b616e;cursor:pointer;">' + (v.catalogLoading ? 'Loading…' : 'Load 30 more') + '</button></div>';
    return '<main style="max-width:900px;width:100%;margin:0 auto;padding:34px 28px 120px;flex:1;">' +
      '<h1 style="margin:0 0 6px;font-size:27px;font-weight:600;letter-spacing:-0.025em;">Approved catalog</h1>' +
      '<p style="margin:0 0 18px;font-size:14px;color:#6b7280;">Every dataset the AI judged telecom-relevant — including ones without papers yet. Benchmarks with confirmed papers also appear under Datasets.</p>' +
      '<div style="display:flex;gap:10px;margin-bottom:18px;max-width:440px;">' +
        '<input id="catalog-search" data-catalogquery value="' + esc(v.catalogQuery) + '" placeholder="Filter by name…" style="flex:1;border:1.5px solid #e3e5e9;border-radius:9px;padding:9px 13px;font-size:13.5px;outline:none;" />' +
      '</div>' +
      (v.catalogError ? stateBlock('Couldn’t load the catalog', v.catalogError, 'Retry', 'catalog-retry', 'error')
        : '<div style="display:flex;flex-direction:column;gap:7px;">' + (rows || (v.catalogLoading ? loadingBlock('Loading catalog…') : '<div style="font-size:13px;color:#9aa0ab;">No approved datasets match.</div>')) + '</div>' + more) +
      '</main>';
  }

  function runsHTML(v) {
    var body;
    if (v.runsLoading) body = loadingBlock('Loading runs…');
    else if (v.runsError) body = stateBlock('Couldn’t load runs', v.runsError, 'Retry', 'retry-runs', 'error');
    else if (!v.runsList.length) body = '<div style="border:1px solid #e9eaee;background:#fff;border-radius:14px;padding:46px 28px;text-align:center;color:#6b7280;font-size:14px;">No reproductions running right now. Runs appear here the moment the engine starts one.</div>';
    else body = '<div style="display:flex;flex-direction:column;gap:12px;">' + v.runsList.map(function (x) {
      return '<div data-runopen="' + esc(x.slug) + '" class="' + (x.running ? 'tml-running' : '') + '" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e9eaee;border-radius:14px;background:#fff;padding:16px 20px;cursor:pointer;">' +
        '<div style="min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">' +
            '<span style="font-size:15.5px;font-weight:600;">' + esc(x.name) + '</span>' +
            '<span style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:#2563eb;background:#f5f8ff;border:1px solid #e2ebfd;padding:2px 7px;border-radius:5px;">' + esc(x.category) + '</span>' +
          '</div>' +
          '<div style="font-size:12.5px;color:#9aa0ab;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:640px;">' + esc(x.paperTitle) + (x.started ? ' · started ' + esc(x.started) : '') + '</div>' +
        '</div>' +
        '<span style="flex:none;display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:99px;' + x.chipStyle + '">' + (x.running ? '<span class="tml-spinner-xs"></span>' : '') + esc(x.chipLabel) + '</span>' +
      '</div>';
    }).join('') + '</div>';
    var workerStrip = v.workers.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;">' +
        v.workers.map(function (w) {
          return '<span style="display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:99px;' + w.chipStyle + '">' +
            '<span style="' + w.dotStyle + '"></span>' + esc(w.name) +
            '<span style="font-weight:500;opacity:.85;max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">· ' + esc(w.label) + '</span>' +
          '</span>';
        }).join('') + '</div>'
      : '';
    var scanBar = v.scan
      ? '<div style="margin:0 0 22px;border:1px solid #e9eaee;background:#fafbfc;border-radius:12px;padding:13px 16px;max-width:560px;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;font-weight:600;color:#14161a;">' +
            '<span><span class="tml-spinner-xs"></span>Scanning metadata</span>' +
            '<span style="font-weight:500;color:#5b616e;">' + esc(v.scan.label) + '</span>' +
          '</div>' +
          '<div style="margin-top:9px;height:5px;border-radius:99px;background:#ececef;overflow:hidden;">' +
            '<div style="height:100%;border-radius:99px;background:#2563eb;transition:width .8s ease;' + v.scan.barStyle + '"></div>' +
          '</div>' +
          '<div style="margin-top:7px;font-size:11.5px;color:#9aa0ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" class="mono">' + esc(v.scan.current) + '</div>' +
        '</div>'
      : '';
    var downloadBar = v.download
      ? '<div style="margin:0 0 22px;border:1px solid #dbe6fd;background:#f5f8ff;border-radius:12px;padding:13px 16px;max-width:560px;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;font-weight:600;color:#2563eb;">' +
            '<span><span class="tml-spinner-xs"></span>Downloading ' + esc(v.download.name) + '</span>' +
            '<span style="font-weight:500;color:#5b616e;">' + esc(v.download.label) + '</span>' +
          '</div>' +
          '<div style="margin-top:9px;height:5px;border-radius:99px;background:#dbe6fd;overflow:hidden;">' +
            '<div style="height:100%;border-radius:99px;background:#2563eb;transition:width .8s ease;' + v.download.barStyle + '"></div>' +
          '</div>' +
        '</div>'
      : '';
    return '<main style="max-width:1120px;width:100%;margin:0 auto;padding:34px 28px 120px;flex:1;">' +
      '<h1 style="margin:0 0 6px;font-size:27px;font-weight:600;letter-spacing:-0.025em;">Live runs</h1>' +
      '<p style="margin:0 0 14px;font-size:14px;color:#6b7280;">Reproductions currently executing, and recently finished ones. Pages update live.</p>' +
      workerStrip + scanBar + downloadBar +
      body + '</main>';
  }

  function runHTML(v) {
    if (v.runLoading) return '<main style="max-width:1280px;width:100%;margin:0 auto;padding:28px;flex:1;">' + loadingBlock('Loading run…') + '</main>';
    if (v.runError) return '<main style="max-width:1280px;width:100%;margin:0 auto;padding:28px;flex:1;">' + stateBlock('Couldn’t load this run', v.runError, 'Retry', 'retry-run', 'error') + '</main>';
    var r = v.run;
    if (!r) return '<main style="max-width:1280px;width:100%;margin:0 auto;padding:28px;flex:1;"></main>';
    var mono = "font-family:'JetBrains Mono',ui-monospace,monospace;";
    return '' +
    '<main style="max-width:1280px;width:100%;margin:0 auto;padding:28px 28px 80px;flex:1;">' +
      '<button data-act="runs" class="tml-primary" style="background:none;border:none;color:#6b7280;font-size:13.5px;font-weight:500;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:6px;margin-bottom:20px;">← All live runs</button>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:24px;">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<span style="display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#2563eb;background:#f5f8ff;border:1px solid #e2ebfd;padding:4px 9px;border-radius:6px;">' + esc(r.category) + '</span>' +
            '<span data-open="' + esc(r.slug) + '" style="font-size:12.5px;color:#9aa0ab;cursor:pointer;' + mono + '">' + esc(r.name) + '</span>' +
          '</div>' +
          '<h1 style="margin:12px 0 0;font-size:27px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;">Live reproduction — ' + esc(r.paperTitle) + '</h1>' +
          (r.paperLink ? '<div style="font-size:13.5px;color:#9aa0ab;margin-top:6px;"><a href="' + esc(r.paperLink) + '" target="_blank" rel="noopener" style="' + mono + 'color:#5b616e;">arXiv:' + esc(r.arxivId) + '</a></div>' : '') +
        '</div>' +
        '<div style="' + r.headStyle + '"><span style="' + r.headDot + '"></span><span>' + esc(r.headLabel) + '</span></div>' +
      '</div>' +
      '<div class="tml-rungrid" style="display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:18px;align-items:start;">' +
        // left: code
        '<div style="border:1px solid #e9eaee;border-radius:14px;overflow:hidden;background:#fff;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;border-bottom:1px solid #ececef;background:#fafbfc;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:10px;">' + iconCode('#6b7280') +
              '<span style="' + mono + 'font-size:13px;font-weight:600;color:#14161a;">train.py</span>' +
              '<span style="font-size:12px;color:#9aa0ab;">' + esc(r.codeSubtitle) + '</span>' +
            '</div>' +
            (r.showDiffCounts ? '<div style="display:flex;align-items:center;gap:12px;font-size:12px;' + mono + '">' +
              '<span style="color:#15803d;">+' + r.added + '</span><span style="color:#dc2626;">−' + r.removed + '</span></div>' : '') +
          '</div>' +
          '<div style="padding:14px 0;overflow-x:auto;background:#fff;">' +
            r.codeLines.map(function (ln) {
              return '<div style="display:flex;' + mono + 'font-size:12.5px;line-height:1.85;' + ln.bg + '">' +
                '<span style="flex:none;width:46px;text-align:right;padding-right:14px;color:#c2c7d0;user-select:none;">' + esc(ln.num) + '</span>' +
                '<span style="flex:none;width:16px;' + ln.signStyle + '">' + esc(ln.sign) + '</span>' +
                '<span style="white-space:pre;padding-right:20px;color:#3d424c;">' + esc(ln.text) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div style="border-top:1px solid #ececef;background:#14161a;padding:11px 18px;display:flex;align-items:center;gap:12px;">' +
            '<span style="flex:none;width:7px;height:7px;border-radius:50%;' + r.consoleDot + '"></span>' +
            '<span style="' + mono + 'font-size:12px;color:#a8b0bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.consoleLine || '') + '</span>' +
          '</div>' +
        '</div>' +
        // right column
        '<div style="display:flex;flex-direction:column;gap:18px;">' +
          '<div style="border:1px solid #e9eaee;border-radius:14px;background:#fff;padding:20px 22px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
              '<h2 style="margin:0;font-size:15px;font-weight:600;letter-spacing:-0.015em;">Methodology</h2>' +
              '<span style="font-size:11px;color:#9aa0ab;' + mono + '">spec-only · no author code</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;">' +
              r.steps.map(function (st) {
                return '<div style="display:flex;gap:12px;">' +
                  '<div style="flex:none;display:flex;flex-direction:column;align-items:center;">' +
                    '<span style="' + st.dotStyle + '">' + esc(st.mark) + '</span>' +
                    (st.hasLine ? '<span style="width:1.5px;flex:1;min-height:14px;background:#ececef;"></span>' : '') +
                  '</div>' +
                  '<div style="padding-bottom:14px;min-width:0;">' +
                    '<div style="' + st.titleStyle + '">' + esc(st.title) + '</div>' +
                    '<div style="font-size:12px;color:#9aa0ab;margin-top:2px;line-height:1.5;">' + esc(st.desc) + '</div>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div style="margin-top:4px;background:#fafbfc;border:1px solid #eef0f2;border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.55;color:#6b7280;">Budget: <strong style="color:#14161a;font-weight:600;">' + esc(r.budget) + ' attempts</strong>. Test labels are never accessible to the agent; scoring runs server-side on the held-out split.</div>' +
          '</div>' +
          // extracted method spec (what the LLM pulled out of the paper)
          (r.specSections.length ?
          '<div style="border:1px solid #e9eaee;border-radius:14px;background:#fff;padding:20px 22px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
              '<h2 style="margin:0;font-size:15px;font-weight:600;letter-spacing:-0.015em;">Extracted methodology</h2>' +
              '<span style="font-size:11px;color:#9aa0ab;' + mono + '">' + (r.specConfidence != null ? 'confidence ' + esc(r.specConfidence) : 'method_spec.json') + '</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:10px;">' +
              r.specSections.map(function (sx) {
                return '<div>' +
                  '<div style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">' + esc(sx.label) + '</div>' +
                  (sx.scalar
                    ? '<div style="font-size:13px;font-weight:600;color:#14161a;">' + esc(sx.body) + '</div>'
                    : '<pre style="margin:0;background:#fafbfc;border:1px solid #eef0f2;border-radius:9px;padding:10px 12px;' + mono + 'font-size:11.5px;line-height:1.6;color:#3d424c;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow-y:auto;">' + esc(sx.body) + '</pre>') +
                '</div>';
              }).join('') +
            '</div>' +
            '<div style="margin-top:12px;font-size:11.5px;color:#9aa0ab;line-height:1.5;">Extracted by the LLM from the paper text — this spec (not author code) is what train.py is generated from.</div>' +
          '</div>' : '') +
          '<div style="border:1px solid #e9eaee;border-radius:14px;background:#fff;padding:20px 22px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
              '<h2 style="margin:0;font-size:15px;font-weight:600;letter-spacing:-0.015em;">Run status</h2>' +
              '<span style="font-size:11px;color:#9aa0ab;' + mono + '">' + esc(r.slug) + '</span>' +
            '</div>' +
            '<div style="background:#fafbfc;border:1px solid #eef0f2;border-radius:11px;padding:13px 15px;">' +
              '<div style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Current step</div>' +
              '<div style="font-size:14px;font-weight:600;margin-top:4px;line-height:1.4;">' + esc(r.currentStep) + '</div>' +
              '<div style="margin-top:10px;height:5px;border-radius:99px;background:#ececef;overflow:hidden;">' +
                '<div style="height:100%;border-radius:99px;background:#2563eb;transition:width .8s ease;' + r.progressStyle + '"></div>' +
              '</div>' +
              '<div style="margin-top:6px;font-size:11.5px;color:#9aa0ab;' + mono + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.progressLabel || '') + '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#ececef;border:1px solid #ececef;border-radius:11px;overflow:hidden;margin-top:12px;">' +
              '<div style="background:#fff;padding:12px 15px;">' +
                '<div style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Last attempt compiled</div>' +
                '<div style="font-size:13.5px;font-weight:600;margin-top:4px;' + r.compiledStyle + '">' + esc(r.compiledLabel) + '</div>' +
              '</div>' +
              '<div style="background:#fff;padding:12px 15px;">' +
                '<div style="font-size:11px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Attempts left</div>' +
                '<div style="font-size:13.5px;font-weight:600;margin-top:4px;' + mono + '">' + esc(r.attemptsLeft) + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
              '<div style="font-size:11.5px;color:#9aa0ab;text-transform:uppercase;letter-spacing:0.05em;">Attempt history</div>' +
              '<button data-act="toggle-rundiff" style="display:inline-flex;align-items:center;gap:8px;background:none;border:none;padding:0;cursor:pointer;font-size:12.5px;font-weight:600;' + r.diffLabel + '">' +
                '<span style="position:relative;width:32px;height:18px;border-radius:99px;transition:background .18s ease;' + r.diffTrack + '">' +
                  '<span style="position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(20,22,26,0.25);transition:left .18s ease;' + r.diffKnob + '"></span>' +
                '</span>Diff</button>' +
            '</div>' +
            '<div style="margin-top:10px;display:flex;flex-direction:column;gap:7px;">' +
              (r.attempts.length ? r.attempts.map(function (at) {
                return '<div data-runattempt="' + at.n + '" style="' + at.rowStyle + '">' +
                  '<div style="display:flex;align-items:center;gap:11px;min-width:0;">' +
                    '<span style="flex:none;' + mono + 'font-size:12px;font-weight:600;color:#6b7280;width:20px;">' + esc(at.numLabel) + '</span>' +
                    '<div style="min-width:0;">' +
                      '<div style="font-size:13px;font-weight:600;color:#14161a;">' + esc(at.title) + '</div>' +
                      '<div style="font-size:11.5px;color:#9aa0ab;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(at.detail) + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<span style="flex:none;display:inline-block;font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:5px;white-space:nowrap;' + at.chipStyle + '">' + esc(at.chipLabel) + '</span>' +
                '</div>';
              }).join('') : '<div style="font-size:12.5px;color:#9aa0ab;">No attempts yet — code generation in progress.</div>') +
            '</div>' +
            '<div style="margin-top:10px;font-size:11.5px;color:#9aa0ab;line-height:1.5;">Select an attempt to view its code. Diff shows changes vs. the previous attempt.</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</main>';
  }

  function appHTML(v) {
    var body = v.isHome ? homeHTML(v)
      : (v.isDataset ? detailHTML(v)
      : (v.isRuns ? runsHTML(v)
      : (v.isRun ? runHTML(v)
      : (v.isJudgments ? judgmentsHTML(v)
      : (v.isCatalog ? catalogHTML(v) : datasetsHTML(v))))));
    var overlays = '';
    if (v.submitOpen && v.detail) overlays += submitModalHTML(v);
    if (v.panelOpen) overlays += panelHTML(v);
    if (v.disputeOpen) overlays += disputeModalHTML();
    return '<div style="min-height:100vh;background:#ffffff;">' + navHTML(v) + body + footerHTML() + '</div>' + overlays;
  }

  // ------------------------------------------------------- hash routing
  function hashFor(s) {
    if (s.route === 'dataset' && s.activeId) return '#/dataset/' + s.activeId;
    if (s.route === 'datasets') return '#/datasets';
    if (s.route === 'run' && s.runSlug) return '#/run/' + s.runSlug;
    if (s.route === 'runs') return '#/runs';
    if (s.route === 'judgments') return '#/judgments';
    if (s.route === 'catalog') return '#/catalog';
    return '#/';
  }
  function applyHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    if (parts[0] === 'dataset' && parts[1]) {
      state.route = 'dataset'; state.activeId = decodeURIComponent(parts[1]);
    } else if (parts[0] === 'datasets') {
      state.route = 'datasets';
    } else if (parts[0] === 'run' && parts[1]) {
      state.route = 'run'; state.runSlug = decodeURIComponent(parts[1]);
    } else if (parts[0] === 'runs') {
      state.route = 'runs';
    } else if (parts[0] === 'judgments') {
      state.route = 'judgments';
    } else if (parts[0] === 'catalog') {
      state.route = 'catalog';
    } else {
      state.route = 'home';
    }
  }
  // Fetch the active benchmark's detail if we're on a dataset route and don't have it.
  function syncRouteData() {
    if (state.route === 'dataset' && state.activeId && !state.detailCache[state.activeId]) {
      loadDetail(state.activeId);
    }
    if (state.route === 'runs') loadRuns();
    if (state.route === 'run' && state.runSlug) loadRun(state.runSlug);
    if (state.route === 'judgments') loadJudgments();
    if (state.route === 'catalog' && !state.catalogItems.length) loadCatalog(true);
  }

  // ------------------------------------------------------------- render
  function render() {
    var v = renderVals();
    root.innerHTML = appHTML(v);

    var h = hashFor(state);
    if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { location.hash = h; } }

    if (pendingFocus) {
      var el = document.getElementById(pendingFocus.id);
      if (el) {
        el.focus();
        try { el.setSelectionRange(pendingFocus.caret, pendingFocus.caret); } catch (e2) {}
      }
      pendingFocus = null;
    }
  }

  // ------------------------------------------------------------ actions
  function goDataset(id) {
    var cached = !!state.detailCache[id];
    setState({ route: 'dataset', activeId: id, panelSubId: null, sortMode: 'reproduced', detailError: null, detailErrorStatus: null, detailLoading: !cached });
    if (!cached) loadDetail(id);
  }

  function handleAct(act) {
    switch (act) {
      case 'home': setState({ route: 'home', panelSubId: null, disputeOpen: false, submitOpen: false }); break;
      case 'datasets': setState({ route: 'datasets', panelSubId: null, disputeOpen: false, submitOpen: false }); break;
      case 'search': setState({ route: 'datasets' }); break;
      case 'open-submit': setState({ submitOpen: true }); break;
      case 'close-submit': setState({ submitOpen: false }); break;
      case 'close-panel': setState({ panelSubId: null, disputeOpen: false }); break;
      case 'open-dispute': setState({ disputeOpen: true }); break;
      case 'close-dispute': setState({ disputeOpen: false }); break;
      case 'retry-cards': loadCards(); break;
      case 'retry-detail': if (state.activeId) loadDetail(state.activeId); break;
      case 'runs': setState({ route: 'runs', panelSubId: null, disputeOpen: false, submitOpen: false }); loadRuns(); break;
      case 'retry-runs': loadRuns(); break;
      case 'judgments': setState({ route: 'judgments', panelSubId: null, disputeOpen: false, submitOpen: false }); loadJudgments(); break;
      case 'retry-judgments': loadJudgments(); break;
      case 'toggle-judgfold': setState({ judgFold: !state.judgFold }); break;
      case 'catalog': setState({ route: 'catalog', panelSubId: null, disputeOpen: false, submitOpen: false }); if (!state.catalogItems.length) loadCatalog(true); break;
      case 'catalog-more': loadCatalog(false); break;
      case 'catalog-retry': loadCatalog(true); break;
      case 'judg-more': {
        var loaded = ((state.judgments && state.judgments.items) || []).length + state.judgMore.length;
        setState({ judgMoreLoading: true });
        apiGet('/judgments?limit=10&offset=' + loaded).then(function (d) {
          setState({ judgMore: state.judgMore.concat((d && d.items) || []), judgMoreLoading: false });
        }).catch(function () { setState({ judgMoreLoading: false }); });
        break;
      }
      case 'retry-run': if (state.runSlug) loadRun(state.runSlug); break;
      case 'toggle-rundiff': setState({ runDiff: !state.runDiff }); break;
    }
  }

  function goRun(slug) {
    setState({ route: 'run', runSlug: slug, runDetail: null, runSel: null, runDiff: false, runLoading: true, runError: null });
    loadRun(slug);
  }

  // Single delegated click handler. Walk from the clicked node up to the root and
  // act on the FIRST element that carries an instruction — so an inner link or a
  // [data-stop] guard wins over an outer clickable row / overlay.
  root.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== root) {
      if (el.nodeType === 1) {
        if (el.tagName === 'A' && el.hasAttribute('href')) {
          var href = el.getAttribute('href');
          if (href && href !== '#') return;       // real link: let it navigate
          e.preventDefault(); return;             // "#" link (About): no-op
        }
        if (el.hasAttribute('data-stop')) return; // swallow (e.g. modal body)
        if (el.hasAttribute('data-act')) { handleAct(el.getAttribute('data-act')); return; }
        if (el.hasAttribute('data-open')) { goDataset(el.getAttribute('data-open')); return; }
        if (el.hasAttribute('data-runopen')) { goRun(el.getAttribute('data-runopen')); return; }
        if (el.hasAttribute('data-runattempt')) { setState({ runSel: parseInt(el.getAttribute('data-runattempt'), 10) }); return; }
        if (el.hasAttribute('data-judgrow')) { var ji = parseInt(el.getAttribute('data-judgrow'), 10); setState({ judgOpenIdx: state.judgOpenIdx === ji ? null : ji }); return; }
        if (el.hasAttribute('data-cat')) { setState({ catFilter: el.getAttribute('data-cat') }); return; }
        if (el.hasAttribute('data-sort')) { setState({ sortMode: el.getAttribute('data-sort') }); return; }
        if (el.hasAttribute('data-panel')) { setState({ panelSubId: el.getAttribute('data-panel') }); return; }
      }
      el = el.parentElement;
    }
  });

  var catalogSearchTimer = null;
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-query')) {
      pendingFocus = { id: t.id, caret: t.selectionStart };
      setState({ query: t.value });
    }
    if (t && t.hasAttribute && t.hasAttribute('data-catalogquery')) {
      pendingFocus = { id: t.id, caret: t.selectionStart };
      state.catalogQuery = t.value;
      clearTimeout(catalogSearchTimer);
      catalogSearchTimer = setTimeout(function () { loadCatalog(true); }, 350);
      render();
    }
  });

  root.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && t.id === 'home-search' && e.key === 'Enter') setState({ route: 'datasets' });
  });

  // Escape closes the topmost overlay.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (state.disputeOpen) setState({ disputeOpen: false });
    else if (state.submitOpen) setState({ submitOpen: false });
    else if (state.panelSubId) setState({ panelSubId: null });
  });

  // Browser back/forward.
  window.addEventListener('hashchange', function () { applyHash(); syncRouteData(); render(); });

  // ---------------------------------------------------------------- boot
  applyHash();
  loadCards();        // always need cards + stats for home / datasets / nav
  syncRouteData();    // deep-linked dataset detail
  render();
})();
