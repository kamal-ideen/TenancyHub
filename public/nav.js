// Shared sidebar behaviour: mobile drawer toggle (with backdrop), and
// highlighting whichever nav link matches the page currently loaded.
(function () {
  const ICON_HAMBURGER = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const ICON_CLOSE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';
  const ICON_EXPAND = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/></svg>';
  const ICON_COLLAPSE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/></svg>';

  const toggle = document.getElementById("navToggle");
  const sidebar = document.getElementById("mainNav");
  const overlay = document.getElementById("sidebarOverlay");
  if (!toggle || !sidebar) return;

  function closeSidebar() {
    sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = ICON_HAMBURGER;
  }

  function openSidebar() {
    sidebar.classList.add("open");
    if (overlay) overlay.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.innerHTML = ICON_CLOSE;
  }

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });

  if (overlay) overlay.addEventListener("click", closeSidebar);

  const navLinks = Array.from(sidebar.querySelectorAll(".nav-link"));

  // ---- Highlight whichever link points at the page we're on right now ----
  const currentPage = location.pathname.split("/").pop() || "index.html";
  navLinks.forEach((link) => {
    const linkPage = link.getAttribute("href").split("/").pop();
    link.classList.toggle("active", linkPage === currentPage);
  });

  // ---- Fullscreen chat toggle (WhatsApp-style expand/collapse) ----
  const fullscreenBtn = document.getElementById("chatFullscreenBtn");
  const chatCard = fullscreenBtn ? fullscreenBtn.closest(".chat-card") : null;
  if (fullscreenBtn && chatCard) {
    function setFullscreen(on) {
      chatCard.classList.toggle("chat-fullscreen", on);
      fullscreenBtn.innerHTML = on ? ICON_COLLAPSE : ICON_EXPAND;
      fullscreenBtn.title = on ? "Exit fullscreen" : "Fullscreen";
      fullscreenBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Toggle fullscreen");
      document.body.style.overflow = on ? "hidden" : "";
      const win = document.getElementById("chatWindow");
      if (win) win.scrollTop = win.scrollHeight;
    }

    fullscreenBtn.addEventListener("click", () => {
      setFullscreen(!chatCard.classList.contains("chat-fullscreen"));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && chatCard.classList.contains("chat-fullscreen")) {
        setFullscreen(false);
      }
    });
  }
})();
