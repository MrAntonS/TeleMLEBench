(function () {
  'use strict';

  var API_BASE = String(window.TMLB_EVALUATION_API_BASE || '/api/v1').replace(/\/+$/, '');
  var activeLoad = 0;
  var turnstileConfigPromise = null;
  var turnstileScriptPromise = null;

  var style = document.createElement('style');
  style.textContent = [
    '.tml-release-download-panel{position:relative;overflow:hidden}',
    '.tml-release-download-panel:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--accent);opacity:.5}',
    '.tml-release-stack{display:grid;gap:16px}',
    '.tml-release-unit{padding:18px;border:1px solid rgba(144,144,150,.31);border-radius:2px;background:rgba(25,28,30,.78)}',
    '.tml-release-unit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}',
    '.tml-release-unit-head h3{margin:0;color:var(--ink);font:600 13px/1.45 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-meta{margin-top:5px;color:var(--subtle);font:8px/1.5 var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-release-flow{display:grid;grid-template-columns:repeat(3,1fr);margin:13px 0 16px;border:1px solid rgba(144,144,150,.28);border-radius:2px;overflow:hidden;background:#14191b}',
    '.tml-release-flow span{position:relative;padding:10px 9px 10px 29px;color:var(--muted);font:500 9px var(--mono);letter-spacing:.04em;text-transform:uppercase}',
    '.tml-release-flow span+span{border-left:1px solid rgba(144,144,150,.22)}',
    '.tml-release-flow i{position:absolute;left:10px;top:9px;display:grid;width:14px;height:14px;place-items:center;border-radius:2px;background:rgba(156,240,255,.1);color:var(--accent);font:500 8px var(--mono);font-style:normal}',
    '.tml-release-files{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '.tml-release-file{display:flex;min-width:0;flex-direction:column;padding:13px;border:1px solid rgba(144,144,150,.25);border-radius:2px;background:#14191b}',
    '.tml-release-file strong{color:var(--ink);font-size:13px}',
    '.tml-release-file code{margin:7px 0 11px;color:var(--subtle);font:8px/1.45 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-file a{margin-top:auto;padding:9px;border:1px solid var(--line-strong);border-radius:2px;background:transparent;color:var(--ink);text-align:center;text-decoration:none;font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.035em}',
    '.tml-release-file a:hover{border-color:var(--accent);background:rgba(156,240,255,.06);color:var(--accent)}',
    '.tml-release-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}',
    '.tml-release-tools a{color:var(--accent);font-size:12px;font-weight:600;text-decoration:none}',
    '.tml-evaluator{margin-top:16px;padding-top:16px;border-top:1px solid rgba(144,144,150,.25)}',
    '.tml-evaluator-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}',
    '.tml-evaluator h4{margin:0;color:var(--ink);font-size:15px}',
    '.tml-evaluator-copy{margin:5px 0 13px;color:#9fa6ab;font-size:12px;line-height:1.55}',
    '.tml-evaluator-grid{display:grid;grid-template-columns:minmax(220px,1fr) 300px auto;gap:12px;align-items:end}',
    '.tml-evaluator-field{display:grid;gap:5px}',
    '.tml-evaluator-field span{color:#747c81;font:8px var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-evaluator-field input{height:42px;padding:9px 11px;font-size:12px;border:1px solid rgba(144,144,150,.36);border-radius:2px;background:#111617;color:#d8dcdf;font-family:var(--mono)}',
    '.tml-turnstile-field{display:grid;gap:5px}',
    '.tml-turnstile-field>span{color:#747c81;font:8px var(--mono);letter-spacing:.05em;text-transform:uppercase}',
    '.tml-turnstile{min-height:65px;display:flex;align-items:center;justify-content:flex-start}',
    '.tml-evaluator-submit{min-height:42px;padding:10px 16px;border:1px solid var(--accent);border-radius:2px;background:var(--accent);color:#001f24;font:500 11px var(--mono);letter-spacing:.035em;text-transform:uppercase;cursor:pointer}',
    '.tml-evaluator-submit[disabled]{cursor:wait;opacity:.58}',
    '.tml-evaluator-progress{display:none;width:100%;height:7px;margin-top:12px;accent-color:var(--accent)}',
    '.tml-evaluator-status{min-height:19px;margin-top:10px;color:var(--muted);font-size:12px;line-height:1.55}',
    '.tml-evaluator-status.error{padding:9px 11px;border:1px solid rgba(255,180,171,.35);border-radius:2px;background:rgba(105,0,5,.14);color:var(--red);text-align:left}',
    '.tml-score-result{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin-top:12px;padding:14px;border:1px solid rgba(131,216,193,.32);border-radius:2px;background:rgba(131,216,193,.06)}',
    '.tml-score-value{color:var(--green);font:500 24px var(--mono)}',
    '.tml-score-detail{align-self:center;color:var(--green);font-size:12px;line-height:1.5}',
    '.tml-score-hashes{grid-column:1/-1;color:var(--subtle);font:8px/1.6 var(--mono);overflow-wrap:anywhere}',
    '.tml-release-empty{padding:17px;border:1px dashed rgba(144,144,150,.42);border-radius:2px;color:#969da2;font-size:13px}',
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
        theme: 'dark',
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
        var uploader = await import('/browser/blob-upload.js');
        var upload = await uploader.uploadPrediction({
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
