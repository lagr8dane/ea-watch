/* Apply reading-column width from localStorage before shell.css paints.
 * Set in Settings → Display. Keys: '', '560', '720' → data-shell-max on <html>. */
(function () {
  try {
    var v = localStorage.getItem('ea_shell_max');
    if (v === '560' || v === '720') {
      document.documentElement.setAttribute('data-shell-max', v);
    } else {
      document.documentElement.removeAttribute('data-shell-max');
    }
  } catch (e) { /* ignore */ }
})();
