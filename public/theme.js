// Applies the saved (or system-default) theme immediately, before the page
// paints, so there's no flash of the wrong theme. Loaded before style.css
// on every page, including the auth pages, so the choice stays consistent
// even where there's no toggle button (only the main app pages have one).
(function () {
  const STORAGE_KEY = "tenancyhub-theme";

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }

  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage unavailable (private browsing, disabled cookies, etc.) —
    // fall through to the system preference below instead of erroring.
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) return;

    const ICON_MOON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>';
    const ICON_SUN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';

    function updateLabel() {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      btn.innerHTML = isDark ? `${ICON_SUN} Light mode` : `${ICON_MOON} Dark mode`;
    }
    updateLabel();

    btn.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const next = isDark ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        // Preference just won't persist across visits — theme still works this session.
      }
      updateLabel();
    });
  });
})();
