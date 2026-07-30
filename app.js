(function () {
  'use strict';

  var state = {
    route: { name: 'home' },
    datasets: [],
    datasetsLoaded: false,
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
      var missing = new Error('No verified reproduction is published.');
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
      optional('/catalog/coverage')
    ]).then(function (values) {
      state.datasets = list(values[0]).map(normalizeDataset).filter(isPublicMl)
        .sort(function (left, right) {
          return (right.paperCount - left.paperCount) ||
            (right.fileCount - left.fileCount) ||
            left.name.localeCompare(right.name);
        });
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
      '<span style="height:7px;opacity:.65"></span>' +
      '<span style="height:11px;opacity:.82"></span>' +
      '<span style="height:15px"></span>' +
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
      '<a class="tml-brand" href="#/home">' + logo() + '<span>TeleMLEBench</span></a>' +
      '<button class="tml-nav-toggle" data-action="toggle-nav" aria-expanded="' +
        (state.navOpen ? 'true' : 'false') + '" aria-label="Toggle navigation">Menu</button>' +
      '<nav class="tml-nav ' + (state.navOpen ? 'open' : '') + '" aria-label="Main navigation">' +
        navLink('home', 'Home') +
        navLink('datasets', 'Datasets') +
        navLink('papers', 'Papers') +
        navLink('reproductions', 'Reproductions') +
        navLink('coverage', 'Sources') +
        navLink('contribute', 'Contribute') +
        navLink('methodology', 'About') +
      '</nav>' +
    '</div></header>';
  }

  function footer() {
    return '<footer class="tml-footer"><div class="tml-footer-inner">' +
      '<div>TeleMLEBench — source-first telecom ML datasets.</div>' +
      '<div>Datasets, paper evidence, and controlled reproductions.</div>' +
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
    return '<div><div class="mono tml-stat-value">' + esc(number(value)) +
      '</div><div class="tml-stat-label">' + esc(label) + '</div></div>';
  }

  function datasetCard(d) {
    var category = d.task === 'Needs task adapter' ? d.domain : d.task;
    return '<a class="tml-card tml-dataset-card" href="#/dataset/' +
      encodeURIComponent(d.slug) + '">' +
      '<div class="tml-card-top"><span class="tml-category">' +
        esc(category) + '</span>' + statusBadge(d.access) + '</div>' +
      '<h3>' + esc(d.name) + '</h3>' +
      '<p class="tml-clamp2">' + esc(d.description) + '</p>' +
      '<div class="tml-review-status">' + reviewBadge(d.review) + '</div>' +
      '<div class="tml-card-bottom">' +
        '<div><div class="tml-meta-label">Primary source</div>' +
          '<div class="tml-meta-value">' + esc(d.source) + '</div></div>' +
        '<div class="tml-card-counts"><div>' +
          '<strong class="mono">' + esc(d.fileCount ? number(d.fileCount) : '—') +
          '</strong><span> files</span></div><div>' +
          '<strong class="mono">' + esc(d.paperCount ? number(d.paperCount) : '—') +
          '</strong><span> papers</span></div></div>' +
      '</div></a>';
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
    var featured = state.datasets.slice(0, 6);
    return '<main id="main">' +
      '<section class="tml-herosec">' +
        '<h1 class="tml-hero">Every telecom-ML dataset, with its review trail visible.</h1>' +
        '<p class="tml-hero-copy">A searchable catalog of channel estimation, beamforming, ' +
          'mobility, network traffic and more — where every dataset keeps its source, ' +
          'automated review, human audit, release, paper-use evidence, and reproduction status visible.</p>' +
        '<div class="tml-searchbox" role="search">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<label class="sr-only" for="filter-query">Search</label>' +
          '<input id="filter-query" data-filter="query" value="' + esc(state.filters.query) +
            '" placeholder="Search datasets, tasks, or sources…">' +
          '<a class="tml-button primary" href="#/datasets">Search</a>' +
        '</div>' +
        '<div class="tml-stats">' +
          statBlock(state.datasets.length || stats.approved_static, 'Datasets') +
          statBlock(stats.published || stats.releases, 'Published releases') +
          statBlock(
            stats.linked_papers != null
              ? stats.linked_papers
              : (stats.papers != null ? stats.papers : 0),
            'Papers linked'
          ) +
          statBlock(stats.verified_reproductions || stats.reproductions, 'Verified reproductions') +
        '</div>' +
      '</section>' +
      '<section class="tml-section"><div class="tml-section-heading">' +
        '<h2>Featured datasets</h2><a href="#/datasets">Browse all →</a></div>' +
      (state.loading ? loading() : state.error ? errorBox() : featured.length
        ? '<div class="tml-cardgrid">' + featured.map(datasetCard).join('') + '</div>'
        : '<div class="tml-state"><h3>No AI-reviewed ML records yet</h3><p>Candidates appear after deterministic source checks and evidence-bound AI relevance and usability review. Human audits follow publication.</p><a class="tml-button" href="#/coverage">Inspect coverage</a></div>') +
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
          (f.papers === 'linked' ? d.paperCount > 0 : d.paperCount === 0)) &&
        (f.reproduction === 'all' ||
          (f.reproduction === 'verified' ? d.verifiedRunCount > 0 :
            f.reproduction === 'recorded' ? d.reproductionCount > 0 :
              d.reproductionCount === 0));
    });
  }

  function datasetsPage() {
    var results = filteredDatasets();
    return '<main id="main" class="tml-page">' +
      '<h1>Datasets</h1>' +
      '<p class="tml-page-intro">Telecom-ML datasets across tasks and repositories. ' +
        'Each public record keeps source, access, task, paper, and release evidence together.</p>' +
      '<div class="tml-filter-search" role="search">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
        '<label class="sr-only" for="filter-query">Search</label>' +
        '<input id="filter-query" data-filter="query" value="' + esc(state.filters.query) +
          '" placeholder="Filter datasets…">' +
      '</div>' +
      '<div class="tml-filters" aria-label="Dataset filters">' +
        '<div class="field"><label for="filter-task">Task</label><select id="filter-task" data-filter="task">' + filterOptions(unique([].concat.apply([], state.datasets.map(function(d){return d.tasks;}))), state.filters.task) + '</select></div>' +
        '<div class="field"><label for="filter-origin">Origin</label><select id="filter-origin" data-filter="origin">' + filterOptions(unique(state.datasets.map(function(d){return d.origin;})), state.filters.origin) + '</select></div>' +
        '<div class="field"><label for="filter-access">Access</label><select id="filter-access" data-filter="access">' + filterOptions(unique(state.datasets.map(function(d){return d.access;})), state.filters.access) + '</select></div>' +
        '<div class="field"><label for="filter-source">Source</label><select id="filter-source" data-filter="source">' + filterOptions(unique([].concat.apply([], state.datasets.map(function(d){return d.sourceProviders;}))), state.filters.source) + '</select></div>' +
        '<div class="field"><label for="filter-license">License</label><select id="filter-license" data-filter="license">' + filterOptions(unique(state.datasets.map(function(d){return d.license;})), state.filters.license) + '</select></div>' +
        '<div class="field"><label for="filter-publication">Publication</label><select id="filter-publication" data-filter="publication">' + choiceOptions([{value:'released',label:'Published release'},{value:'source-only',label:'Source-only'}], state.filters.publication) + '</select></div>' +
        '<div class="field"><label for="filter-papers">Papers</label><select id="filter-papers" data-filter="papers">' + choiceOptions([{value:'linked',label:'Evidence-linked'},{value:'none',label:'No evidence-linked paper'}], state.filters.papers) + '</select></div>' +
        '<div class="field"><label for="filter-reproduction">Reproduction</label><select id="filter-reproduction" data-filter="reproduction">' + choiceOptions([{value:'verified',label:'Verified result'},{value:'recorded',label:'Protocol recorded'},{value:'none',label:'No protocol'}], state.filters.reproduction) + '</select></div>' +
      '</div>' +
      '<div class="tml-result-line"><span>' + esc(number(results.length)) +
        ' datasets</span><span>Active scope: static trainable ML</span></div>' +
      (state.loading ? loading() : state.error ? errorBox() : results.length
        ? '<div class="tml-cardgrid">' + results.map(datasetCard).join('') + '</div>'
        : '<div class="tml-state"><h3>No matching dataset records</h3><p>Clear one or more filters to widen the catalog.</p><button class="tml-button" data-action="clear-filters">Clear filters</button></div>') +
      '</main>';
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
      {v:hasPaper ? (detail.papers.length || d.paperCount) + ' linked' : 'No evidence-linked use', l:'Usage evidence'},
      {v:hasRepro ? detail.reproductions.length + ' protocols' : 'No protocol recorded', l:'Controlled study'}
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
      return '<div class="empty"><h3>No metadata schema available</h3><p class="muted">The provider has not exposed field-level metadata yet. TeleMLEBench does not invent columns from filenames or assume the last column is a target.</p></div>';
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
      '<section class="page"><div class="container"><div style="margin-bottom:22px">' + detailRail(x) + '</div><div class="detail-body"><div>' +
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
    return '<main id="main" class="page"><div class="container"><div class="section-head"><div><h1 class="tml-page-title">Reproductions</h1><p class="tml-page-intro">Controlled, claim-specific attempts with attributable outcomes.</p></div><p class="section-copy">Paper-only and artifact-assisted tracks remain separate. Results are verified only after harness validation, isolated execution, conformance review, and server-side scoring.</p></div>' +
      '<div class="evidence" style="margin-bottom:20px"><strong>Important:</strong> “No verified result” is not a failed reproduction. Access, missing data, unsupported tasks, runtime faults, and under-specified methods remain distinct outcomes.</div>' +
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
        (runs.length ? '<div style="overflow-x:auto"><table class="repro-table"><thead><tr><th>Seed</th><th>Outcome</th><th>Metric</th><th>Verified</th><th>Bundle</th></tr></thead><tbody>' +
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
      '<dt>Verified runs</dt><dd>' + esc(number(score.verified_run_count)) + ' / ' + esc(number(score.run_count)) + '</dd>' +
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
      '<p>TeleMLEBench separates discovery, publication, and research claims. A source record can be cataloged without being downloadable. A dataset can be mirrored without having a safe ML task adapter. A paper can be linked without being reproducible. Each state stays visible.</p>' +
      '<div class="steps">' +
        '<article class="step"><div><h3>Source and review</h3><p>Harvest machine-readable metadata, preserve every provider version, resolve identity using DOI and explicit relations, then apply deterministic source checks and AI semantic review. Legal and sensitivity gates separately control payload acquisition and release. Human audits run retroactively and can correct or withdraw a record.</p></div></article>' +
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
          '<article class="card coverage-card"><strong>' + esc(number(s.verified_reproductions)) + '</strong><h3>Verified reproductions</h3><p>Paper-claim experiments with at least one harness-passing, conformant run scored by the trusted evaluator.</p></article>' +
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
    return (labels[state.route.name] ? labels[state.route.name] + ' — ' : '') + 'TeleMLEBench';
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
