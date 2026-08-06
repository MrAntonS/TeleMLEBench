(function () {
  'use strict';

  function load(source, complete) {
    var script = document.createElement('script');
    script.src = source;
    script.onload = complete || null;
    script.onerror = function () {
      var app = document.getElementById('app');
      if (app) app.textContent = 'TeleMLEBench could not load its application bundle.';
    };
    document.head.appendChild(script);
  }

  load('/app-core.js', function () {
    load('/app-enhancements.js');
  });
}());
