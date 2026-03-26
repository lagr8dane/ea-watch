// Privacy · Terms — same strip on every page that uses .app-shell (or legacy body > .input-bar).
// Skip if body[data-no-global-legal="1"] (e.g. public contact card).
(function () {
  if (document.getElementById('ea-legal-footer')) return;
  if (document.body.getAttribute('data-no-global-legal') === '1') return;

  var styleId = 'ea-legal-footer-styles';
  if (!document.getElementById(styleId)) {
    var st = document.createElement('style');
    st.id = styleId;
    st.textContent =
      '.ea-legal-strip{flex-shrink:0;text-align:center;font-size:11px;line-height:1.5;}' +
      '.ea-legal-strip-below{' +
      'border-top:1px solid rgba(255,255,255,0.06);' +
      'padding:10px max(16px, env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));' +
      '}' +
      '.ea-legal-strip a{color:#555;text-decoration:none;}' +
      '.ea-legal-strip a:hover{color:#777;}' +
      '.ea-legal-strip a:active{opacity:.85;}';
    document.head.appendChild(st);
  }

  var inner =
    '<a href="/privacy">Privacy</a><span style="color:#444;margin:0 6px" aria-hidden="true">·</span><a href="/terms">Terms</a>';

  var shell = document.querySelector('.app-shell');
  var inputBar = document.querySelector('.app-shell .input-bar') || document.querySelector('.input-bar');

  var strip = document.createElement('div');
  strip.id = 'ea-legal-footer';
  strip.className = 'ea-legal-strip ea-legal-strip-below';
  strip.setAttribute('role', 'contentinfo');
  strip.innerHTML = inner;

  if (shell && inputBar && shell.contains(inputBar)) {
    if (inputBar.nextSibling) {
      inputBar.parentNode.insertBefore(strip, inputBar.nextSibling);
    } else {
      inputBar.parentNode.appendChild(strip);
    }
    return;
  }

  if (shell) {
    shell.appendChild(strip);
    return;
  }

  // Legacy: EA before shell migration
  var legacyBar = document.querySelector('body > .input-bar');
  if (legacyBar) {
    if (legacyBar.nextSibling) {
      legacyBar.parentNode.insertBefore(strip, legacyBar.nextSibling);
    } else {
      legacyBar.parentNode.appendChild(strip);
    }
    return;
  }

  document.body.appendChild(strip);
})();
