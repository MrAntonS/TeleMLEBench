(function () {
  'use strict';

  window.TMLB_EVALUATION_API_BASE = 'https://telemlebench.vercel.app/api/v1';

  var enhancements = document.createElement('script');
  enhancements.src = new URL('./app-enhancements.js?v=20260804-1', document.baseURI).href;
  document.head.appendChild(enhancements);
}());
