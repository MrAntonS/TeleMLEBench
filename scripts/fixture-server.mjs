import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  coverage,
  dataset,
  files,
  paper,
  publicRelease,
  releaseManifest,
  reproduction,
  reproductionSummary,
  sources,
  unreleasedDataset
} from '../tests/fixtures/api-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4174);
const host = '127.0.0.1';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(body);
}

function matchApi(pathname) {
  const match = pathname.match(/^\/(?:(fixtures)\/(empty|error)\/)?api\/v1(\/.*)?$/);
  if (!match) return null;
  return {
    mode: match[2] || 'populated',
    path: match[3] || '/'
  };
}

function populatedResponse(apiPath) {
  if (apiPath === '/datasets') {
    return { items: [unreleasedDataset, dataset], total: 2, next_cursor: null };
  }
  if (apiPath === '/releases') return { items: [publicRelease], total: 1, errors: [] };
  if (apiPath === `/datasets/${dataset.slug}`) return dataset;
  if (apiPath === `/datasets/${dataset.slug}/files`) {
    return { items: files, total: files.length, next_cursor: null };
  }
  if (apiPath === '/papers') return { items: [paper], total: 1 };
  if (apiPath === `/papers/${paper.paper_id}`) return paper;
  if (apiPath === '/reproductions') {
    return { items: [reproductionSummary], total: 1 };
  }
  if (apiPath === `/reproductions/${reproduction.id}`) return reproduction;
  if (apiPath === '/catalog/coverage') return coverage;
  if (apiPath === '/catalog/sources') return sources;
  if (apiPath === '/stats') {
    return {
      datasets: coverage.counts.discovered,
      approved_static: coverage.counts.approved_static_ml,
      papers: coverage.counts.linked_papers,
      linked_papers: coverage.counts.linked_papers,
      confirmed_paper_links: coverage.counts.paper_linked,
      reproductions: coverage.counts.verified_reproductions
    };
  }
  if (apiPath === `/releases/${releaseManifest.release_id}/manifest`) {
    return releaseManifest;
  }
  return undefined;
}

function emptyResponse(apiPath) {
  if (apiPath === '/datasets' || apiPath === '/papers' || apiPath === '/reproductions' || apiPath === '/releases') {
    return { items: [], total: 0, next_cursor: null };
  }
  if (apiPath === '/catalog/coverage') {
    return {
      registry_version: coverage.registry_version,
      counts: {
        discovered: 0,
        approved_static_ml: 0,
        published: 0,
        paper_linked: 0,
        verified_reproductions: 0
      },
      sync: { terminal: 0, total: 15 }
    };
  }
  if (apiPath === '/catalog/sources') return { items: [] };
  if (apiPath === '/stats') return {};
  return undefined;
}

function serveApi(request, response, url, api) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Origin': '*'
    });
    response.end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { detail: 'Method not allowed' });
    return;
  }
  if (api.mode === 'error') {
    json(response, 503, { detail: 'Deterministic fixture outage' });
    return;
  }

  const apiPath = api.path;
  const payload = api.mode === 'empty'
    ? emptyResponse(apiPath)
    : populatedResponse(apiPath);
  if (payload === undefined) {
    json(response, 404, { detail: `No fixture for ${apiPath}` });
    return;
  }
  json(response, 200, payload);
}

function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  const allowed = new Set(['index.html', 'app.js', 'config.js']);
  if (!target.startsWith(root + path.sep) || !allowed.has(relative)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream'
    });
    response.end(body);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  if (url.pathname === '/__fixture_health') {
    json(response, 200, { status: 'ok' });
    return;
  }
  const api = matchApi(url.pathname);
  if (api) {
    serveApi(request, response, url, api);
    return;
  }
  serveStatic(response, decodeURIComponent(url.pathname));
});

server.listen(port, host, () => {
  console.log(`OpenWirelessML fixture server: http://${host}:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
