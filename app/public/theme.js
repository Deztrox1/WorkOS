/* Theme bootstrap. External file because the CSP (script-src 'self') blocks inline scripts. Loaded first, before paint. */
(function () {
  try {
    var t = localStorage.getItem('workos.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch { /* storage unavailable: follow the system theme */ }
})();
