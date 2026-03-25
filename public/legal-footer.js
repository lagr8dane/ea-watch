// Fixed / in-flow Privacy · Terms on every page. Skip if body[data-no-global-legal="1"] (e.g. contact card already includes links).
(function () {
  if (document.getElementById('ea-legal-footer')) return;
  if (document.body.getAttribute('data-no-global-legal') === '1') return;

  var styleId = 'ea-legal-footer-styles';
  if (!document.getElementById(styleId)) {
    var st = document.createElement('style');
    st.id = styleId;
    st.textContent =
      '.ea-legal-strip{flex-shrink:0;text-align:center;font-size:11px;}' +
      '.ea-legal-strip-below{border-top:1px solid rgba(255,255,255,0.06);padding:4px 12px calc(8px + env(safe-area-inset-bottom));}' +
      '.ea-legal-strip a{color:#555;text-decoration:none;}' +
      '.ea-legal-strip a:active{opacity:.85;}' +
      '#ea-legal-footer.ea-legal-inflow{text-align:center;font-size:12px;padding:20px 16px calc(20px + env(safe-area-inset-bottom));color:#555;border-top:1px solid rgba(255,255,255,0.06);}' +
      '#ea-legal-footer.ea-legal-inflow a{color:#666;text-decoration:none;}' +
      '#ea-legal-footer.ea-legal-inflow a:active{opacity:.85;}';
    document.head.appendChild(st);
  }

  var inner =
    '<a href="/privacy">Privacy</a><span style="color:#444;margin:0 6px" aria-hidden="true">·</span><a href="/terms">Terms</a>';

  var inputBar = document.querySelector('body > .input-bar');
  if (inputBar) {
    var strip = document.createElement('div');
    strip.id = 'ea-legal-footer';
    strip.className = 'ea-legal-strip ea-legal-strip-below';
    strip.setAttribute('role', 'contentinfo');
    strip.innerHTML = inner;
    inputBar.parentNode.insertBefore(strip, inputBar.nextSibling);
    return;
  }

  var f = document.createElement('footer');
  f.id = 'ea-legal-footer';
  f.className = 'ea-legal-inflow';
  f.setAttribute('role', 'contentinfo');
  f.innerHTML = inner;
  document.body.appendChild(f);
})();
