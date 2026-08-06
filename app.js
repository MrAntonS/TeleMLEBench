(function () {
  'use strict';

  var state = {
    route: { name: 'home' },
    datasets: [],
    datasetsLoaded: false,
    publishedReleases: [],
    releaseCatalogLoaded: false,
    stats: null,
    detail: null,
    papers: [],
    paperDetail: null,
    reproductions: [],
    reproductionDetail: null,
    coverage: null,
    loading: false,
    error: '',
    localConnection: 'not_required',
    filters: {
      query: '',
      task: 'all',
      origin: 'all',
      access: 'all',
      source: 'all',
      license: 'all',
      publication: 'all',
      papers: 'all',
      reproduction: 'all'
    },
    navOpen: false
  };

  var app = document.getElementById('app');
  var SUPABASE_URL = String(window.TMLB_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  var SUPABASE_KEY = String(window.TMLB_SUPABASE_PUBLISHABLE_KEY || '').trim();
  var LEGACY_API_OVERRIDE = Boolean(new URLSearchParams(window.location.search).get('api'));
  var USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY && !LEGACY_API_OVERRIDE);
  var API_BASE = resolveApiBase();
  var RELEASE_API_BASE = String(window.TMLB_EVALUATION_API_BASE || '').trim().replace(/\/+$/, '');
  var LOOPBACK_PERMISSION_MODE =
    window.location.protocol === 'https:' && isLoopbackApiBase(API_BASE);
  if (LOOPBACK_PERMISSION_MODE) state.localConnection = 'checking';

  function isLoopbackApiBase(value) {
    try {
      var url = new URL(String(value || ''));
      var host = url.hostname.toLowerCase();
      return url.protocol === 'http:' &&
        (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') &&
        url.port === '8080' &&
        url.pathname.replace(/\/+$/, '') === '/api/v1' &&
        !url.username && !url.password && !url.search && !url.hash;
    } catch (_) {
      return false;
    }
  }

  function resolveApiBase() {
    var configured = String(window.TMLB_API_BASE || '').trim().replace(/\/+$/, '');
    var params = new URLSearchParams(window.location.search);
    var override = String(params.get('api') || '').trim().replace(/\/+$/, '');
    var localContext = window.location.protocol === 'file:' || /^(127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    if (override && (
      override.indexOf('https://') === 0 ||
      localContext ||
      isLoopbackApiBase(override)
    )) configured = override;
    if (USE_SUPABASE) return '';
    if (!configured && localContext) {
      configured = 'http://127.0.0.1:8080/api/v1';
    }
    if (
      window.location.protocol === 'https:' &&
      configured &&
      configured.indexOf('https://') !== 0 &&
      !isLoopbackApiBase(configured)
    ) return '';
    return configured;
  }

  function queryLoopbackPermission() {
    if (!LOOPBACK_PERMISSION_MODE || !navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve('prompt');
    }
    return navigator.permissions.query({ name: 'loopback-network' }).catch(function () {
      return navigator.permissions.query({ name: 'local-network-access' });
    }).then(function (permission) {
      return permission && permission.state ? permission.state : 'prompt';
    }).catch(function () {
      return 'prompt';
    });
  }

  function routeNeedsBackend(name) {
    return [
      'home', 'datasets', 'dataset', 'papers', 'paper',
      'reproductions', 'reproduction', 'coverage'
    ].indexOf(name) >= 0;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    try {
      var raw = String(value || '').trim();
      if (!raw) return '';
      var url = new URL(raw, window.location.href);
      return /^(https?:)$/.test(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function text(value, fallback) {
    var out = value == null ? '' : String(value).trim();
    return out || (fallback == null ? '—' : fallback);
  }

  function evidenceText(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.map(evidenceText).filter(Boolean).join(' ');
    }
    if (typeof value === 'object') {
      var quote = value.quote || value.text || value.evidence || value.passage || '';
      var location = [value.section, value.page != null ? 'p. ' + value.page : '']
        .filter(Boolean).join(', ');
      return (location ? '[' + location + '] ' : '') + text(quote, '');
    }
    return text(value, '');
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
    var raw = String(value);
    var dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(value);
    return Number.isNaN(d.valueOf()) ? text(value) : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function slugOf(item) {
    return text(item.slug || item.id || item.canonical_id, '').replace(/^tmleb:/, '');
  }

  function api(path, options) {
    if (USE_SUPABASE) return catalogApi(path);
    if (!API_BASE) return Promise.reject(new Error('The backend API is not configured for this deployment.'));
    var defaults = {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    };
    if (isLoopbackApiBase(API_BASE)) defaults.targetAddressSpace = 'loopback';
    return fetch(API_BASE + path, Object.assign(defaults, options || {})).then(function (res) {
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

  function loadPublishedReleaseCatalog() {
    var base = LEGACY_API_OVERRIDE ? API_BASE : RELEASE_API_BASE;
    if (!base) return Promise.resolve(null);
    return fetch(base + '/releases', {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('Release registry request failed (' + res.status + ')');
      return res.json();
    }).catch(function () {
      return null;
    });
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

  function supabase(table, params) {
    var url = new URL(SUPABASE_URL + '/rest/v1/' + table);
    Object.keys(params || {}).forEach(function (key) {
      if (params[key] != null && params[key] !== '') url.searchParams.set(key, params[key]);
    });
    return fetch(url.href, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        apikey: SUPABASE_KEY
      }
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error('Catalog request failed (' + res.status + ')');
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function supabaseAll(table, params, maximum) {
    var pageSize = 1000;
    var cap = maximum || 5000;
    function next(offset, collected) {
      return supabase(table, Object.assign({}, params || {}, {
        limit: String(Math.min(pageSize, cap - collected.length)),
        offset: String(offset)
      })).then(function (rows) {
        var merged = collected.concat(rows);
        if (rows.length < pageSize || merged.length >= cap) return merged.slice(0, cap);
        return next(offset + rows.length, merged);
      });
    }
    return next(0, []);
  }

  function nested(value) {
    return first(value) || {};
  }

  function latestDate(rows, field) {
    return (rows || []).map(function (row) { return row[field] || ''; }).sort().reverse()[0] || '';
  }

  function datasetFromCatalog(row) {
    var versions = Array.isArray(row.tmlb_dataset_versions) ? row.tmlb_dataset_versions : [];
    var version = versions[0] || {};
    var profile = nested(version.tmlb_dataset_profiles);
    var sources = Array.isArray(row.tmlb_dataset_sources) ? row.tmlb_dataset_sources : [];
    var modalities = Array.isArray(profile.modalities) ? profile.modalities : [];
    return {
      id: row.id,
      canonical_id: row.id,
      slug: row.slug,
      name: row.title,
      title: row.title,
      description: row.description,
      creators: Array.isArray(row.creators) ? row.creators : [],
      publisher: row.publisher,
      doi: row.concept_doi || version.version_doi,
      version: version.version_label || version.version_key,
      versions: versions,
      publication_date: version.publication_date,
      publication_status: version.publication_status,
      access_status: version.access_status || (sources[0] && sources[0].access_status),
      license: version.license_name,
      origin_type: row.origin_type,
      modality: row.modality || profile.primary_family || modalities[0],
      task: profile.primary_task_name || profile.primary_task_type,
      task_type: profile.primary_task_type,
      task_types: profile.primary_task_type ? [profile.primary_task_type] : [],
      task_definition: profile.task_description,
      task_profile: profile,
      tasks: Array.isArray(profile.tasks) ? profile.tasks : [],
      schema: profile.schema || { fields: [] },
      tags: modalities,
      source_count: row.source_count,
      file_count: row.file_count,
      paper_count: row.paper_count,
      total_bytes: 0,
      last_verified: latestDate(sources, 'last_verified') || row.updated_at,
      url: sources[0] && sources[0].landing_url,
      sources: sources,
      releases: [],
      kind: 'trainable_ml',
      asset_type: 'static_dataset',
      relevance_status: 'approved',
      download_status: version.acquisition_status || 'not_requested',
      release_count: 0,
      reproduction_count: 0,
      review: {
        basis: 'qualification',
        decision: 'approved',
        policy_version: 'public-qualified-with-paper-evidence'
      }
    };
  }

  function catalogDatasetRows(params) {
    return supabase('tmlb_datasets', Object.assign({
      select: '*,tmlb_dataset_versions(*,tmlb_dataset_profiles(*)),tmlb_dataset_sources(*)',
      order: 'paper_count.desc,title.asc',
      limit: '500'
    }, params || {}));
  }

  function inFilter(ids) {
    return 'in.(' + ids.map(function (id) {
      return '"' + String(id).replace(/"/g, '') + '"';
    }).join(',') + ')';
  }

  function paperFromUsage(row) {
    var paperVersion = nested(row.tmlb_paper_versions);
    var paper = nested(paperVersion.tmlb_papers);
    var datasetVersion = nested(row.tmlb_dataset_versions);
    var dataset = nested(datasetVersion.tmlb_datasets);
    var sourceUrl = paperVersion.source_url ||
      (paper.doi ? 'https://doi.org/' + paper.doi : '') ||
      (paper.arxiv_id ? 'https://arxiv.org/abs/' + paper.arxiv_id : '');
    return {
      id: paper.id,
      paper_id: paper.id,
      doi: paper.doi,
      arxiv_id: paper.arxiv_id,
      title: paper.title,
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      venue: paper.venue,
      abstract: paper.abstract,
      year: paper.year,
      publication_date: paper.publication_date,
      access_status: paper.access_status,
      url: sourceUrl,
      evidence: row.evidence,
      dataset_name: dataset.title,
      dataset_slug: dataset.slug,
      dataset_version_id: row.version_id,
      confirmed_at: row.confirmed_at
    };
  }

  function catalogUsage(params) {
    return supabaseAll('tmlb_dataset_paper_usage', Object.assign({
      select: 'id,version_id,evidence,confirmed_at,tmlb_dataset_versions(dataset_id,tmlb_datasets(title,slug)),tmlb_paper_versions(source_url,tmlb_papers(id,doi,arxiv_id,title,authors,venue,abstract,publication_date,year,access_status))',
      order: 'confirmed_at.desc'
    }, params || {}), 5000).then(function (rows) {
      var papers = [];
      var byId = {};
      rows.forEach(function (row) {
        var paper = paperFromUsage(row);
        if (!paper.id || !byId[paper.id]) {
          if (paper.id) byId[paper.id] = paper;
          papers.push(paper);
          return;
        }
        var existing = byId[paper.id];
        var combined = (Array.isArray(existing.evidence) ? existing.evidence : [])
          .concat(Array.isArray(paper.evidence) ? paper.evidence : []);
        existing.evidence = combined.filter(function (item, index) {
          var key = JSON.stringify(item);
          return combined.findIndex(function (candidate) {
            return JSON.stringify(candidate) === key;
          }) === index;
        });
      });
      return papers;
    });
  }

  function paperFromCatalog(row) {
    var paperVersions = Array.isArray(row.tmlb_paper_versions) ? row.tmlb_paper_versions : [];
    var datasetUsage = [];
    paperVersions.forEach(function (paperVersion) {
      var usages = Array.isArray(paperVersion.tmlb_dataset_paper_usage)
        ? paperVersion.tmlb_dataset_paper_usage : [];
      usages.forEach(function (usage) {
        var version = nested(usage.tmlb_dataset_versions);
        var dataset = nested(version.tmlb_datasets);
        datasetUsage.push({
          dataset_name: dataset.title,
          dataset_slug: dataset.slug,
          dataset_version_id: usage.version_id,
          evidence: usage.evidence,
          confirmed_at: usage.confirmed_at
        });
      });
    });
    var firstUsage = datasetUsage[0] || {};
    var sourceVersion = paperVersions.filter(function (version) {
      return version.source_url;
    })[0] || {};
    return {
      id: row.id,
      paper_id: row.id,
      doi: row.doi,
      arxiv_id: row.arxiv_id,
      openalex_id: row.openalex_id,
      title: row.title,
      authors: Array.isArray(row.authors) ? row.authors : [],
      venue: row.venue,
      abstract: row.abstract,
      publication_date: row.publication_date,
      year: row.year,
      access_status: row.access_status,
      url: sourceVersion.source_url ||
        (row.doi ? 'https://doi.org/' + row.doi : '') ||
        (row.arxiv_id ? 'https://arxiv.org/abs/' + row.arxiv_id : ''),
      evidence: firstUsage.evidence,
      dataset_name: firstUsage.dataset_name,
      dataset_slug: firstUsage.dataset_slug,
      dataset_usage: datasetUsage,
      versions: paperVersions.map(function (version) {
        return {
          id: version.id,
          version_key: version.version_key,
          text_sha256: version.text_sha256,
          source_url: version.source_url,
          lawful_fulltext: version.lawful_fulltext
        };
      })
    };
  }

  function catalogPapers(params) {
    return supabase('tmlb_papers', Object.assign({
      select: '*,tmlb_paper_versions(id,version_key,text_sha256,source_url,lawful_fulltext,tmlb_dataset_paper_usage(version_id,evidence,confirmed_at,tmlb_dataset_versions(dataset_id,tmlb_datasets(title,slug))))',
      order: 'year.desc.nullslast,title.asc',
      limit: '200'
    }, params || {})).then(function (rows) {
      return rows.map(paperFromCatalog);
    });
  }

  function catalogFiles(slug) {
    return catalogDatasetRows({ slug: 'eq.' + slug, limit: '1' }).then(function (rows) {
      if (!rows.length) return [];
      var sourceIds = (rows[0].tmlb_dataset_sources || []).map(function (source) {
        return source.id;
      });
      if (!sourceIds.length) return [];
      return supabase('tmlb_source_files', {
        select: 'id,source_id,filename,byte_size,media_type,checksum,restricted,acquisition_status,safety_status,manifest_seen_at',
        source_id: inFilter(sourceIds),
        order: 'filename.asc',
        limit: '500'
      });
    });
  }

  function catalogDetail(slug) {
    return catalogDatasetRows({ slug: 'eq.' + slug, limit: '1' }).then(function (rows) {
      if (!rows.length) {
        var err = new Error('Dataset not found.');
        err.status = 404;
        throw err;
      }
      var row = rows[0];
      var versions = row.tmlb_dataset_versions || [];
      var versionIds = versions.map(function (version) { return version.id; });
      var usagePromise = versionIds.length
        ? catalogUsage({ version_id: inFilter(versionIds) })
        : Promise.resolve([]);
      return usagePromise.then(function (papers) {
        var dataset = datasetFromCatalog(row);
        dataset.papers = papers;
        return dataset;
      });
    });
  }

  function catalogStats() {
    return supabase('tmlb_export_metadata', {
      select: 'dataset_count,paper_count,usage_count,generated_at',
      limit: '1'
    }).then(function (rows) {
      var row = rows[0] || {};
      var counts = {
        datasets: row.dataset_count || 0,
        discovered: row.dataset_count || 0,
        approved_static: row.dataset_count || 0,
        approved_static_ml: row.dataset_count || 0,
        cataloged_papers: row.paper_count || 0,
        linked_papers: row.paper_count || 0,
        papers: row.paper_count || 0,
        paper_candidates: 0,
        paper_candidate_datasets: 0,
        paper_linked: row.usage_count || 0,
        confirmed_paper_links: row.usage_count || 0,
        published: 0,
        releases: 0,
        verified_reproductions: 0,
        reproductions: 0
      };
      return Object.assign({
        counts: counts,
        generated_at: row.generated_at,
        source_sync: { terminal: 0, total: 0 }
      }, counts);
    });
  }

  function catalogSources() {
    return supabase('tmlb_dataset_sources', {
      select: 'provider,last_verified',
      order: 'provider.asc',
      limit: '500'
    }).then(function (rows) {
      var providers = {};
      rows.forEach(function (row) {
        var key = row.provider || 'unknown';
        var current = providers[key] || {
          provider: key,
          status: 'published',
          records_seen: 0,
          records_kept: 0,
          last_sync: '',
          authenticated: false
        };
        current.records_seen += 1;
        current.records_kept += 1;
        if (row.last_verified > current.last_sync) current.last_sync = row.last_verified;
        providers[key] = current;
      });
      return {
        items: Object.keys(providers).sort().map(function (key) {
          return providers[key];
        })
      };
    });
  }

  function catalogApi(path) {
    var parsed = new URL(path, 'https://catalog.local');
    var route = parsed.pathname.replace(/\/+$/, '') || '/';
    var fileMatch = route.match(/^\/datasets\/([^/]+)\/files$/);
    var datasetMatch = route.match(/^\/datasets\/([^/]+)$/);
    var paperMatch = route.match(/^\/papers\/([^/]+)$/);
    var reproductionMatch = route.match(/^\/reproductions\/([^/]+)$/);

    if (fileMatch) {
      return catalogFiles(decodeURIComponent(fileMatch[1])).then(function (items) {
        return { items: items, total: items.length };
      });
    }
    if (datasetMatch) return catalogDetail(decodeURIComponent(datasetMatch[1]));
    if (paperMatch) {
      return catalogPapers({ id: 'eq.' + decodeURIComponent(paperMatch[1]), limit: '1' })
        .then(function (items) {
          if (items.length) return items[0];
          var err = new Error('Paper not found.');
          err.status = 404;
          throw err;
        });
    }
    if (reproductionMatch) {
      var missing = new Error('No public reproduction study is published.');
      missing.status = 404;
      return Promise.reject(missing);
    }
    if (route === '/datasets') {
      return catalogDatasetRows().then(function (rows) {
        var items = rows.map(datasetFromCatalog);
        return { items: items, total: items.length };
      });
    }
    if (route === '/papers') {
      var limit = Math.min(Number(parsed.searchParams.get('limit')) || 200, 1000);
      return catalogPapers({ limit: String(limit) }).then(function (items) {
        return { items: items, total: items.length };
      });
    }
    if (route === '/stats' || route === '/catalog/coverage') return catalogStats();
    if (route === '/catalog/sources') return catalogSources();
    if (route === '/reproductions') return Promise.resolve({ items: [], total: 0 });

    var err = new Error('Catalog route is not available.');
    err.status = 404;
    return Promise.reject(err);
  }

  function sourceName(item) {
    var sources = Array.isArray(item.sources) ? item.sources : [];
    return text((sources[0] && sources[0].provider) || item.provider || item.source || (item.hf_id ? 'Hugging Face' : ''), 'Unspecified');
  }

  function taskName(item) {
    var profile = item && item.task_profile && typeof item.task_profile === 'object'
      ? item.task_profile : {};
    return text(item.task || profile.primary_task_type || item.task_type || item.taskType || item.ml_type || item.domain || item.category, 'Needs task adapter');
  }

  function normalizeReview(value) {
    var review = value && typeof value === 'object' && !Array.isArray(value)
      ? value : {};
    var humanAudit = review.human_audit &&
      typeof review.human_audit === 'object' &&
      !Array.isArray(review.human_audit)
      ? review.human_audit : {};
    var basis = text(review.basis, 'legacy_unknown').toLowerCase();
    return {
      versionId: text(review.version_id, ''),
      basis: basis,
      decision: text(review.decision, 'unknown').toLowerCase(),
      modelId: text(review.model_id, ''),
      policyVersion: text(review.policy_version, ''),
      promptHash: text(review.prompt_hash, ''),
      reviewedAt: review.reviewed_at || '',
      humanAuditStatus: text(
        humanAudit.status,
        basis === 'ai' ? 'pending' : 'unknown'
      ).toLowerCase(),
      humanAuditedAt: humanAudit.audited_at || ''
    };
  }

  function normalizeDataset(item) {
    var tags = Array.isArray(item.tags) ? item.tags : [];
    var creators = Array.isArray(item.creators) ? item.creators : [];
    var sources = Array.isArray(item.sources) ? item.sources : [];
    var sourceProviders = unique(sources.map(function (source) {
      return text(source.provider, '');
    }).filter(Boolean));
    var profile = item.task_profile && typeof item.task_profile === 'object'
      ? item.task_profile : null;
    var schema = item.schema && typeof item.schema === 'object'
      ? item.schema : (profile && profile.schema && typeof profile.schema === 'object'
        ? profile.schema : { fields: [] });
    var taskFamilies = Array.isArray(item.task_types) && item.task_types.length
      ? item.task_types
      : (Array.isArray(item.task_families) ? item.task_families : []);
    if (!taskFamilies.length && taskName(item) !== 'Needs task adapter') {
      taskFamilies = [taskName(item)];
    }
    var sourceCount = Number(item.source_count);
    var fileCount = Number(item.file_count);
    return {
      raw: item,
      id: text(item.canonical_id || item.id || item.slug, ''),
      slug: slugOf(item),
      name: text(item.name || item.title, 'Untitled dataset'),
      description: text(item.description, 'No descriptive metadata is available yet.'),
      task: taskName(item),
      tasks: taskFamilies,
      domain: text(item.domain || item.modality, 'Unclassified'),
      origin: text(item.origin_type || item.origin || item.data_origin, 'unknown').toLowerCase(),
      access: text(item.access_status, item.download_status === 'done' ? 'open' : 'unknown').toLowerCase(),
      license: text(item.license, 'Unknown'),
      source: sourceName(item),
      sourceProviders: sourceProviders.length ? sourceProviders : [sourceName(item)],
      sourceCount: Number.isFinite(sourceCount) ? sourceCount : (Array.isArray(item.sources) ? item.sources.length : 0),
      fileCount: Number.isFinite(fileCount) ? fileCount : 0,
      totalBytes: Number(item.total_bytes) || 0,
      paperCount: Number(item.paper_count || item.paperCount) || 0,
      reproductionCount: Number(item.reproduction_count || item.submissionCount) || 0,
      verifiedRunCount: Number(item.verified_run_count) || 0,
      releaseCount: Number(item.release_count) || 0,
      publicationStatus: text(item.publication_status, 'candidate').toLowerCase(),
      updated: item.last_verified || item.updated_at || item.publication_date || '',
      url: safeUrl(item.url || item.landing_url || item.accessLink),
      doi: text(item.doi, ''),
      tags: tags.slice(0, 8),
      creators: creators,
      publisher: text(item.publisher, 'Not recorded'),
      version: text(item.version, 'Not recorded'),
      taskDefinition: text(item.task_definition, ''),
      taskProfile: profile,
      schema: schema,
      isMl: !item.kind || item.kind === 'trainable_ml',
      isStatic: !item.asset_type || item.asset_type === 'static_dataset',
      approved: !item.relevance_status || item.relevance_status === 'approved',
      downloadStatus: text(item.download_status, 'not_requested'),
      lastVerified: item.last_verified || '',
      review: normalizeReview(item.review)
    };
  }

  function datasetVersionIds(dataset) {
    var raw = dataset && dataset.raw && typeof dataset.raw === 'object'
      ? dataset.raw : {};
    var versions = Array.isArray(raw.versions)
      ? raw.versions
      : (Array.isArray(raw.tmlb_dataset_versions) ? raw.tmlb_dataset_versions : []);
    return versions.map(function (version) {
      return text(version && version.id, '').toLowerCase();
    }).filter(Boolean);
  }

  function releaseMatchesDataset(release, dataset) {
    var datasetId = text(dataset && dataset.id, '').toLowerCase();
    var datasetSlug = text(dataset && dataset.slug, '').toLowerCase();
    var releaseDatasetId = text(release && release.dataset_id, '').toLowerCase();
    var releaseVersionId = text(release && release.dataset_version_id, '').toLowerCase();
    var aliases = Array.isArray(release && release.dataset_aliases)
      ? release.dataset_aliases.map(function (alias) {
        return text(alias, '').toLowerCase();
      }).filter(Boolean)
      : [];
    return Boolean(
      (datasetId && datasetId === releaseDatasetId) ||
      (releaseVersionId && datasetVersionIds(dataset).indexOf(releaseVersionId) >= 0) ||
      (datasetSlug && aliases.indexOf(datasetSlug) >= 0)
    );
  }

  function applyPublishedReleases(datasets, releases) {
    datasets.forEach(function (dataset) {
      dataset.releaseCount = 0;
      dataset.publishedReleases = [];
    });
    releases.forEach(function (release) {
      var dataset = datasets.find(function (candidate) {
        return releaseMatchesDataset(release, candidate);
      });
      if (!dataset) return;
      dataset.publishedReleases.push(release);
      dataset.releaseCount = dataset.publishedReleases.length;
    });
  }

  function featuredDatasets() {
    if (!state.releaseCatalogLoaded) return state.datasets.slice(0, 6);
    return state.datasets.filter(function (dataset) {
      return dataset.releaseCount > 0;
    });
  }

  function normalizePaper(item) {
    return {
      id: text(item.paper_id || item.arxiv_id || item.doi || item.id, ''),
      title: text(item.title, 'Untitled paper'),
      authors: Array.isArray(item.authors) ? item.authors.join(', ') : text(item.authors, 'Authors not indexed'),
      year: text(item.year || item.publication_year, '—'),
      venue: text(item.venue, 'Venue not indexed'),
      abstract: text(item.abstract, ''),
      publicationDate: item.publication_date || '',
      url: safeUrl(item.url || item.pdf_url || (item.arxiv_id ? 'https://arxiv.org/abs/' + item.arxiv_id : '')),
      evidence: evidenceText(item.evidence || item.usage_evidence),
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
      outcome: text(
        item.outcome || item.status || item.state || item.reproStatus,
        'queued'
      ),
      claimed: item.claimed_score != null ? item.claimed_score : item.claimedScore,
      reproduced: item.reproduced_score != null ? item.reproduced_score : item.score,
      metric: text(item.metric, 'Metric not recorded'),
      started: item.started_at || item.startedAt || '',
      evidence: evidenceText(item.evidence),
      url: safeUrl(item.url || item.report_url || '')
    };
  }

  function isPublicMl(d) {
    return d.isMl && d.isStatic && d.approved;
  }

  function loadCore() {
    if (state.datasetsLoaded) {
      state.loading = false;
      render();
      return Promise.resolve();
    }
    state.loading = true;
    state.error = '';
    render();
    return Promise.all([
      loadDatasetPages(),
      optional('/stats'),
      optional('/catalog/coverage'),
      loadPublishedReleaseCatalog()
    ]).then(function (values) {
      state.datasets = list(values[0]).map(normalizeDataset).filter(isPublicMl)
        .sort(function (left, right) {
          return (right.paperCount - left.paperCount) ||
            (right.fileCount - left.fileCount) ||
            left.name.localeCompare(right.name);
        });
      state.releaseCatalogLoaded = values[3] !== null;
      state.publishedReleases = list(values[3]);
      if (state.releaseCatalogLoaded) {
        applyPublishedReleases(state.datasets, state.publishedReleases);
      }
      state.datasetsLoaded = true;
      state.stats = Object.assign(
        {},
        values[1] || {},
        (values[2] && values[2].counts) || {}
      );
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
      optional('/reproductions?dataset=' + encodeURIComponent(slug) + '&limit=100')
    ]).then(function (values) {
      var raw = values[0] || {};
      var dataset = normalizeDataset(raw);
      var detailPapers = list(raw.papers).map(normalizePaper);
      var reproductionPayload = values[2];
      var reproductionItems = list(reproductionPayload).filter(function (r) {
        return !r.slug || r.slug === slug || r.dataset_slug === slug;
      }).map(normalizeReproduction);
      state.detail = {
        dataset: dataset,
        taskProfile: raw.task_profile && typeof raw.task_profile === 'object'
          ? raw.task_profile : null,
        schema: raw.schema && typeof raw.schema === 'object'
          ? raw.schema
          : (raw.task_profile && raw.task_profile.schema
            ? raw.task_profile.schema : { fields: [] }),
        files: list(values[1]),
        sources: Array.isArray(raw.sources) ? raw.sources : [],
        versions: Array.isArray(raw.versions) ? raw.versions : [],
        releases: Array.isArray(raw.releases) ? raw.releases : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        papers: detailPapers,
        reproductions: reproductionItems
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
    Promise.all([
      api('/papers?limit=200'),
      optional('/catalog/coverage')
    ]).then(function (values) {
      state.papers = list(values[0]).map(normalizePaper);
      if (values[1]) {
        state.coverage = {
          summary: values[1],
          sources: state.coverage ? state.coverage.sources : []
        };
      }
    }).catch(function (err) {
      state.error = err.message || 'Paper metadata could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadPaperDetail(id) {
    state.loading = true;
    state.error = '';
    state.paperDetail = null;
    render();
    api('/papers/' + encodeURIComponent(id)).then(function (payload) {
      state.paperDetail = payload;
    }).catch(function (err) {
      state.error = err.message || 'Paper evidence could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadReproductions() {
    state.loading = true;
    state.error = '';
    render();
    api('/reproductions?limit=200').then(function (payload) {
      state.reproductions = list(payload).map(normalizeReproduction);
    }).catch(function (err) {
      state.error = err.message || 'Reproduction records could not be loaded.';
    }).finally(function () {
      state.loading = false;
      render();
    });
  }

  function loadReproductionDetail(id) {
    state.loading = true;
    state.error = '';
    state.reproductionDetail = null;
    render();
    api('/reproductions/' + encodeURIComponent(id)).then(function (payload) {
      state.reproductionDetail = payload;
    }).catch(function (err) {
      state.error = err.message || 'Reproduction report could not be loaded.';
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
    return '<span class="tml-logo" aria-hidden="true">' +
      '<span style="height:6px"></span>' +
      '<span style="height:11px"></span>' +
      '<span style="height:16px"></span>' +
      '<span style="height:11px"></span>' +
      '<span style="height:6px"></span>' +
    '</span>';
  }
  function navLink(route, label) {
    var active = state.route.name === route ||
      (route === 'datasets' && state.route.name === 'dataset') ||
      (route === 'papers' && state.route.name === 'paper') ||
      (route === 'reproductions' && state.route.name === 'reproduction');
    return '<a class="tml-navlink' + (active ? ' active' : '') + '" href="#/' + route + '"' +
      (active ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
  }

  function header() {
    return '<header class="tml-header"><div class="tml-header-inner">' +
      '<a class="tml-brand" href="#/home">' + logo() +
        '<span class="tml-brand-copy"><strong>OpenWirelessML</strong><small>PUBLIC RESEARCH CATALOG</small></span></a>' +
      '<button class="tml-nav-toggle" data-action="toggle-nav" aria-expanded="' +
        (state.navOpen ? 'true' : 'false') + '" aria-label="Toggle navigation">Menu</button>' +
      '<nav class="tml-nav ' + (state.navOpen ? 'open' : '') + '" aria-label="Main navigation">' +
        navLink('home', 'Home') +
        navLink('datasets', 'Datasets') +
        navLink('papers', 'Papers') +
        navLink('reproductions', 'Studies') +
        navLink('coverage', 'Coverage') +
        navLink('contribute', 'Contribute') +
        navLink('methodology', 'About') +
      '</nav>' +
    '</div></header>';
  }

  function footer() {
    return '<footer class="tml-footer"><div class="tml-footer-inner">' +
      '<div><strong>OpenWirelessML</strong><span>Open wireless ML data, prepared for research.</span></div>' +
      '<div class="tml-footer-links"><a href="#/datasets">Datasets</a>' +
        '<a href="#/papers">Papers</a><a href="#/coverage">Coverage</a>' +
        '<a href="https://github.com/MrAntonS/TeleMLEBench" target="_blank" rel="noopener">GitHub ↗</a></div>' +
    '</div></footer>';
  }
  function statusBadge(value, tone) {
    var normalized = text(tone || value, 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return '<span class="tml-status ' + normalized + '">' +
      esc(text(value, 'unknown').replace(/_/g, ' ')) + '</span>';
  }

  function reviewPresentation(review) {
    if (review.basis === 'qualification') {
      return { label: 'Qualified - paper evidence linked', tone: 'verified' };
    }
    if (review.basis === 'ai') {
      if (review.humanAuditStatus === 'completed') {
        return { label: 'AI reviewed · human audited', tone: 'verified' };
      }
      if (review.humanAuditStatus === 'flagged') {
        return { label: 'AI reviewed · audit flagged', tone: 'rejected' };
      }
      if (review.humanAuditStatus === 'in_progress') {
        return { label: 'AI reviewed · audit in progress', tone: 'pending' };
      }
      return { label: 'AI reviewed · audit pending', tone: 'pending' };
    }
    if (review.basis === 'human') {
      return { label: 'Human reviewed', tone: 'verified' };
    }
    return { label: 'Review provenance unavailable', tone: 'unknown' };
  }

  function reviewBadge(review) {
    var presentation = reviewPresentation(review);
    return statusBadge(presentation.label, presentation.tone);
  }

  function publicationReviewFact(review) {
    if (review.basis === 'qualification') return 'Qualification gates passed';
    if (review.basis === 'ai') {
      return 'AI' + (review.modelId ? ' · ' + review.modelId : '');
    }
    if (review.basis === 'human') return 'Human';
    return 'Not recorded';
  }

  function reviewPolicyFact(review) {
    var policy = text(review.policyVersion, 'Not recorded');
    return review.reviewedAt
      ? policy + ' · ' + date(review.reviewedAt)
      : policy;
  }

  function humanAuditFact(review) {
    var labels = {
      pending: 'Pending',
      in_progress: 'In progress',
      completed: 'Completed',
      flagged: 'Flagged',
      unknown: 'Not recorded'
    };
    var label = labels[review.humanAuditStatus] || text(
      review.humanAuditStatus.replace(/_/g, ' '),
      'Not recorded'
    );
    return review.humanAuditedAt
      ? label + ' · ' + date(review.humanAuditedAt)
      : label;
  }

  function observatoryPanel(stats, sourceCount) {
    var releases = state.releaseCatalogLoaded
      ? state.publishedReleases.length
      : (stats.published || stats.releases || 0);
    var papers = stats.linked_papers != null
      ? stats.linked_papers
      : (stats.papers != null ? stats.papers : 0);
    return '<aside class="ow-observatory" aria-label="OpenWirelessML catalog observatory">' +
      '<div class="ow-panel-head"><span>CATALOG_OBSERVATORY</span><span class="ow-live"><i></i> PUBLIC INDEX</span></div>' +
      '<div class="ow-spectrum">' +
        '<svg viewBox="0 0 640 330" role="img" aria-label="Abstract wireless spectrum illustration">' +
          '<g class="ow-grid-lines"><path d="M0 55H640M0 110H640M0 165H640M0 220H640M0 275H640"/>' +
          '<path d="M80 0V330M160 0V330M240 0V330M320 0V330M400 0V330M480 0V330M560 0V330"/></g>' +
          '<g class="ow-band-labels"><text x="16" y="28">RF / IQ</text><text x="155" y="28">CHANNEL</text>' +
          '<text x="304" y="28">MOBILITY</text><text x="470" y="28">NETWORK</text></g>' +
          '<path class="ow-trace-glow" d="M0 218 C45 218 56 210 82 210 C112 210 112 126 144 126 C177 126 184 250 218 250 C254 250 263 78 302 78 C337 78 346 189 382 189 C418 189 432 145 466 145 C503 145 520 227 556 227 C592 227 600 174 640 174"/>' +
          '<path class="ow-trace" d="M0 218 C45 218 56 210 82 210 C112 210 112 126 144 126 C177 126 184 250 218 250 C254 250 263 78 302 78 C337 78 346 189 382 189 C418 189 432 145 466 145 C503 145 520 227 556 227 C592 227 600 174 640 174"/>' +
          '<g class="ow-markers"><circle cx="144" cy="126" r="5"/><circle cx="302" cy="78" r="5"/>' +
          '<circle cx="466" cy="145" r="5"/><circle cx="640" cy="174" r="5"/></g>' +
          '<g class="ow-axis"><text x="0" y="322">STATIC DATASETS</text><text x="520" y="322">OPEN INDEX</text></g>' +
        '</svg>' +
        '<div class="ow-reticle ow-reticle-a"></div><div class="ow-reticle ow-reticle-b"></div>' +
      '</div>' +
      '<div class="ow-readouts">' +
        '<div><span>DATASETS</span><strong>' + esc(number(state.datasets.length || stats.approved_static)) + '</strong></div>' +
        '<div><span>RELEASES</span><strong>' + esc(number(releases)) + '</strong></div>' +
        '<div><span>PAPERS</span><strong>' + esc(number(papers)) + '</strong></div>' +
        '<div><span>SOURCES</span><strong>' + esc(number(sourceCount)) + '</strong></div>' +
      '</div>' +
    '</aside>';
  }
  function statBlock(value, label) {
    return '<div><div class="mono tml-stat-value">' + esc(number(value)) +
      '</div><div class="tml-stat-label">' + esc(label) + '</div></div>';
  }

  function datasetCard(d) {
    var category = d.task === 'Needs task adapter' ? d.domain : d.task;
    var releaseLabel = d.releaseCount > 0
      ? d.releaseCount + (d.releaseCount === 1 ? ' public release' : ' public releases')
      : 'Source record';
    return '<a class="tml-card tml-dataset-card" href="#/dataset/' +
      encodeURIComponent(d.slug) + '">' +
      '<div class="tml-card-top"><span class="tml-category">' +
        esc(category) + '</span><span class="tml-record-id">' + esc(d.slug) + '</span></div>' +
      '<h3>' + esc(d.name) + '</h3>' +
      '<p class="tml-clamp2">' + esc(d.description) + '</p>' +
      '<div class="tml-card-bottom">' +
        '<div><div class="tml-meta-label">Primary source</div>' +
          '<div class="tml-meta-value">' + esc(d.source) + '</div></div>' +
        '<div class="tml-card-counts">' +
          '<div><strong class="mono">' + esc(number(d.fileCount || 0)) + '</strong><span> files</span></div>' +
          '<div><strong class="mono">' + esc(number(d.paperCount || 0)) + '</strong><span> papers</span></div>' +
        '</div>' +
      '</div><div class="tml-release-line"><span>' + esc(releaseLabel) + '</span>' +
        '<span>' + esc(d.access) + '</span></div></a>';
  }
  function loading(message) {
    return '<div class="tml-state"><span class="tml-spinner" aria-hidden="true"></span>' +
      '<p>' + esc(message || 'Loading evidence…') + '</p></div>';
  }

  function errorBox() {
    if (LOOPBACK_PERMISSION_MODE && state.localConnection !== 'connected') {
      var denied = state.localConnection === 'denied';
      var failed = state.localConnection === 'failed';
      var heading = denied
        ? 'Allow access to the local backend'
        : failed ? 'Local backend not reachable' : 'Connect to the local backend';
      var message = denied
        ? 'Chrome blocked this site from reaching localhost. Open the site controls, allow Local network access, then try again.'
        : failed
          ? state.error
          : 'This temporary GitHub Pages build reads the API running on this computer at 127.0.0.1:8080.';
      return '<div class="tml-state' + (denied || failed ? ' error' : '') + '">' +
        '<h3>' + heading + '</h3><p>' + esc(message) + '</p>' +
        (!denied
          ? '<p class="muted">When Chrome asks, choose Allow. The page cannot access any other host or port.</p>'
          : '') +
        '<button class="tml-button primary" data-action="connect-local">' +
          (failed || denied ? 'Try again' : 'Connect local backend') +
        '</button></div>';
    }
    var unconfigured = !API_BASE && !USE_SUPABASE;
    return '<div class="tml-state error"><h3>' +
      (unconfigured ? 'Backend not configured' : 'Evidence service unavailable') +
      '</h3><p>' + esc(state.error) + '</p>' +
      (unconfigured
        ? '<a class="tml-button primary" href="#/methodology">Read the methodology</a>'
        : '<button class="tml-button primary" data-action="retry">Retry</button>') +
      '</div>';
  }

  function homePage() {
    var stats = state.stats || {};
    var sourceProviders = unique([].concat.apply([], state.datasets.map(function (d) {
      return d.sourceProviders;
    })));
    var releases = state.releaseCatalogLoaded
      ? state.publishedReleases.length
      : (stats.published || stats.releases || 0);
    var linkedPapers = stats.linked_papers != null
      ? stats.linked_papers
      : (stats.papers != null ? stats.papers : 0);
    var records = state.datasets.length || stats.approved_static || 0;
    var domains = [
      ['Cellular and RAN', 'IDX_01', 'cellular'],
      ['Channel / MIMO / CSI', 'IDX_02', 'channel'],
      ['RF / IQ / Spectrum', 'IDX_03', 'rf'],
      ['Mobility / Localization', 'IDX_04', 'mobility'],
      ['Traffic / KPI / QoE', 'IDX_05', 'traffic'],
      ['IoT / Network Security', 'IDX_06', 'security'],
      ['Satellite / NTN', 'IDX_07', 'satellite'],
      ['Optical Networking', 'IDX_08', 'optical']
    ];
    function domainRecordCount(term) {
      return state.datasets.filter(function (d) {
        return [d.domain, d.task, d.description].join(' ').toLowerCase().indexOf(term) >= 0;
      }).length;
    }
    function ledgerRow(label, value, stateLabel) {
      return '<div class="ow-ledger-row"><span class="ow-ledger-name">' + esc(label) +
        '</span><strong>' + esc(number(value)) + '</strong><span class="ow-ledger-state">' +
        esc(stateLabel) + '</span></div>';
    }
    return '<main id="main">' +
      '<section class="tml-herosec"><div class="ow-hero-grid">' +
        '<div class="ow-hero-copy"><div class="ow-kicker"><span></span> RESEARCH PUBLICATION 014</div>' +
          '<h1 class="tml-hero">From wireless data to <em>defensible research.</em></h1>' +
          '<p class="tml-hero-copy">OpenWirelessML is a public catalog for conventional wireless and telecom machine learning. ' +
            'Find the source record, understand the dataset version, inspect prepared releases, and follow the papers that use the data.</p>' +
          '<div class="ow-hero-actions"><a class="tml-button primary" href="#/datasets">Browse datasets</a>' +
            '<a class="tml-button" href="#/methodology">Read the methodology</a></div>' +
          '<p class="ow-scope-note"><span>PUBLIC SCOPE</span> Static datasets, documented tasks, paper-use evidence, and controlled studies.</p>' +
        '</div>' +
        observatoryPanel(stats, sourceProviders.length) +
      '</div></section>' +
      '<section class="ow-editorial tml-section"><div class="ow-editorial-label"><div class="ow-kicker"><span></span> WHY OPENWIRELESSML EXISTS</div>' +
        '<h2>Why OpenWirelessML Exists</h2></div>' +
        '<div class="ow-editorial-copy"><p>The telecom ML research landscape is currently fractured by scattered datasets and a reproducibility crisis. OpenWirelessML solves this by centralizing fragmented resources and enforcing a rigid, transparent pipeline.</p>' +
        '<p>We provide standardized dataset splitting, baseline reproductions for instant verification, and an unbroken, auditable computational lineage for every prediction—replacing opaque scores with cryptographic certainty.</p></div>' +
      '</section>' +
      '<section class="ow-ledger-section tml-section"><div class="ow-ledger-copy">' +
        '<div class="ow-kicker"><span></span> PHILOSOPHY</div><h2>Progress is evidence.</h2>' +
        '<p>OpenWirelessML reports completed public states, not guesses. Candidate metadata, unavailable releases, and unrun studies stay visible as such.</p>' +
        '<p>When a count appears here, it comes from a public catalog record or an immutable research artifact—not a theoretical benchmark.</p></div>' +
        '<div class="ow-ledger" aria-label="OpenWirelessML public catalog state">' +
          '<div class="ow-ledger-head"><span>PUBLIC RECORD</span><span>COUNT</span><span>STATE</span></div>' +
          ledgerRow('Dataset records', records, 'CATALOGED') +
          ledgerRow('Prepared releases', releases, 'PUBLIC MANIFESTS') +
          ledgerRow('Paper-use links', linkedPapers, 'EXACT EVIDENCE') +
          ledgerRow('Source families', sourceProviders.length, 'INDEXED') +
        '</div>' +
      '</section>' +
      '<section class="ow-domain-section tml-section"><div class="ow-domain-intro">' +
        '<div class="ow-kicker"><span></span> CLASSIFICATION</div><h2>Research domains</h2>' +
        '<p>An index of supported telecommunications research areas, organized for finding relevant machine-learning data.</p></div>' +
        '<div class="ow-domain-index">' + domains.map(function (domain) {
          var count = domainRecordCount(domain[2]);
          return '<a href="#/datasets" class="ow-domain-item"><span>' + esc(domain[0]) +
            '</span><span><small>' + esc(domain[1]) + '</small><strong>' + esc(number(count)) +
            ' records</strong><b>+</b></span></a>';
        }).join('') + '</div>' +
      '</section>' +
      '<section class="ow-final-cta"><div class="ow-kicker"><span></span> OPENWIRELESSML / PUBLIC CATALOG</div>' +
        '<h2>Start with the data.<br><em>Keep the evidence.</em></h2>' +
        '<p>Browse the catalog or read how OpenWirelessML separates source metadata, releases, papers, and controlled studies.</p>' +
        '<div class="ow-hero-actions"><a class="tml-button primary" href="#/datasets">Browse datasets</a>' +
          '<a class="tml-button" href="#/methodology">Read the methodology</a></div>' +
      '</section></main>';
  }
  function filterOptions(values, selected) {
    return '<option value="all">All</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function choiceOptions(values, selected) {
    return '<option value="all">All</option>' + values.map(function (item) {
      return '<option value="' + esc(item.value) + '"' +
        (item.value === selected ? ' selected' : '') + '>' + esc(item.label) + '</option>';
    }).join('');
  }

  function unique(values) {
    return Array.from(new Set(values.filter(function (v) { return v && v !== 'unknown' && v !== 'Unclassified'; }))).sort();
  }

  function filteredDatasets() {
    var f = state.filters;
    var q = f.query.trim().toLowerCase();
    return state.datasets.filter(function (d) {
      var corpus = [d.name, d.description, d.task, d.domain, d.source, d.license]
        .concat(d.tasks, d.sourceProviders, d.tags).join(' ').toLowerCase();
      return (!q || corpus.indexOf(q) >= 0) &&
        (f.task === 'all' || d.tasks.indexOf(f.task) >= 0) &&
        (f.origin === 'all' || d.origin === f.origin) &&
        (f.access === 'all' || d.access === f.access) &&
        (f.source === 'all' || d.sourceProviders.indexOf(f.source) >= 0) &&
        (f.license === 'all' || d.license === f.license) &&
        (f.publication === 'all' ||
          (f.publication === 'released' ? d.releaseCount > 0 : d.releaseCount === 0)) &&
        (f.papers === 'all' ||
          (f.papers === 'linked' ? d.paperCount > 0 : d.paperCount === 0));
    });
  }

  function datasetsPage() {
    var results = filteredDatasets();
    return '<main id="main" class="tml-page">' +
      '<div class="ow-page-heading"><div><div class="ow-kicker"><span></span> PUBLIC DATA INDEX</div>' +
        '<h1>Datasets</h1><p class="tml-page-intro">Browse static wireless and network ML datasets across repositories. ' +
          'Each record keeps its source, task context, public files, prepared releases, and linked papers together.</p></div>' +
        '<div class="ow-page-readout"><span>VISIBLE RECORDS</span><strong>' + esc(number(results.length)) + '</strong></div></div>' +
      '<div class="tml-filter-search" role="search">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
        '<label class="sr-only" for="filter-query">Search</label>' +
        '<input id="filter-query" data-filter="query" value="' + esc(state.filters.query) +
          '" placeholder="Search datasets, tasks, domains, or sources…">' +
      '</div>' +
      '<div class="tml-filters" aria-label="Dataset filters">' +
        '<div class="field"><label for="filter-task">Task</label><select id="filter-task" data-filter="task">' + filterOptions(unique([].concat.apply([], state.datasets.map(function(d){return d.tasks;}))), state.filters.task) + '</select></div>' +
        '<div class="field"><label for="filter-origin">Origin</label><select id="filter-origin" data-filter="origin">' + filterOptions(unique(state.datasets.map(function(d){return d.origin;})), state.filters.origin) + '</select></div>' +
        '<div class="field"><label for="filter-access">Access</label><select id="filter-access" data-filter="access">' + filterOptions(unique(state.datasets.map(function(d){return d.access;})), state.filters.access) + '</select></div>' +
        '<div class="field"><label for="filter-source">Source</label><select id="filter-source" data-filter="source">' + filterOptions(unique([].concat.apply([], state.datasets.map(function(d){return d.sourceProviders;}))), state.filters.source) + '</select></div>' +
        '<div class="field"><label for="filter-license">License</label><select id="filter-license" data-filter="license">' + filterOptions(unique(state.datasets.map(function(d){return d.license;})), state.filters.license) + '</select></div>' +
        '<div class="field"><label for="filter-publication">Release</label><select id="filter-publication" data-filter="publication">' + choiceOptions([{value:'released',label:'Prepared release available'},{value:'source-only',label:'Source record only'}], state.filters.publication) + '</select></div>' +
        '<div class="field"><label for="filter-papers">Papers</label><select id="filter-papers" data-filter="papers">' + choiceOptions([{value:'linked',label:'Linked paper use'},{value:'none',label:'No linked paper use'}], state.filters.papers) + '</select></div>' +
      '</div>' +
      '<div class="tml-result-line"><span>' + esc(number(results.length)) +
        ' dataset records</span><span>Scope: static trainable ML for wireless systems</span></div>' +
      (state.loading ? loading() : state.error ? errorBox() : results.length
        ? '<div class="tml-cardgrid">' + results.map(datasetCard).join('') + '</div>'
        : '<div class="tml-state"><h3>No matching dataset records</h3><p>Clear one or more filters to widen the catalog.</p><button class="tml-button" data-action="clear-filters">Clear filters</button></div>') +
      '</main>';
  }
  function externalButton(url, label) {
    return url ? '<a class="btn btn-ghost" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + ' ↗</a>' : '';
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
    if (!detail.files.length) return '<div class="empty"><h3>No provider file manifest</h3><p class="muted">This record remains source-linked until the provider exposes or OpenWirelessML verifies a file inventory.</p></div>';
    return detail.files.slice(0, 30).map(function (f) {
      var url = safeUrl(f.content_url || f.url || f.download_url);
      var open = f.restricted === false || f.is_restricted === false || detail.dataset.access === 'open';
      return '<div class="file-row"><div><div class="row-title mono">' + esc(text(f.filename || f.name || f.path, 'unnamed file')) + '</div><div class="row-meta">' + esc(bytes(f.byte_size || f.size)) + (f.checksum ? ' · checksum indexed' : ' · checksum not listed') + '</div></div>' +
        (url && open ? '<a class="btn btn-light" href="' + esc(url) + '" target="_blank" rel="noopener">Provider file ↗</a>' : statusBadge(f.restricted ? 'restricted' : 'metadata only')) + '</div>';
    }).join('');
  }

  function taskReleaseRows(detail) {
    if (!detail.tasks.length && !detail.releases.length) {
      return '<div class="empty"><h3>No immutable task release</h3><p class="muted">No target, sample boundary, leakage policy, and split assignment have passed publication review for this version.</p></div>';
    }
    var tasks = detail.tasks.map(function (task) {
      return '<div class="source-row"><div><div class="row-title">' +
        esc(text(task.task_family || task.task_key, 'Task')) +
        '</div><div class="row-meta">' +
        esc(text(task.recipe_version, 'recipe not recorded')) + ' · ' +
        esc(text(task.adapter_status, 'unknown')) +
        '</div></div>' + statusBadge(task.adapter_status || 'unknown') + '</div>';
    }).join('');
    var releases = detail.releases.map(function (release) {
      var manifest = API_BASE
        ? API_BASE + '/releases/' + encodeURIComponent(release.id) + '/manifest'
        : '';
      return '<div class="source-row"><div><div class="row-title mono">' +
        esc(release.id) + '</div><div class="row-meta">' +
        esc(text(release.release_version, 'immutable release')) + ' · ' +
        esc(date(release.published_at)) +
        '</div></div>' +
        (manifest ? '<a class="btn btn-light" href="' + esc(manifest) +
          '" target="_blank" rel="noopener">Manifest + checksums ↗</a>' :
          statusBadge(release.status || 'published')) +
        '</div>';
    }).join('');
    var first = detail.releases[0];
    var example = first && API_BASE
      ? "import requests\n\nmanifest = requests.get(\n    " +
        JSON.stringify(API_BASE + '/releases/' + encodeURIComponent(first.id) + '/manifest') +
        ",\n    timeout=30,\n).json()\nprint(manifest['release_id'])"
      : '';
    return '<div class="source-list">' + tasks + releases + '</div>' +
      (example ? '<div class="loading-example"><div class="row-meta">Python loading example</div><pre><code>' +
        esc(example) + '</code></pre></div>' : '');
  }

  function metadataTaskRows(detail) {
    var profile = detail.taskProfile;
    var tasks = profile && Array.isArray(profile.tasks) ? profile.tasks : [];
    if (!tasks.length) return '';
    return '<div class="source-list" style="margin-top:16px">' + tasks.map(function (task) {
      var target = task.target && task.target.name
        ? ' · target ' + task.target.name + ' (' + text(task.target.basis, 'inferred') + ')'
        : '';
      return '<div class="source-row"><div><div class="row-title">' +
        esc(text(task.task_name, 'Metadata-derived task')) +
        '</div><div class="row-meta">' +
        esc(text(task.task_type, 'unknown').replace(/_/g, ' ') + target) +
        '</div></div>' + statusBadge('suggested') + '</div>';
    }).join('') + '</div>';
  }

  function schemaRows(detail) {
    var schema = detail.schema && typeof detail.schema === 'object'
      ? detail.schema : {};
    var fields = Array.isArray(schema.fields) ? schema.fields : [];
    if (!fields.length) {
      return '<div class="empty"><h3>No metadata schema available</h3><p class="muted">The provider has not exposed field-level metadata yet. OpenWirelessML does not invent columns from filenames or assume the last column is a target.</p></div>';
    }
    return '<div style="overflow-x:auto"><table class="repro-table"><thead><tr><th>Field</th><th>Type / shape</th><th>Role</th><th>Description</th></tr></thead><tbody>' +
      fields.map(function (field) {
        var typeShape = text(field.data_type, 'unknown') +
          (field.shape ? ' · ' + field.shape : '');
        return '<tr><td class="mono"><strong>' + esc(text(field.name, 'unnamed')) +
          '</strong></td><td>' + esc(typeShape) + '</td><td>' +
          esc(text(field.role, 'unknown')) + '</td><td>' +
          esc(text(field.description, 'No field description recorded.')) +
          '<div class="row-meta">' + esc(text(field.basis, 'inferred')) +
          ' metadata</div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<dl class="kv" style="margin-top:14px">' +
        '<dt>Sample unit</dt><dd>' + esc(text(schema.sample_unit, 'Not established')) + '</dd>' +
        '<dt>Grouping keys</dt><dd class="mono">' + esc(Array.isArray(schema.grouping_keys) && schema.grouping_keys.length ? schema.grouping_keys.join(', ') : 'Not established') + '</dd>' +
        '<dt>Time key</dt><dd class="mono">' + esc(text(schema.time_key, 'Not established')) + '</dd>' +
      '</dl>';
  }

  function paperRows(papers) {
    if (!papers.length) return '<div class="empty"><h3>No evidence-linked paper use yet</h3><p class="muted">A citation alone is not accepted as dataset use. Machine-linked relationships require an inspectable evidence passage and remain open to correction.</p></div>';
    return papers.map(function (p) {
      var detailUrl = p.id ? '#/paper/' + encodeURIComponent(p.id) : '';
      return '<article class="paper-row"><div class="card-kicker">' + statusBadge(p.status) + '<span class="id">' + esc(p.year) + '</span></div><h3 style="margin:12px 0 6px">' +
        (detailUrl ? '<a href="' + detailUrl + '">' + esc(p.title) + '</a>' :
          p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' : esc(p.title)) +
        '</h3><p class="muted" style="font-size:13px">' + esc(p.authors) + '</p>' +
        (p.evidence ? '<div class="evidence"><strong>Usage evidence</strong><br>' + esc(p.evidence) + '</div>' : '<div class="evidence">Relationship metadata exists, but a public evidence span is not available in this API response.</div>') +
      '</article>';
    }).join('');
  }

  function reproductionRows(rows) {
    if (!rows.length) return '<div class="empty"><h3>No controlled reproduction record</h3><p class="muted">No public experiment protocol is configured for this view. This is not evidence that a paper failed reproduction.</p></div>';
    return '<div style="overflow-x:auto"><table class="repro-table"><thead><tr><th>Paper / claim</th><th>Protocol</th><th>Coding model</th><th>Outcome</th><th>Claimed</th><th>Recomputed</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var report = r.id ? '#/reproduction/' + encodeURIComponent(r.id) : '';
        return '<tr><td><strong>' +
          (report ? '<a href="' + report + '">' + esc(r.title) + '</a>' : esc(r.title)) +
          '</strong><div class="row-meta">' + esc(r.metric) + '</div></td><td>' + esc(r.track.replace(/_/g,' ')) + '</td><td>' + esc(r.model) + '</td><td>' + statusBadge(r.outcome) + '</td><td class="mono">' + esc(r.claimed == null ? '—' : r.claimed) + '</td><td class="mono">' + esc(r.reproduced == null ? '—' : r.reproduced) + '</td></tr>';
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
      '<section class="page"><div class="container"><div class="detail-body"><div>' +
        '<section class="card panel"><div class="panel-head"><div><div class="eyebrow">Metadata-derived ML task</div><h2 style="margin-top:10px">' + esc(text(d.taskProfile && d.taskProfile.primary_task_name, 'What this data supports')) + '</h2></div>' + statusBadge(d.taskProfile ? 'suggested' : d.downloadStatus) + '</div>' +
          '<p class="definition">' + esc(d.taskDefinition || 'No reviewed task definition is published yet. The dataset remains discoverable, but no target or task view should be inferred from column order.') + '</p>' +
          metadataTaskRows(x) +
          '<div class="tag-row">' + [d.task,d.domain,d.origin].concat(d.tags.slice(0,4)).filter(Boolean).map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('') + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Tasks and immutable releases</h2><span class="id">70 / 15 / 15 · seed 42</span></div>' + taskReleaseRows(x) + '</section>' +
        '<section class="card panel"><div class="panel-head"><h2>Dataset schema</h2><span class="id">' + esc(number(d.schema && Array.isArray(d.schema.fields) ? d.schema.fields.length : 0)) + ' documented fields</span></div>' + schemaRows(x) + '</section>' +
        '<section class="card panel"><div class="panel-head"><h2>Source provenance</h2><span class="id">' + esc(d.sourceCount || x.sources.length) + ' records</span></div><div class="source-list">' + sourceRows(x) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>File inventory</h2><span class="id">' + esc(number(d.fileCount || x.files.length)) + ' files · ' + esc(bytes(d.totalBytes)) + '</span></div><div class="file-list">' + fileRows(x) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Papers linked by dataset-use evidence</h2><span class="id">Machine checked</span></div><div class="paper-list">' + paperRows(x.papers) + '</div></section>' +
        '<section class="card panel"><div class="panel-head"><h2>Reproduction reports</h2><span class="id">Attributable outcomes</span></div><div class="repro-list">' + reproductionRows(x.reproductions) + '</div></section>' +
      '</div><aside>' +
        '<section class="card panel"><h3>Record facts</h3><dl class="kv">' +
          '<dt>Canonical ID</dt><dd class="mono">' + esc(d.id) + '</dd>' +
          '<dt>Version</dt><dd>' + esc(d.version) + '</dd>' +
          '<dt>License</dt><dd>' + esc(d.license) + '</dd>' +
          '<dt>Access</dt><dd>' + esc(d.access) + '</dd>' +
          '<dt>Origin</dt><dd>' + esc(d.origin) + '</dd>' +
          '<dt>Publisher</dt><dd>' + esc(d.publisher) + '</dd>' +
          '<dt>Publication review</dt><dd>' + esc(publicationReviewFact(d.review)) + '</dd>' +
          '<dt>Review policy</dt><dd class="mono">' + esc(reviewPolicyFact(d.review)) + '</dd>' +
          '<dt>Human audit</dt><dd>' + esc(humanAuditFact(d.review)) + '</dd>' +
          '<dt>Last verified</dt><dd>' + esc(date(d.lastVerified)) + '</dd>' +
          '<dt>DOI</dt><dd class="mono">' + esc(d.doi || 'Not recorded') + '</dd>' +
        '</dl></section>' +
        '<section class="card panel"><h3>Standard release policy</h3><p class="muted" style="line-height:1.65;font-size:13px">The platform split is 70/15/15 with seed 42. Temporal, group, route, site, user, or spatial separation takes precedence over row stratification. No release is implied until a reviewed task adapter exists.</p><a class="btn btn-link" href="#/methodology">Read methodology →</a></section>' +
      '</aside></div></div></section></main>';
  }

  function papersPage() {
    var coverageCounts = (
      state.coverage && state.coverage.summary &&
      (state.coverage.summary.counts || state.coverage.summary)
    ) || {};
    var candidateMessage =
      number(coverageCounts.cataloged_papers) + ' paper records and ' +
      number(coverageCounts.paper_candidates) +
      ' dataset-use candidates are cataloged; none has passed exact-use confirmation yet.';
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><h1 class="tml-page-title">Papers</h1><p class="tml-page-intro">Papers connected to datasets by machine-checked usage evidence, not citation alone.</p></div><p class="section-copy">Every link includes an inspectable passage and paper-text hash. These are evidence-linked records, not a claim that every link has been manually verified. Reproduction requires open-access full text or a lawful user-supplied copy.</p></div>' +
      (state.loading ? loading('Loading paper metadata…') : state.error ? errorBox() : state.papers.length ? '<div class="paper-list">' + paperRows(state.papers) + '</div>' : '<div class="empty"><h3>No evidence-linked paper use yet</h3><p class="muted">' + esc(candidateMessage) + '</p></div>') +
    '</div></main>';
  }

  function paperDetailPage() {
    if (state.loading) return '<main id="main" class="page"><div class="container">' + loading('Loading paper-use evidence…') + '</div></main>';
    if (state.error || !state.paperDetail) return '<main id="main" class="page"><div class="container">' + errorBox() + '</div></main>';
    var raw = state.paperDetail;
    var paper = normalizePaper(raw);
    var usages = Array.isArray(raw.dataset_usage) ? raw.dataset_usage :
      (Array.isArray(raw.datasets) ? raw.datasets : []);
    var versions = Array.isArray(raw.versions) ? raw.versions : [];
    return '<main id="main"><section class="detail-hero"><div class="container">' +
      '<div class="breadcrumbs"><a href="#/papers">Papers</a><span>/</span><span>' + esc(paper.id) + '</span></div>' +
      '<div class="detail-title"><div><div class="eyebrow">Dataset-use evidence</div><h1>' + esc(paper.title) + '</h1><p>Relationships appear here after a machine check finds an exact passage linking this paper version to training or evaluation on a dataset version. The passage remains visible for audit and correction.</p></div>' +
      '<div class="detail-actions">' + externalButton(paper.url, 'Open lawful source') + '</div></div></div></section>' +
      '<section class="page"><div class="container"><div class="detail-body"><div>' +
      '<section class="card panel"><div class="panel-head"><h2>Evidence-linked dataset use</h2><span class="id">' + esc(number(usages.length)) + ' relationships</span></div>' +
      (usages.length ? usages.map(function (usage) {
        var slug = usage.dataset_slug || usage.dataset;
        return '<article class="paper-row"><div class="card-kicker">' + statusBadge('evidence linked') +
          '<span class="id">' + esc(text(usage.dataset_version_id, 'version not listed')) + '</span></div>' +
          '<h3 style="margin:12px 0 8px"><a href="#/dataset/' + encodeURIComponent(slug) + '">' +
          esc(text(usage.dataset_name, slug)) + '</a></h3>' +
          '<div class="evidence"><strong>Exact usage evidence</strong><br>' +
          esc(evidenceText(usage.evidence) || 'No public evidence span is available.') + '</div></article>';
      }).join('') : '<div class="empty"><h3>No public evidence-linked relationship</h3><p class="muted">Metadata alone does not establish dataset use.</p></div>') +
      '</section>' +
      (paper.abstract ? '<section class="card panel"><h2>Abstract</h2><p class="muted" style="line-height:1.7">' + esc(paper.abstract) + '</p></section>' : '') +
      '</div><aside><section class="card panel"><h3>Paper facts</h3><dl class="kv">' +
      '<dt>Paper ID</dt><dd class="mono">' + esc(paper.id) + '</dd>' +
      '<dt>Authors</dt><dd>' + esc(paper.authors) + '</dd>' +
      '<dt>Venue</dt><dd>' + esc(paper.venue) + '</dd>' +
      '<dt>Publication date</dt><dd>' + esc(date(paper.publicationDate)) + '</dd>' +
      '<dt>Year</dt><dd>' + esc(paper.year) + '</dd>' +
      '<dt>Access</dt><dd>' + esc(paper.status) + '</dd>' +
      '<dt>DOI</dt><dd class="mono">' + esc(text(raw.doi, 'Not recorded')) + '</dd>' +
      '<dt>arXiv</dt><dd class="mono">' + esc(text(raw.arxiv_id, 'Not recorded')) + '</dd>' +
      '<dt>Text versions</dt><dd>' + esc(number(versions.length)) + '</dd>' +
      '</dl></section></aside></div></div></section></main>';
  }

  function reproductionsPage() {
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><h1 class="tml-page-title">Controlled studies</h1><p class="tml-page-intro">Claim-specific reproduction attempts with attributable outcomes.</p></div><p class="section-copy">Paper-only and artifact-assisted tracks stay separate. Each report records what ran, what information was available, and whether the result can be compared with the paper.</p></div>' +
      '<div class="evidence" style="margin-bottom:20px"><strong>How to read this page:</strong> an unavailable study is not a failed reproduction. Missing data, unsupported tasks, runtime faults, and under-specified methods remain distinct outcomes.</div>' +
      (state.loading ? loading('Loading reproduction records…') : state.error ? errorBox() : reproductionRows(state.reproductions)) +
    '</div></main>';
  }

  function reproductionDetailPage() {
    if (state.loading) return '<main id="main" class="page"><div class="container">' + loading('Loading immutable reproduction report…') + '</div></main>';
    if (state.error || !state.reproductionDetail) return '<main id="main" class="page"><div class="container">' + errorBox() + '</div></main>';
    var report = state.reproductionDetail;
    var claim = report.claim || {};
    var dataset = report.dataset || {};
    var paper = report.paper || {};
    var task = report.task || {};
    var methodFacts = Array.isArray(report.method_facts) ? report.method_facts : [];
    var score = report.score_summary || {};
    var attempts = Array.isArray(report.attempts) ? report.attempts : [];
    var controls = Array.isArray(report.controls) ? report.controls : [];
    var conditions = claim.conditions && typeof claim.conditions === 'object'
      ? JSON.stringify(claim.conditions, null, 2) : text(claim.conditions, 'Not recorded');
    var cohort = report.cohort_manifest && typeof report.cohort_manifest === 'object'
      ? JSON.stringify(report.cohort_manifest, null, 2) : text(report.cohort_manifest, 'Not recorded');
    var runRows = attempts.map(function (attempt) {
      var runs = Array.isArray(attempt.runs) ? attempt.runs : [];
      return '<section class="card panel"><div class="panel-head"><h3>Implementation ' +
        esc(attempt.implementation_index) + '</h3>' + statusBadge(attempt.status) + '</div>' +
        '<div class="row-meta" style="margin-bottom:10px">Repair cycles: ' + esc(number(attempt.repair_count)) + '</div>' +
        (runs.length ? '<div style="overflow-x:auto"><table class="repro-table"><thead><tr><th>Seed</th><th>Outcome</th><th>Metric</th><th>Server scored</th><th>Bundle</th></tr></thead><tbody>' +
          runs.map(function (run) {
            return '<tr><td class="mono">' + esc(run.training_seed) + '</td><td>' + statusBadge(run.outcome || run.status) +
              '</td><td class="mono">' + esc(run.metric_value == null ? '—' : run.metric_value) +
              '</td><td>' + esc(run.server_verified ? 'yes' : 'no') +
              '</td><td class="mono">' + esc(text(run.bundle_sha256, '—')) + '</td></tr>';
          }).join('') + '</tbody></table></div>' :
          '<div class="empty"><h3>No executions recorded</h3><p class="muted">Scheduling an experiment is not counted as an execution.</p></div>') +
        '</section>';
    }).join('');
    return '<main id="main"><section class="detail-hero"><div class="container">' +
      '<div class="breadcrumbs"><a href="#/reproductions">Reproductions</a><span>/</span><span>' + esc(report.id) + '</span></div>' +
      '<div class="detail-title"><div><div class="eyebrow">Controlled reproduction report</div><h1>' +
      esc(text(paper.title || report.paper_title || claim.title, 'Experimental claim')) + '</h1><p>' +
      esc(text(dataset.name || report.dataset_name, 'Dataset, paper, task, protocol, model, implementation, and seed remain distinct execution dimensions.')) +
      '</p></div><div class="detail-actions">' + statusBadge(report.outcome || report.status) + '</div></div></div></section>' +
      '<section class="page"><div class="container"><div class="detail-body"><div>' +
      '<section class="card panel"><div class="panel-head"><h2>Claim and conditions</h2><span class="id">' +
      esc(text(claim.metric_name, 'metric not recorded')) + '</span></div>' +
      '<dl class="kv"><dt>Reported value</dt><dd class="mono">' + esc(claim.reported_value == null ? 'Not recorded' : claim.reported_value) +
      '</dd><dt>Direction</dt><dd>' + esc(claim.higher_is_better === true ? 'Higher is better' : claim.higher_is_better === false ? 'Lower is better' : 'Not recorded') +
      '</dd><dt>Evidence</dt><dd>' + esc(evidenceText(claim.evidence) || 'Not recorded') + '</dd></dl>' +
      '<div class="loading-example"><div class="row-meta">Claim conditions</div><pre><code>' + esc(conditions) + '</code></pre></div></section>' +
      '<section class="card panel"><div class="panel-head"><h2>Method facts and missing-information ledger</h2><span class="id">' +
      esc(number(methodFacts.length)) + ' facts</span></div>' +
      (methodFacts.length ? methodFacts.map(function (fact) {
        var value = fact.value && typeof fact.value === 'object'
          ? JSON.stringify(fact.value) : text(fact.value, 'Not recorded');
        return '<div class="source-row"><div><div class="row-title">' +
          esc(text(fact.category, 'method fact').replace(/_/g, ' ')) +
          '</div><div class="row-meta">' + esc(value) +
          (evidenceText(fact.evidence) ? ' · ' + esc(evidenceText(fact.evidence)) : '') +
          '</div></div>' + statusBadge(fact.status || 'missing') + '</div>';
      }).join('') : '<div class="empty"><h3>No reviewed method facts</h3><p class="muted">A run without an explicit fact ledger cannot support a claim about paper underspecification.</p></div>') +
      '</section>' +
      '<section class="card panel"><div class="panel-head"><h2>Repeated executions</h2><span class="id">Seeds 42 · 123 · 2026</span></div>' +
      (runRows || '<div class="empty"><h3>No attempt records</h3><p class="muted">A configured cohort is not presented as a completed result.</p></div>') +
      '</section></div><aside>' +
      '<section class="card panel"><h3>Protocol facts</h3><dl class="kv">' +
      '<dt>Dataset</dt><dd>' + (dataset.slug ? '<a href="#/dataset/' + encodeURIComponent(dataset.slug) + '">' + esc(text(dataset.name, dataset.slug)) + '</a>' : 'Not recorded') + '</dd>' +
      '<dt>Paper</dt><dd>' + (paper.id ? '<a href="#/paper/' + encodeURIComponent(paper.id) + '">' + esc(text(paper.title, paper.id)) + '</a>' : 'Not recorded') + '</dd>' +
      '<dt>Task</dt><dd>' + esc(text(task.task_family || task.task_key, 'Not recorded')) + '</dd>' +
      '<dt>Track</dt><dd>' + esc(text(report.protocol_track, 'Not recorded').replace(/_/g, ' ')) + '</dd>' +
      '<dt>Coding model</dt><dd class="mono">' + esc(text(report.coding_model, 'Not recorded')) + '</dd>' +
      '<dt>Status</dt><dd>' + esc(text(report.status, 'Not recorded')) + '</dd>' +
      '<dt>Outcome</dt><dd>' + esc(text(report.outcome, 'Not recorded').replace(/_/g, ' ')) + '</dd>' +
      '<dt>Controls</dt><dd>' + esc(number(controls.length)) + '</dd>' +
      '<dt>Scored runs</dt><dd>' + esc(number(score.verified_run_count)) + ' / ' + esc(number(score.run_count)) + '</dd>' +
      '<dt>Mean</dt><dd class="mono">' + esc(score.mean == null ? '—' : score.mean) + '</dd>' +
      '<dt>Range</dt><dd class="mono">' + esc(score.minimum == null ? '—' : score.minimum + ' – ' + score.maximum) + '</dd>' +
      '<dt>Variance</dt><dd class="mono">' + esc(score.population_variance == null ? '—' : score.population_variance) + '</dd></dl></section>' +
      '<section class="card panel"><h3>Control outcomes</h3>' +
      (controls.length ? controls.map(function (control) {
        return '<div class="source-row"><div><div class="row-title">' + esc(text(control.control_type, 'control').replace(/_/g, ' ')) +
          '</div><div class="row-meta mono">' + esc(text(control.bundle_sha256, 'no bundle')) + '</div></div>' +
          statusBadge(control.outcome || control.status) + '</div>';
      }).join('') : '<p class="muted">No public control result is recorded.</p>') +
      '</section><section class="card panel"><h3>Frozen cohort manifest</h3><div class="loading-example"><pre><code>' +
      esc(cohort) + '</code></pre></div></section></aside></div></div></section></main>';
  }

  function methodologyPage() {
    return '<main id="main" class="page"><div class="container prose"><h1 class="tml-page-title">Methodology</h1><p class="tml-page-intro">One transparent evidence chain, with separate source, release, paper, and reproduction records.</p>' +
      '<p>OpenWirelessML separates discovery, publication, and research claims. A source record can be cataloged without being downloadable. A dataset can be mirrored without having a safe ML task adapter. A paper can be linked without being reproducible. Each state stays visible.</p>' +
      '<div class="steps">' +
        '<article class="step"><div><h3>Source and review</h3><p>Harvest machine-readable metadata, preserve every provider version, resolve identity using DOI and explicit relations, then apply deterministic source checks and AI semantic review. Legal and sensitivity gates separately control payload acquisition and release. Human audits run retroactively and can correct or withdraw a record.</p></div></article>' +
        '<article class="step"><div><h3>Immutable release</h3><p>Mirror only when redistribution is allowed. Hash the raw snapshot, assign stable sample IDs, publish a documented task adapter, and preserve the provider split alongside the OpenWirelessML view.</p></div></article>' +
        '<article class="step"><div><h3>Leakage-aware split</h3><p>Use 70/15/15 and seed 42. Time, subscriber, device, cell, site, route, session, or spatial dependencies stay together. Stratified rows are only a proven-safe fallback.</p></div></article>' +
        '<article class="step"><div><h3>Paper-use evidence</h3><p>Find papers from direct identifiers, aliases, and citation graphs. Store the exact passage showing training or evaluation use; a citation alone is not accepted.</p></div></article>' +
        '<article class="step"><div><h3>Controlled reproduction</h3><p>Run paper-only and artifact-assisted tracks independently. Keep missing facts and assumptions explicit, isolate generated code, hide test labels from the training process, and recompute metrics on the server.</p></div></article>' +
      '</div>' +
      '<h2>What the platform does not claim</h2><p>OpenWirelessML does not infer that every execution gap is caused by a paper. It first rules out platform faults, unavailable inputs, unsupported representations, invalid scoring, and generated-code failures. Only comparable, server-scored, faithful attempts support conclusions about reporting completeness.</p>' +
      '<h2>Active scope</h2><p>The public catalog focuses on static datasets used for conventional telecom ML. LLM benchmarks, LLM training corpora, software, generators, model artifacts, papers, and supplementary figures remain available for audit but do not appear as active datasets.</p>' +
    '</div></main>';
  }

  function coveragePage() {
    var c = state.coverage || { summary:{}, sources:[] };
    var summary = c.summary || {};
    var s = summary.counts || summary;
    var sync = summary.sync || {};
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><h1 class="tml-page-title">Sources</h1><p class="tml-page-intro">Coverage is bounded, versioned, and inspectable.</p></div><p class="section-copy">“All” means the maintained telecom query registry, trusted indexes, and curated gold inventory—not every record on the internet. Source failures and missing credentials remain visible coverage limits.</p></div>' +
      (state.loading ? loading('Loading source coverage…') : state.error ? errorBox() :
        '<div class="grid coverage-grid">' +
          '<article class="card coverage-card"><strong>' + esc(number(s.discovered != null ? s.discovered : s.datasets)) + '</strong><h3>Discovered candidates</h3><p>Raw candidates before relevance, usability, license, and publication review.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.approved_static_ml != null ? s.approved_static_ml : (s.approved_static != null ? s.approved_static : state.datasets.length))) + '</strong><h3>Active ML records</h3><p>Static trainable records exposed after deterministic checks and AI metadata review. Human audits run retroactively and can correct or withdraw a record.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.published)) + '</strong><h3>Published releases</h3><p>Immutable task releases with public manifests, checksums, and reviewed split assignments.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.paper_candidates)) + '</strong><h3>Paper-use candidates</h3><p>Source-linked papers queued for exact evidence confirmation across ' + esc(number(s.paper_candidate_datasets)) + ' dataset concepts.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.paper_linked != null ? s.paper_linked : s.confirmed_paper_links)) + '</strong><h3>Evidence-linked paper relationships</h3><p>Machine-checked relationships with an exact passage and paper-text hash. They remain auditable and correctable.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(s.acquired)) + '</strong><h3>Acquired versions</h3><p>Reviewed dataset versions whose bytes passed access, quota, archive, and content-safety checks.</p></article>' +
          '<article class="card coverage-card"><strong>' + esc(number(sync.terminal)) + ' / ' + esc(number(sync.total)) + '</strong><h3>Terminal source scans</h3><p>Complete or explicitly waived registry queries. Registry: ' + esc(text(summary.registry_version, 'not reported')) + '.</p></article>' +
        '</div>' +
        '<div class="section-head" style="margin-top:46px"><div><div class="eyebrow">Source registry</div><h2>Synchronization state</h2></div><p class="section-copy">Operational errors are summarized, not exposed with internal URLs or credentials.</p></div>' +
        '<div class="grid coverage-grid">' + c.sources.map(function (src) {
          return '<article class="card coverage-card"><div class="card-kicker"><span class="id">' + esc(src.authenticated ? 'authenticated' : 'anonymous') + '</span>' + statusBadge(src.status) + '</div><h3>' + esc(src.provider) + '</h3><p>' + esc(number(src.seen)) + ' records seen · ' + esc(number(src.kept)) + ' retained<br>Last complete sync: ' + esc(date(src.lastSync)) + '</p></article>';
        }).join('') + '</div>') +
    '</div></main>';
  }

  function contributePage() {
    return '<main id="main" class="page"><div class="container prose"><h1 class="tml-page-title">Catalog contributions</h1><p class="tml-page-intro">Improve the public record through GitHub issues and pull requests.</p><p>There are no platform accounts, prediction uploads, hidden-label scores, or private dispute forms.</p>' +
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
    if (state.route.name === 'paper') return paperDetailPage();
    if (state.route.name === 'reproductions') return reproductionsPage();
    if (state.route.name === 'reproduction') return reproductionDetailPage();
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
    var labels = {
      datasets:'Datasets',
      dataset:state.detail ? state.detail.dataset.name : 'Dataset',
      papers:'Papers',
      paper:state.paperDetail ? state.paperDetail.title : 'Paper',
      reproductions:'Reproductions',
      reproduction:'Reproduction report',
      methodology:'Methodology',
      coverage:'Coverage',
      contribute:'Contribute'
    };
    return (labels[state.route.name] ? labels[state.route.name] + ' — ' : '') + 'OpenWirelessML';
  }

  function parseRoute() {
    var raw = (window.location.hash || '#/home').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    var allowed = ['home','datasets','papers','reproductions','methodology','coverage','contribute'];
    if (parts[0] === 'dataset' && parts[1]) return { name:'dataset', slug:decodeURIComponent(parts.slice(1).join('/')) };
    if (parts[0] === 'paper' && parts[1]) return { name:'paper', id:decodeURIComponent(parts.slice(1).join('/')) };
    if (parts[0] === 'reproduction' && parts[1]) return { name:'reproduction', id:decodeURIComponent(parts.slice(1).join('/')) };
    return { name:allowed.indexOf(parts[0]) >= 0 ? parts[0] : 'home' };
  }

  function syncRoute() {
    state.route = parseRoute();
    state.navOpen = false;
    state.error = '';
    window.scrollTo(0, 0);
    if (
      LOOPBACK_PERMISSION_MODE &&
      state.localConnection !== 'connected' &&
      routeNeedsBackend(state.route.name)
    ) {
      state.loading = false;
      state.error = 'Local backend permission is required.';
      render();
      return;
    }
    if (state.route.name === 'home' || state.route.name === 'datasets') loadCore();
    else if (state.route.name === 'dataset') loadDetail(state.route.slug);
    else if (state.route.name === 'papers') loadPapers();
    else if (state.route.name === 'paper') loadPaperDetail(state.route.id);
    else if (state.route.name === 'reproductions') loadReproductions();
    else if (state.route.name === 'reproduction') loadReproductionDetail(state.route.id);
    else if (state.route.name === 'coverage') loadCoverage();
    else render();
  }

  function connectLocalBackend() {
    state.localConnection = 'connecting';
    state.loading = true;
    state.error = '';
    render();
    api('/health/ready').then(function () {
      state.localConnection = 'connected';
      state.loading = false;
      state.datasetsLoaded = false;
      syncRoute();
    }).catch(function (err) {
      return queryLoopbackPermission().then(function (permission) {
        state.localConnection = permission === 'denied' ? 'denied' : 'failed';
        state.loading = false;
        state.error = permission === 'denied'
          ? 'Chrome denied local network access.'
          : (err.message || 'Could not reach the backend at 127.0.0.1:8080.');
        render();
      });
    });
  }

  function retry() {
    state.error = '';
    if (state.route.name === 'dataset') loadDetail(state.route.slug);
    else if (state.route.name === 'papers') loadPapers();
    else if (state.route.name === 'paper') loadPaperDetail(state.route.id);
    else if (state.route.name === 'reproductions') loadReproductions();
    else if (state.route.name === 'reproduction') loadReproductionDetail(state.route.id);
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
    else if (action === 'connect-local') connectLocalBackend();
    else if (action === 'clear-filters') {
      state.filters = {
        query:'', task:'all', origin:'all', access:'all', source:'all',
        license:'all', publication:'all', papers:'all', reproduction:'all'
      };
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

  var skipLink = document.querySelector('[data-skip-link]');
  if (skipLink) {
    skipLink.addEventListener('click', function (event) {
      event.preventDefault();
      var main = document.getElementById('main');
      if (!main) return;
      main.setAttribute('tabindex', '-1');
      main.focus();
      main.addEventListener('blur', function () {
        main.removeAttribute('tabindex');
      }, { once:true });
    });
  }

  window.addEventListener('hashchange', syncRoute);
  if (LOOPBACK_PERMISSION_MODE) {
    queryLoopbackPermission().then(function (permission) {
      state.localConnection =
        permission === 'granted' || permission === 'allowed' ? 'connected' :
          permission === 'denied' ? 'denied' : 'prompt';
      syncRoute();
    });
  } else {
    syncRoute();
  }
}());

(function () {
  'use strict';

  var API_BASE = String(window.TMLB_EVALUATION_API_BASE || '/api/v1').replace(/\/+$/, '');
  var activeLoad = 0;
  var turnstileConfigPromise = null;
  var turnstileScriptPromise = null;

  // Browser transport for @vercel/blob 2.6's constrained client-token protocol.
  // The token is scoped by the server to one private pathname, size, media type,
  // and ten-minute validity window. No store credential reaches the browser.
  async function uploadPrediction({ apiBase, apiKey, turnstileToken, file, releaseId, onProgress }) {
    if (!(file instanceof File)) throw new Error('Choose a prediction CSV first.');
    const compressed = /\.csv\.gz$/i.test(file.name);
    if (!compressed && !/\.csv$/i.test(file.name)) {
      throw new Error('Predictions must be a .csv or .csv.gz file.');
    }
    if (!apiKey && !turnstileToken) throw new Error('Complete the human-verification check first.');
    const uploadId = crypto.randomUUID();
    const pathname = `evaluations/${releaseId}/${uploadId}/predictions.csv${compressed ? '.gz' : ''}`;
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const tokenResponse = await fetch(`${String(apiBase).replace(/\/+$/, '')}/evaluations/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'blob.generate-client-token',
        payload: {
          pathname,
          multipart: false,
          clientPayload: JSON.stringify({
            release_id: releaseId,
            turnstile_token: turnstileToken || ''
          })
        }
      })
    });
    if (!tokenResponse.ok) {
      throw new Error(tokenResponse.status === 401 || tokenResponse.status === 403
        ? 'Human verification was rejected or expired. Please try it again.'
        : 'The private upload could not be authorized.');
    }
    const tokenBody = await tokenResponse.json();
    const clientToken = String(tokenBody.clientToken || '');
    const evaluationToken = String(tokenBody.evaluationToken || apiKey || '');
    const tokenParts = clientToken.split('_');
    const storeId = tokenParts[3] || '';
    if (!clientToken.startsWith('vercel_blob_client_') || !storeId) {
      throw new Error('The upload service returned an invalid constrained token.');
    }

    const result = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`);
      request.responseType = 'json';
      request.setRequestHeader('authorization', `Bearer ${clientToken}`);
      request.setRequestHeader('x-api-blob-request-id', `${storeId}:${Date.now()}:${crypto.randomUUID()}`);
      request.setRequestHeader('x-vercel-blob-store-id', storeId);
      request.setRequestHeader('x-api-blob-request-attempt', '0');
      request.setRequestHeader('x-api-version', '12');
      request.setRequestHeader('x-content-length', String(file.size));
      request.setRequestHeader('x-vercel-blob-access', 'private');
      request.setRequestHeader('x-content-type', compressed ? 'application/gzip' : 'text/csv');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === 'function') {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: event.total ? (event.loaded / event.total) * 100 : 0
          });
        }
      };
      request.onerror = () => reject(new Error('The private prediction upload lost its network connection.'));
      request.onabort = () => reject(new Error('The private prediction upload was cancelled.'));
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(`The private prediction upload failed (${request.status}).`));
          return;
        }
        const body = request.response || {};
        if (body.pathname !== pathname) {
          reject(new Error('The upload service returned a mismatched private pathname.'));
          return;
        }
        resolve(body);
      };
      request.send(file);
    });
    return { blob: result, evaluationToken };
  }

  var style = document.createElement('style');
  style.textContent = [
    '.tml-release-download-panel{position:relative;overflow:hidden}',
    '.tml-release-download-panel:before{content:\x22\x22;position:absolute;left:0;top:0;bottom:0;width:3px;background:#2563eb}',
    '.tml-release-stack{display:grid;gap:16px}',
    '.tml-release-unit{padding:18px;border:1px solid #dfe4ef;border-radius:12px;background:#fbfcff}',
    '.tml-release-unit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}',
    '.tml-release-unit-head h3{margin:0;font:600 13px/1.45 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-meta{margin-top:5px;color:#858b97;font:8px/1.5 var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-release-flow{display:grid;grid-template-columns:repeat(3,1fr);margin:13px 0 16px;border:1px solid #dfe4ef;border-radius:9px;overflow:hidden;background:#fff}',
    '.tml-release-flow span{position:relative;padding:10px 9px 10px 29px;color:#5b616e;font:600 9px var(--mono);letter-spacing:.04em;text-transform:uppercase}',
    '.tml-release-flow span+span{border-left:1px solid #e9eaee}',
    '.tml-release-flow i{position:absolute;left:10px;top:9px;display:grid;width:14px;height:14px;place-items:center;border-radius:50%;background:#e8efff;color:#2563eb;font:700 8px var(--mono);font-style:normal}',
    '.tml-release-files{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '.tml-release-file{display:flex;min-width:0;flex-direction:column;padding:13px;border:1px solid #e3e5e9;border-radius:9px;background:#fff}',
    '.tml-release-file strong{font-size:13px}',
    '.tml-release-file code{margin:7px 0 11px;color:#858b97;font:8px/1.45 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-file a{margin-top:auto;padding:9px;border:1px solid #dce4f5;border-radius:7px;color:#1d4ed8;text-align:center;text-decoration:none;font-size:12px;font-weight:600}',
    '.tml-release-file a:hover{background:#f3f7ff;border-color:#b9ccf7}',
    '.tml-release-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}',
    '.tml-release-tools a{color:#2563eb;font-size:12px;font-weight:600;text-decoration:none}',
    '.tml-evaluator{margin-top:16px;padding-top:16px;border-top:1px solid #dfe4ef}',
    '.tml-evaluator-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}',
    '.tml-evaluator h4{margin:0;font-size:15px}',
    '.tml-evaluator-copy{margin:5px 0 13px;color:#646b77;font-size:12px;line-height:1.55}',
    '.tml-evaluator-grid{display:grid;grid-template-columns:minmax(220px,1fr) 300px auto;gap:12px;align-items:end}',
    '.tml-evaluator-field{display:grid;gap:5px}',
    '.tml-evaluator-field span{color:#6b7280;font:8px var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-evaluator-field input{height:42px;padding:9px 11px;font-size:13px}',
    '.tml-turnstile-field{display:grid;gap:5px}',
    '.tml-turnstile-field>span{color:#6b7280;font:8px var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-turnstile{min-height:65px;display:flex;align-items:center;justify-content:flex-start}',
    '.tml-evaluator-submit{height:42px;padding:0 15px;border:1px solid #2563eb;border-radius:8px;background:#2563eb;color:#fff;font-weight:650;cursor:pointer}',
    '.tml-evaluator-submit[disabled]{cursor:wait;opacity:.58}',
    '.tml-evaluator-progress{display:none;width:100%;height:7px;margin-top:12px;accent-color:#2563eb}',
    '.tml-evaluator-status{min-height:19px;margin-top:10px;color:#5b616e;font-size:12px;line-height:1.55}',
    '.tml-evaluator-status.error{padding:9px 11px;border:1px solid #fecaca;border-radius:8px;background:#fff7f7;color:#b91c1c;text-align:left}',
    '.tml-score-result{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin-top:12px;padding:14px;border:1px solid #b9decf;border-radius:9px;background:#f2fbf7}',
    '.tml-score-value{color:#116647;font:700 24px var(--mono)}',
    '.tml-score-detail{align-self:center;color:#416556;font-size:12px;line-height:1.5}',
    '.tml-score-hashes{grid-column:1/-1;color:#668075;font:8px/1.6 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-empty{padding:17px;border:1px dashed #d9dce2;border-radius:9px;color:#646b77;font-size:13px}',
    '@media(max-width:760px){.tml-release-files{grid-template-columns:1fr}.tml-evaluator-grid{grid-template-columns:1fr}.tml-evaluator-submit{width:100%}.tml-release-flow span{padding-left:25px;font-size:8px}}'
  ].join('');
  document.head.appendChild(style);

  function element(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  function bytes(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return 'size unavailable';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = amount ? Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1) : 0;
    return (amount / Math.pow(1024, index)).toFixed(index > 1 ? 1 : 0) + ' ' + units[index];
  }

  function apiUrl(path) {
    var value = String(path || '');
    if (/^https:\/\//i.test(value)) return value;
    if (value.indexOf('/api/v1') === 0) value = value.slice('/api/v1'.length);
    if (value.charAt(0) !== '/') value = '/' + value;
    return API_BASE + value;
  }

  async function jsonRequest(path, options) {
    var response = await fetch(apiUrl(path), options || {});
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(body.statusMessage || body.message || body.detail || ('Request failed (' + response.status + ')'));
    }
    return body;
  }

  function getTurnstileConfig() {
    if (!turnstileConfigPromise) {
      turnstileConfigPromise = jsonRequest('/evaluations/config', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
    }
    return turnstileConfigPromise;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileScriptPromise) {
      turnstileScriptPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = function () {
          window.turnstile ? resolve(window.turnstile) : reject(new Error('Human verification did not initialize.'));
        };
        script.onerror = function () { reject(new Error('Human verification could not be loaded.')); };
        document.head.appendChild(script);
      });
    }
    return turnstileScriptPromise;
  }

  function canonicalId(panel) {
    var terms = Array.from(document.querySelectorAll('.kv dt'));
    var term = terms.find(function (item) { return item.textContent.trim() === 'Canonical ID'; });
    var value = term && term.nextElementSibling ? term.nextElementSibling.textContent.trim() : '';
    if (value) return value;
    var match = location.hash.match(/^#\/dataset\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function roleLabel(role) {
    return role === 'train' ? 'Train split' :
      role === 'validation' ? 'Validation split' :
      role === 'test_features' ? 'Test CSV / features' : role;
  }

  function downloadCard(release, file) {
    var card = element('div', 'tml-release-file');
    card.appendChild(element('strong', '', roleLabel(file.role)));
    var detail = element('code', '', bytes(file.byte_size) + ' · sha256 ' + String(file.sha256 || '').slice(0, 12) + '…');
    detail.title = String(file.sha256 || '');
    card.appendChild(detail);
    var link = element('a', '', 'Download ' + (file.role === 'test_features' ? 'test' : file.role));
    link.href = apiUrl(file.download_endpoint);
    link.setAttribute('aria-label', 'Download ' + roleLabel(file.role) + ', ' + bytes(file.byte_size));
    card.appendChild(link);
    return card;
  }

  function setEvaluatorStatus(status, message, isError) {
    status.className = 'tml-evaluator-status' + (isError ? ' error' : '');
    status.textContent = message;
  }

  function renderScore(status, result) {
    status.className = 'tml-evaluator-status';
    status.textContent = '';
    if (!result || result.status !== 'completed' || !result.metric) {
      var error = result && result.error ? result.error : {};
      setEvaluatorStatus(status, error.message || 'The evaluator did not return a score.', true);
      return;
    }
    var card = element('div', 'tml-score-result');
    var value = Number(result.metric.value);
    card.appendChild(element('div', 'tml-score-value', value.toFixed(6)));
    card.appendChild(element('div', 'tml-score-detail',
      (value * 100).toFixed(2) + '% accuracy · ' +
      Number(result.metric.correct).toLocaleString() + ' / ' +
      Number(result.metric.sample_count).toLocaleString() + ' samples'));
    card.appendChild(element('div', 'tml-score-hashes',
      'server verified · labels ' + String(result.labels_sha256 || '').slice(0, 16) + '… · predictions ' +
      String(result.predictions_sha256 || '').slice(0, 16) + '… · private result only'));
    status.appendChild(card);
  }

  async function pollEvaluation(endpoint, credential, status) {
    var deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      var payload = await jsonRequest(endpoint, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + credential },
        cache: 'no-store'
      });
      if (payload.status === 'completed') return payload.result;
      if (payload.status === 'failed') return { status: 'failed', error: payload.error };
      setEvaluatorStatus(status, 'Hidden-label verification is running on Vercel…', false);
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    }
    throw new Error('Evaluation is still running after 30 minutes. Keep the evaluation ID and check the API again.');
  }

  function evaluator(release) {
    var wrap = element('div', 'tml-evaluator');
    var head = element('div', 'tml-evaluator-head');
    head.appendChild(element('h4', '', 'Verify predictions against hidden labels'));
    var badge = element('span', 'tml-status verified', release.evaluation.available ? 'Server scored' : 'Unavailable');
    head.appendChild(badge);
    wrap.appendChild(head);
    if (!release.evaluation.available) {
      wrap.appendChild(element('p', 'tml-evaluator-copy', 'This unsupervised release has no approved hidden-label metric. Downloads remain available.'));
      return wrap;
    }
    wrap.appendChild(element('p', 'tml-evaluator-copy',
      'Upload CSV or CSV.GZ with exactly sample_id,prediction in test-file order. Labels stay private; the uploaded file is deleted after scoring.'));
    var form = element('form', 'tml-evaluator-grid');
    var fileField = element('label', 'tml-evaluator-field');
    fileField.appendChild(element('span', '', 'Prediction file'));
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'predictions';
    fileInput.accept = '.csv,.csv.gz,text/csv,application/gzip';
    fileInput.required = true;
    fileField.appendChild(fileInput);
    form.appendChild(fileField);
    var challengeField = element('div', 'tml-turnstile-field');
    challengeField.appendChild(element('span', '', 'Human verification'));
    var challenge = element('div', 'tml-turnstile');
    challengeField.appendChild(challenge);
    form.appendChild(challengeField);
    var submit = element('button', 'tml-evaluator-submit', 'Score predictions');
    submit.type = 'submit';
    submit.disabled = true;
    form.appendChild(submit);
    wrap.appendChild(form);

    var progress = document.createElement('progress');
    progress.className = 'tml-evaluator-progress';
    progress.max = 100;
    progress.value = 0;
    wrap.appendChild(progress);
    var status = element('div', 'tml-evaluator-status', 'Nothing uploaded yet. Scores are private and are not leaderboard publication.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    wrap.appendChild(status);

    var turnstileApi = null;
    var turnstileWidgetId = null;
    var turnstileToken = '';
    Promise.all([getTurnstileConfig(), loadTurnstile()]).then(function (values) {
      var config = values[0];
      turnstileApi = values[1];
      if (!config.enabled || !config.turnstile_site_key) {
        throw new Error('Human verification is not configured yet.');
      }
      turnstileWidgetId = turnstileApi.render(challenge, {
        sitekey: config.turnstile_site_key,
        action: config.action || 'evaluation_upload',
        theme: 'light',
        callback: function (token) {
          turnstileToken = String(token || '');
          submit.disabled = !turnstileToken;
          setEvaluatorStatus(status, 'Verified. Choose a prediction file and request a private score.', false);
        },
        'expired-callback': function () {
          turnstileToken = '';
          submit.disabled = true;
          setEvaluatorStatus(status, 'Human verification expired. Please complete it again.', true);
        },
        'error-callback': function () {
          turnstileToken = '';
          submit.disabled = true;
          setEvaluatorStatus(status, 'Human verification failed to load. Please retry.', true);
        }
      });
    }).catch(function (error) {
      submit.disabled = true;
      setEvaluatorStatus(status, error && error.message ? error.message : 'Human verification is unavailable.', true);
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var file = fileInput.files && fileInput.files[0];
      if (!turnstileToken || !file) {
        setEvaluatorStatus(status, 'Choose a prediction file and complete human verification.', true);
        return;
      }
      if (file.size > Number(release.evaluation.maximum_upload_bytes || 0)) {
        setEvaluatorStatus(status, 'Prediction file exceeds this release’s upload limit of ' + bytes(release.evaluation.maximum_upload_bytes) + '.', true);
        return;
      }
      submit.disabled = true;
      progress.style.display = 'block';
      progress.value = 0;
      setEvaluatorStatus(status, 'Authorizing a private upload…', false);
      try {
        var upload = await uploadPrediction({
          apiBase: API_BASE,
          turnstileToken: turnstileToken,
          file: file,
          releaseId: release.id,
          onProgress: function (event) {
            progress.value = Number(event.percentage || 0);
            setEvaluatorStatus(status, 'Private upload ' + Math.floor(progress.value) + '%…', false);
          }
        });
        var blob = upload.blob;
        var evaluationToken = upload.evaluationToken;
        if (!evaluationToken) throw new Error('The upload service did not return an evaluation grant.');
        progress.value = 100;
        setEvaluatorStatus(status, 'Upload complete. Queueing hidden-label verification…', false);
        var accepted = await jsonRequest('/evaluations', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + evaluationToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            release_id: release.id,
            prediction: { pathname: blob.pathname, size: file.size }
          })
        });
        var result = await pollEvaluation(accepted.status_endpoint, evaluationToken, status);
        renderScore(status, result);
        fileInput.value = '';
      } catch (error) {
        setEvaluatorStatus(status, error && error.message ? error.message : 'Evaluation failed.', true);
      } finally {
        turnstileToken = '';
        if (turnstileApi && turnstileWidgetId !== null) turnstileApi.reset(turnstileWidgetId);
        submit.disabled = true;
        progress.style.display = 'none';
      }
    });
    return wrap;
  }

  function releaseUnit(release) {
    var unit = element('article', 'tml-release-unit');
    var head = element('div', 'tml-release-unit-head');
    var title = element('div');
    title.appendChild(element('h3', '', release.id));
    title.appendChild(element('div', 'tml-release-meta',
      release.split.counts.train.toLocaleString() + ' train · ' +
      release.split.counts.validation.toLocaleString() + ' validation · ' +
      release.split.counts.test.toLocaleString() + ' test · seed ' + release.split.seed));
    head.appendChild(title);
    head.appendChild(element('span', 'tml-status published', 'Published'));
    unit.appendChild(head);
    var flow = element('div', 'tml-release-flow');
    ['Download split', 'Predict locally', 'Verify privately'].forEach(function (label, index) {
      var step = element('span', '', label);
      step.insertBefore(element('i', '', index + 1), step.firstChild);
      flow.appendChild(step);
    });
    unit.appendChild(flow);
    var files = element('div', 'tml-release-files');
    ['train', 'validation', 'test_features'].forEach(function (role) {
      var file = release.files.find(function (candidate) { return candidate.role === role; });
      if (file) files.appendChild(downloadCard(release, file));
    });
    unit.appendChild(files);
    var tools = element('div', 'tml-release-tools');
    tools.appendChild(element('span', 'tml-release-meta', release.release_version + ' · ' + release.split.strategy + ' split'));
    var manifest = element('a', '', 'Manifest + full checksums ↗');
    manifest.href = apiUrl(release.manifest_endpoint);
    manifest.target = '_blank';
    manifest.rel = 'noopener';
    tools.appendChild(manifest);
    unit.appendChild(tools);
    unit.appendChild(evaluator(release));
    return unit;
  }

  async function addReleasePanel() {
    if (!/^#\/dataset\//.test(location.hash)) return;
    var heading = Array.from(document.querySelectorAll('h2')).find(function (node) {
      return node.textContent.trim() === 'Tasks and immutable releases';
    });
    var anchor = heading && heading.closest('section');
    if (!anchor || document.querySelector('.tml-release-download-panel')) return;
    var requestId = ++activeLoad;
    var panel = element('section', 'card panel tml-release-download-panel');
    var panelHead = element('div', 'panel-head');
    panelHead.appendChild(element('h2', '', 'Published split downloads'));
    panelHead.appendChild(element('span', 'id', 'Hidden-label scoring'));
    panel.appendChild(panelHead);
    var stack = element('div', 'tml-release-stack');
    stack.appendChild(element('div', 'tml-release-empty', 'Loading immutable release manifests…'));
    panel.appendChild(stack);
    anchor.insertAdjacentElement('afterend', panel);

    var identity = canonicalId(panel);
    var slugMatch = location.hash.match(/^#\/dataset\/(.+)$/);
    var slug = slugMatch ? decodeURIComponent(slugMatch[1]) : '';
    try {
      var payload = await jsonRequest('/releases?dataset_id=' + encodeURIComponent(identity), {
        headers: { Accept: 'application/json' }
      });
      if (!payload.items.length && slug && slug !== identity) {
        payload = await jsonRequest('/releases?dataset=' + encodeURIComponent(slug), {
          headers: { Accept: 'application/json' }
        });
      }
      if (requestId !== activeLoad || !document.contains(panel)) return;
      stack.textContent = '';
      if (!payload.items.length) {
        stack.appendChild(element('div', 'tml-release-empty',
          payload.errors && payload.errors.length
            ? 'A published manifest is temporarily unavailable. No unverified download link is shown.'
            : 'No immutable split release is mapped to this dataset version yet.'));
        return;
      }
      payload.items.forEach(function (release) { stack.appendChild(releaseUnit(release)); });
    } catch (error) {
      if (requestId !== activeLoad || !document.contains(panel)) return;
      stack.textContent = '';
      stack.appendChild(element('div', 'tml-release-empty',
        'The release service is unavailable: ' + (error && error.message ? error.message : 'unknown error')));
    }
  }

  function updateContributionCopy() {
    if (location.hash !== '#/contribute') return;
    Array.from(document.querySelectorAll('main p')).forEach(function (paragraph) {
      if (paragraph.textContent.indexOf('There are no platform accounts, prediction uploads') >= 0) {
        paragraph.textContent = 'Dataset and evidence corrections remain GitHub-based. Published supervised releases also accept authenticated prediction uploads for private server-verified scoring.';
      }
    });
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      addReleasePanel();
      updateContributionCopy();
    });
  }
  new MutationObserver(schedule).observe(document.getElementById('app'), { childList: true, subtree: true });
  window.addEventListener('hashchange', function () { activeLoad += 1; schedule(); });
  schedule();
}());
