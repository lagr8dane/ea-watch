// public/nav.js
// Shared navigation drawer.
// Add to any page: <script src="/nav.js" defer></script>
// Then place <button class="nav-hamburger" onclick="navOpen()">...</button>
// in your header, OR call initNav() to auto-inject into .header-actions

(function () {
  const NAV_ITEMS = [
    {
      label: 'EA',
      path:  '/ea',
      icon:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
    },
    {
      label: 'Routines',
      path:  '/chains',
      icon:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>`,
    },
    {
      label: 'Log',
      path:  '/action-log',
      icon:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    },
    {
      label: 'Settings',
      path:  '/config',
      icon:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    },
  ];

  const currentPath = window.location.pathname;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    .nav-hamburger {
      width: 36px; height: 36px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 5px; background: none; border: none;
      cursor: pointer; padding: 4px;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }
    .nav-hamburger span {
      display: block; width: 18px; height: 1.5px;
      background: #999; border-radius: 1px;
      transition: background 0.15s;
    }
    .nav-hamburger:active span { background: #f0f0f0; }

    .nav-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000; opacity: 0; pointer-events: none;
      transition: opacity 0.25s ease;
      -webkit-backdrop-filter: blur(2px);
      backdrop-filter: blur(2px);
    }
    .nav-overlay.open { opacity: 1; pointer-events: all; }

    .nav-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 72vw; max-width: 280px;
      background: #111111;
      z-index: 1001;
      transform: translateX(100%);
      transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
      border-left: 1px solid rgba(255,255,255,0.08);
    }
    .nav-drawer.open { transform: translateX(0); }

    .nav-drawer-header {
      padding: 20px 20px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      display: flex; align-items: center; justify-content: space-between;
    }
    .nav-drawer-title {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px; font-weight: 500;
      letter-spacing: 0.1em; text-transform: uppercase; color: #555;
    }
    .nav-close {
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; color: #666;
      font-size: 22px; cursor: pointer; line-height: 1;
      -webkit-tap-highlight-color: transparent;
      transition: color 0.15s;
    }
    .nav-close:active { color: #f0f0f0; }

    .nav-items { padding: 8px 0; flex: 1; }

    .nav-item {
      display: flex; align-items: center; gap: 14px;
      padding: 15px 20px; text-decoration: none;
      color: #aaa;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 16px; font-weight: 400;
      transition: background 0.1s, color 0.1s;
      -webkit-tap-highlight-color: transparent;
    }
    .nav-item:active { background: rgba(255,255,255,0.05); }
    .nav-item.active { color: #f0f0f0; font-weight: 500; }
    .nav-item-icon { color: #555; flex-shrink: 0; display: flex; align-items: center; transition: color 0.1s; }
    .nav-item.active .nav-item-icon { color: #f0f0f0; }
  `;
  document.head.appendChild(style);

  // Build overlay + drawer
  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.addEventListener('click', navClose);

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.innerHTML = `
    <div class="nav-drawer-header">
      <span class="nav-drawer-title">EA Watch</span>
      <button class="nav-close">×</button>
    </div>
    <div class="nav-items">
      ${NAV_ITEMS.map(item => {
        const active = currentPath === item.path ||
          (item.path !== '/ea' && currentPath.startsWith(item.path));
        return `<a class="nav-item${active ? ' active' : ''}" href="${item.path}">
          <span class="nav-item-icon">${item.icon}</span>${item.label}
        </a>`;
      }).join('')}
    </div>
  `;
  drawer.querySelector('.nav-close').addEventListener('click', navClose);

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Open / close — exposed globally
  window.navOpen  = function () {
    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window.navClose = function () {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') navClose(); });

  // Auto-inject hamburger into .header-actions or header
  function buildHamburger() {
    const btn = document.createElement('button');
    btn.className = 'nav-hamburger';
    btn.title = 'Menu';
    btn.setAttribute('aria-label', 'Open navigation');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.addEventListener('click', navOpen);
    return btn;
  }

  function inject() {
    const actions = document.querySelector('.header-actions');
    if (actions) {
      actions.appendChild(buildHamburger());
      return;
    }
    const header = document.querySelector('header');
    if (header) {
      header.appendChild(buildHamburger());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
