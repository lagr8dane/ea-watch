// public/nav.js
// Navigation drawer only. No injection.
// Each page has the hamburger button hardcoded in its header.
// This script just builds the drawer and exposes navOpen() / navClose() globally.

(function () {
  const NAV_ITEMS = [
    { label: 'EA',       path: '/ea' },
    { label: 'Tasks',    path: '/tasks' },
    { label: 'Routines', path: '/chains' },
    { label: 'Log',      path: '/action-log' },
    { label: 'Settings', path: '/config' },
  ];

  const current = window.location.pathname;

  const style = document.createElement('style');
  style.textContent = `
    .nav-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 1000; opacity: 0; pointer-events: none;
      transition: opacity 0.22s ease;
      -webkit-backdrop-filter: blur(3px);
      backdrop-filter: blur(3px);
    }
    .nav-overlay.open { opacity: 1; pointer-events: all; }

    .nav-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 68vw; max-width: 260px;
      background: #141414;
      z-index: 1001;
      transform: translateX(100%);
      transition: transform 0.26s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
      border-left: 1px solid rgba(255,255,255,0.08);
      padding-top: env(safe-area-inset-top);
    }
    .nav-drawer.open { transform: translateX(0); }

    .nav-drawer-top {
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      display: flex; align-items: center; justify-content: space-between;
    }
    .nav-drawer-label {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: #555;
    }
    .nav-x {
      background: none; border: none;
      color: #666; font-size: 24px; line-height: 1;
      cursor: pointer; padding: 0 2px;
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .nav-x:active { color: #fff; }

    .nav-list { padding: 6px 0; flex: 1; }

    .nav-link {
      display: block;
      padding: 16px 22px;
      text-decoration: none;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      font-size: 17px;
      font-weight: 400;
      color: #aaa;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.1s;
      border-left: 3px solid transparent;
    }
    .nav-link:active { background: rgba(255,255,255,0.05); }
    .nav-link.active {
      color: #f0f0f0;
      font-weight: 600;
      border-left-color: #f0f0f0;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.addEventListener('click', navClose);

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.innerHTML = `
    <div class="nav-drawer-top">
      <span class="nav-drawer-label">EA Watch</span>
      <button class="nav-x" id="nav-x">×</button>
    </div>
    <div class="nav-list">
      ${NAV_ITEMS.map(item => {
        const active = current === item.path ||
          (item.path !== '/ea' && current.startsWith(item.path));
        return `<a class="nav-link${active ? ' active' : ''}" href="${item.path}">${item.label}</a>`;
      }).join('')}
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  document.getElementById('nav-x').addEventListener('click', navClose);

  window.navOpen = function () {
    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.navClose = function () {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') navClose();
  });
})();
