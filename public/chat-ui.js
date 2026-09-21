// Shared chat building blocks used by the landlord, tenant, and manager
// portals so the messaging experience feels the same everywhere.
const ChatUI = (function () {
  // ---- Shared SVG icon set (stroke style matches the sidebar nav icons) ----
  // Emoji reactions (👍❤️😂🔥👏😢) are deliberately NOT in here — those are
  // real reactions, not UI icons, and should keep looking like emoji.
  const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    moon: `<svg ${ICON_ATTRS}><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>`,
    sun: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg>`,
    bell: `<svg ${ICON_ATTRS}><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>`,
    paperclip: `<svg ${ICON_ATTRS}><path d="M8 12.5l6.5-6.5a3 3 0 1 1 4.2 4.2l-8 8a4.5 4.5 0 1 1-6.4-6.4l7.5-7.4"/></svg>`,
    camera: `<svg ${ICON_ATTRS}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.3"/></svg>`,
    image: `<svg ${ICON_ATTRS}><rect x="3" y="4.5" width="18" height="14" rx="2"/><circle cx="8.2" cy="9.5" r="1.7"/><path d="M21 15.5l-5-5-4.5 4.5M12 17l-2.5-2.5L3 19"/></svg>`,
    document: `<svg ${ICON_ATTRS}><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>`,
    mic: `<svg ${ICON_ATTRS}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/></svg>`,
    receipt: `<svg ${ICON_ATTRS}><path d="M6 2.5h12v19l-2.2-1.6-2.2 1.6-2.2-1.6-2.2 1.6-2.2-1.6L6 21.5z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>`,
    wrench: `<svg ${ICON_ATTRS}><path d="M14.7 6.3a4 4 0 0 0-5.4 4.6L3 17.2V21h3.8l6.3-6.3a4 4 0 0 0 4.6-5.4l-2.8 2.8-2.4-.7-.7-2.4z"/></svg>`,
    megaphone: `<svg ${ICON_ATTRS}><path d="M3 10v4a1 1 0 0 0 1 1h2l6 4V5l-6 4H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6M20 6.5a8 8 0 0 1 0 11"/></svg>`,
    cash: `<svg ${ICON_ATTRS}><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 8v.01M18 16v.01"/></svg>`,
    pin: `<svg ${ICON_ATTRS}><path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>`,
    ellipsis: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
    reply: `<svg ${ICON_ATTRS}><path d="M9 7L4 12l5 5M4 12h10a5 5 0 0 1 5 5v1"/></svg>`,
    copy: `<svg ${ICON_ATTRS}><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/></svg>`,
    edit: `<svg ${ICON_ATTRS}><path d="M15 4l5 5-11 11H4v-5z"/></svg>`,
    trash: `<svg ${ICON_ATTRS}><path d="M4 7h16M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/></svg>`,
    close: `<svg ${ICON_ATTRS}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    hamburger: `<svg ${ICON_ATTRS}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    expand: `<svg ${ICON_ATTRS}><path d="M9 4H4v5M15 20h5v-5M4 20l6-6M20 4l-6 6"/></svg>`,
    compress: `<svg ${ICON_ATTRS}><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/></svg>`,
    video: `<svg ${ICON_ATTRS}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>`,
    record: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`,
    warning: `<svg ${ICON_ATTRS}><path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4M12 17.5v.01"/></svg>`,
    chat: `<svg ${ICON_ATTRS}><path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.2 3.5A.6.6 0 0 1 4 19v-2.5H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/></svg>`,
    folder: `<svg ${ICON_ATTRS}><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z"/></svg>`,
    mail: `<svg ${ICON_ATTRS}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6 8.5-6"/></svg>`,
  };
  function doubleCheckHTML() {
    return `<span class="check-double">${icons.check}${icons.check}</span>`;
  }

  // ---- Toolbar popups (attach, receipt, maintenance) are mutually exclusive ----
  // Every popup shares the .chat-attach-menu class, so opening any one of
  // them closes the rest — otherwise they stack up on top of each other,
  // which is confusing and makes it easy to double-click a stale "Send".
  function closeAllToolbarMenus(exceptEl) {
    document.querySelectorAll(".chat-attach-menu").forEach((el) => {
      if (el !== exceptEl) el.hidden = true;
    });
  }

  // ---- Lightbox: tap an image to see it full-screen, like WhatsApp ----
  let lightboxEl = null;

  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement("div");
    lightboxEl.id = "chatLightbox";
    lightboxEl.className = "chat-lightbox";
    lightboxEl.hidden = true;
    lightboxEl.innerHTML = `
      <button type="button" class="chat-lightbox-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <img alt="Attachment preview">
    `;
    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl || e.target.classList.contains("chat-lightbox-close")) {
        closeLightbox();
      }
    });
    document.body.appendChild(lightboxEl);
    return lightboxEl;
  }

  function openLightbox(url) {
    const el = ensureLightbox();
    el.querySelector("img").src = url;
    el.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.hidden = true;
    document.body.style.overflow = "";
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightboxEl && !lightboxEl.hidden) closeLightbox();
  });

  // Delegated click: any rendered chat image opens the lightbox.
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".chat-attachment-img");
    if (img) openLightbox(img.src);
  });

  // ---- Attachment rendering (image / video / audio / pdf / file) ----
  function attachmentHTML(m, escapeHtml) {
    if (!m.attachmentUrl) return "";
    if (m.attachmentType === "image") {
      return `<img class="chat-attachment-img" src="${m.attachmentUrl}" alt="${escapeHtml(m.attachmentName || "photo")}" draggable="false">`;
    }
    if (m.attachmentType === "video") {
      return `<video class="chat-attachment-video" src="${m.attachmentUrl}" controls></video>`;
    }
    if (m.attachmentType === "audio") {
      return `<audio class="chat-attachment-audio" src="${m.attachmentUrl}" controls></audio>`;
    }
    const icon = m.attachmentType === "pdf" ? icons.document : icons.paperclip;
    return `<a class="chat-attachment-file" href="${m.attachmentUrl}" target="_blank" rel="noopener">${icon} ${escapeHtml(m.attachmentName || "Download file")}</a>`;
  }

  // ---- Structured attachments: a receipt shown as a linked record, not a raw file ----
  function cardHTML(m, escapeHtml, isTenantViewer) {
    if (m.cardType === "broadcast") {
      return `<div class="chat-broadcast-badge">${icons.megaphone} Announcement to all tenants</div>`;
    }
    if (m.cardType === "maintenance" && m.cardData) {
      const { description, status, dateCreated } = m.cardData;
      const statusLabel = status === "done" ? "Done" : status === "in_progress" ? "In progress" : "Open";
      const dateLabel = new Date(dateCreated).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
      return `
        <div class="chat-card-attachment">
          <div class="chat-card-attachment-icon">${icons.wrench}</div>
          <div class="chat-card-attachment-body">
            <div class="chat-card-attachment-title">Maintenance update</div>
            <div class="chat-card-attachment-sub">${escapeHtml(description)}</div>
            <div class="chat-card-attachment-sub">Status: ${statusLabel} · logged ${escapeHtml(dateLabel)}</div>
          </div>
        </div>
      `;
    }
    if (m.cardType !== "receipt" || !m.cardData) return "";
    const { amount, date, receiptNumber, paymentId } = m.cardData;
    const formatted = "₦" + Number(amount).toLocaleString("en-NG");
    const dateLabel = new Date(date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
    const receiptUrl = isTenantViewer ? `/api/tenant/payments/${paymentId}/receipt` : `/api/payments/${paymentId}/receipt`;
    return `
      <div class="chat-card-attachment">
        <div class="chat-card-attachment-icon">${icons.receipt}</div>
        <div class="chat-card-attachment-body">
          <div class="chat-card-attachment-title">Rent Receipt</div>
          <div class="chat-card-attachment-sub">${formatted} · ${escapeHtml(dateLabel)}</div>
          <div class="chat-card-attachment-sub">${escapeHtml(receiptNumber)}</div>
        </div>
        <a class="chat-card-attachment-action" href="${receiptUrl}" target="_blank" rel="noopener">View</a>
      </div>
    `;
  }

  // ---- Read receipts: single grey tick once sent, double blue tick once read ----
  function ticksHTML(m, mine) {
    if (!mine) return "";
    const read = m.senderRole === "tenant" ? m.readByLandlord : m.readByTenant;
    return `<span class="chat-ticks ${read ? "read" : ""}" title="${read ? "Read" : "Sent"}">${read ? doubleCheckHTML() : icons.check}</span>`;
  }

  // ---- Date dividers: "Today" / "Yesterday" / "12 Jul", inserted between days ----
  function isSameDay(a, b) {
    return a.toDateString() === b.toDateString();
  }

  function dateDividerLabel(dateStr) {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return "Today";
    if (isSameDay(d, yesterday)) return "Yesterday";
    return d.toLocaleDateString("en-NG", {
      day: "numeric",
      month: "short",
      year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  }

  function dateDividerHTML(dateStr) {
    return `<div class="chat-date-divider"><span>${dateDividerLabel(dateStr)}</span></div>`;
  }

  // ---- Attach menu: "+" opens Camera / Photo & Video / Document, like WhatsApp ----
  function initAttachMenu(opts) {
    const attachBtn = document.getElementById(opts.attachBtnId);
    const menu = document.getElementById(opts.menuId);
    const cameraInput = document.getElementById(opts.cameraInputId);
    const mediaInput = document.getElementById(opts.mediaInputId);
    const docInput = document.getElementById(opts.docInputId);
    const preview = document.getElementById(opts.previewId);
    if (!attachBtn || !menu) return;

    function closeMenu() {
      menu.hidden = true;
    }
    function toggleMenu() {
      const willOpen = menu.hidden;
      if (willOpen) closeAllToolbarMenus(menu);
      menu.hidden = !willOpen;
    }

    attachBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== attachBtn) closeMenu();
    });

    menu.querySelectorAll("[data-attach]").forEach((item) => {
      item.addEventListener("click", () => {
        closeMenu();
        if (item.dataset.attach === "camera") cameraInput.click();
        if (item.dataset.attach === "media") mediaInput.click();
        if (item.dataset.attach === "document") docInput.click();
      });
    });

    function showPreview(file) {
      preview.hidden = false;
      const isImage = file.type.startsWith("image/");
      const thumb = isImage
        ? `<img src="${URL.createObjectURL(file)}" class="chat-attach-thumb" alt="">`
        : `<span class="chat-attach-thumb chat-attach-thumb-icon">${file.type === "application/pdf" ? icons.document : file.type.startsWith("video/") ? icons.video : icons.paperclip}</span>`;
      preview.innerHTML = `${thumb}<span class="chat-attach-name">${opts.escapeHtml(file.name)}</span><button type="button" class="chat-attach-remove">Remove</button>`;
      preview.querySelector(".chat-attach-remove").addEventListener("click", () => {
        opts.onClear();
        cameraInput.value = "";
        mediaInput.value = "";
        docInput.value = "";
        preview.hidden = true;
        preview.innerHTML = "";
      });
    }

    [cameraInput, mediaInput, docInput].forEach((input) => {
      if (!input) return;
      input.addEventListener("change", () => {
        const file = input.files[0];
        if (!file) return;
        opts.onSelect(file);
        showPreview(file);
      });
    });
  }

  // ---- Reactions: a small fixed emoji set, one per person per message ----
  const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "😢"];

  function reactionsHTML(m) {
    const entries = Object.entries(m.reactions || {});
    if (entries.length === 0) return "";
    return (
      `<div class="chat-reactions">` +
      entries
        .map(
          ([emoji, info]) =>
            `<button type="button" class="chat-reaction-pill ${info.mine ? "mine" : ""}" data-react-id="${m.id}" data-emoji="${emoji}">${emoji} <span>${info.count}</span></button>`
        )
        .join("") +
      `</div>`
    );
  }

  // ---- Reply / quote: a small snippet of the original message inside the reply bubble ----
  function attachmentSnippetLabel(m) {
    if (m.attachmentType === "image") return `${icons.image} Photo`;
    if (m.attachmentType === "video") return `${icons.video} Video`;
    if (m.attachmentType === "pdf") return `${icons.document} Document`;
    return `${icons.paperclip} Attachment`;
  }

  function replyQuoteHTML(m, messagesById, escapeHtml) {
    if (!m.replyToId) return "";
    const original = messagesById[m.replyToId];
    if (!original) return `<div class="chat-reply-quote muted">Original message unavailable</div>`;
    const snippet = original.text ? escapeHtml(original.text).slice(0, 120) : attachmentSnippetLabel(original);
    return `<div class="chat-reply-quote" data-scroll-to="${original.id}"><strong>${escapeHtml(original.senderName)}</strong><span>${snippet}</span></div>`;
  }

  // A compact preview used above the message input while composing a reply.
  function replyBarHTML(m, escapeHtml) {
    const snippet = m.text ? escapeHtml(m.text).slice(0, 100) : attachmentSnippetLabel(m);
    return `
      <div class="chat-reply-bar-text"><strong>Replying to ${escapeHtml(m.senderName)}</strong><span>${snippet}</span></div>
      <button type="button" class="chat-reply-bar-cancel" aria-label="Cancel reply">${icons.close}</button>
    `;
  }

  // ---- Per-message "⋯" menu: reactions row + reply/copy/edit/delete ----
  function messageMenuHTML(m) {
    return `
      <div class="chat-msg-menu-wrap">
        <button type="button" class="chat-msg-menu-btn" data-menu-toggle="${m.id}" aria-label="Message actions">${icons.ellipsis}</button>
        <div class="chat-msg-menu" id="msgMenu-${m.id}" hidden>
          <div class="chat-msg-menu-reactions">
            ${ALLOWED_REACTIONS.map((e) => `<button type="button" data-react-id="${m.id}" data-emoji="${e}">${e}</button>`).join("")}
          </div>
          <button type="button" data-action="reply" data-id="${m.id}">${icons.reply} Reply</button>
          ${m.text ? `<button type="button" data-action="copy" data-id="${m.id}">${icons.copy} Copy</button>` : ""}
          ${m.canEdit ? `<button type="button" data-action="edit" data-id="${m.id}">${icons.edit} Edit</button>` : ""}
          <button type="button" data-action="delete" data-id="${m.id}">${icons.trash} Delete for me</button>
        </div>
      </div>
    `;
  }

  // ---- Consecutive-message grouping: hide repeated sender label within a short window ----
  function shouldGroup(prev, cur) {
    if (!prev) return false;
    if (prev.senderRole !== cur.senderRole || prev.senderName !== cur.senderName) return false;
    if (!isSameDay(new Date(prev.createdAt), new Date(cur.createdAt))) return false;
    return new Date(cur.createdAt) - new Date(prev.createdAt) < 3 * 60 * 1000;
  }

  // ---- Unread divider: shown once, at the first message that was unread when the thread opened ----
  function unreadDividerHTML() {
    return `<div class="chat-unread-divider"><span>Unread messages</span></div>`;
  }

  // ---- Wires all per-message interactions (menu, reactions, reply, copy, delete, quote-jump) ----
  function initChatThread(opts) {
    // opts: { windowId, getMessages(): Message[], onReply(msg), onReload(): Promise }
    const win = document.getElementById(opts.windowId);
    if (!win || win.dataset.chatThreadWired) return;
    win.dataset.chatThreadWired = "true";

    function closeAllMenus() {
      win.querySelectorAll(".chat-msg-menu:not([hidden])").forEach((menu) => { menu.hidden = true; });
    }

    win.addEventListener("click", async (e) => {
      const menuToggle = e.target.closest("[data-menu-toggle]");
      if (menuToggle) {
        const menu = document.getElementById(`msgMenu-${menuToggle.dataset.menuToggle}`);
        const wasHidden = menu.hidden;
        closeAllMenus();
        menu.hidden = !wasHidden;
        return;
      }

      const reactBtn = e.target.closest("[data-react-id]");
      if (reactBtn) {
        closeAllMenus();
        await fetch(`/api/messages/${reactBtn.dataset.reactId}/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: reactBtn.dataset.emoji }),
        });
        opts.onReload();
        return;
      }

      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        closeAllMenus();
        const msg = opts.getMessages().find((m) => m.id === actionBtn.dataset.id);
        if (!msg) return;
        if (actionBtn.dataset.action === "reply") opts.onReply(msg);
        if (actionBtn.dataset.action === "edit") opts.onEdit(msg);
        if (actionBtn.dataset.action === "copy") {
          try { await navigator.clipboard.writeText(msg.text || ""); } catch (err) { /* clipboard unavailable */ }
        }
        if (actionBtn.dataset.action === "delete") {
          if (confirm("Delete this message for you? The other person will still see it.")) {
            await fetch(`/api/messages/${msg.id}/delete-for-me`, { method: "POST" });
            opts.onReload();
          }
        }
        return;
      }

      const quote = e.target.closest("[data-scroll-to]");
      if (quote) {
        const target = document.getElementById(`msg-${quote.dataset.scrollTo}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("chat-flash");
          setTimeout(() => target.classList.remove("chat-flash"), 1200);
        }
        return;
      }

      const retryBtn = e.target.closest("[data-retry-id]");
      if (retryBtn && opts.onRetry) { opts.onRetry(retryBtn.dataset.retryId); return; }

      const discardBtn = e.target.closest("[data-discard-id]");
      if (discardBtn && opts.onDiscard) { opts.onDiscard(discardBtn.dataset.discardId); return; }

      const cancelBtn = e.target.closest("[data-cancel-id]");
      if (cancelBtn && opts.onCancelUpload) { opts.onCancelUpload(cancelBtn.dataset.cancelId); return; }

      if (!e.target.closest(".chat-msg-menu")) closeAllMenus();
    });

    document.addEventListener("click", (e) => {
      if (!win.contains(e.target)) closeAllMenus();
    });
  }

  // ---- Reply bar above the input: shows what you're replying to, cancel to clear ----
  function wireReplyBar(barId, onCancel) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      if (e.target.closest(".chat-reply-bar-cancel")) onCancel();
    });
  }

  function showReplyBar(barId, msg, escapeHtml) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.hidden = false;
    bar.innerHTML = replyBarHTML(msg, escapeHtml);
  }

  function hideReplyBar(barId) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.hidden = true;
    bar.innerHTML = "";
  }

  function showEditBar(barId) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.hidden = false;
    bar.innerHTML = `
      <div class="chat-reply-bar-text"><strong>Editing message</strong><span>Update the text below and send to save changes</span></div>
      <button type="button" class="chat-reply-bar-cancel" aria-label="Cancel edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    `;
  }

  // ---- Attachment-type filter bar: All / Photos / Documents ----
  function initAttachFilter(barId, onChange) {
    const bar = document.getElementById(barId);
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = "true";
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      bar.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.filter);
    });
  }

  function messageMatchesFilter(m, filter) {
    if (filter === "all") return true;
    if (filter === "photos") return m.attachmentType === "image" || m.attachmentType === "video";
    if (filter === "documents") return m.attachmentType === "pdf" || m.cardType === "receipt" || m.cardType === "maintenance";
    return true;
  }

  // ---- Compress an image before upload (resize + re-encode as JPEG) ----
  // Skips anything that isn't a plain image, and skips already-small files —
  // no point re-encoding a photo that's already under the target size.
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.82;
    if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 400 * 1024) {
      return Promise.resolve(file);
    }
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim) { resolve(file); return; }
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ---- Upload with progress, cancel, and retry ----
  // fetch() has no upload-progress event, so this uses XMLHttpRequest instead,
  // wrapped to look like a normal promise-based call from the outside.
  function uploadWithProgress(url, formData, onProgress) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open("POST", url);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (err) { /* non-JSON response */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || "Upload failed"));
      });
      xhr.addEventListener("error", () => reject(new Error("Network error — check your connection and try again")));
      xhr.addEventListener("abort", () => reject(new Error("__cancelled__")));
      xhr.send(formData);
    });
    return { promise, cancel: () => xhr.abort() };
  }

  // ---- A bubble for a message that's still sending, failed, or was cancelled ----
  function pendingBubbleHTML(pending, escapeHtml) {
    const fileLabel = pending.fileName ? escapeHtml(pending.fileName) : "";
    let body;
    if (pending.status === "error") {
      body = `
        <div class="chat-pending-error">${icons.warning} ${escapeHtml(pending.errorMsg || "Couldn't send")}</div>
        <div class="chat-pending-actions">
          <button type="button" class="chat-pending-retry" data-retry-id="${pending.tempId}">Retry</button>
          <button type="button" class="chat-pending-discard" data-discard-id="${pending.tempId}">Discard</button>
        </div>
      `;
    } else if (pending.fileName) {
      body = `
        <div class="chat-pending-file">${icons.paperclip} ${fileLabel}</div>
        <div class="chat-pending-progress"><div class="chat-pending-progress-bar" style="width:${pending.progress || 0}%"></div></div>
        <button type="button" class="chat-pending-cancel" data-cancel-id="${pending.tempId}">Cancel</button>
      `;
    } else {
      body = `<div class="chat-pending-sending">Sending…</div>`;
    }
    return `
      <div class="chat-bubble-row mine" id="pending-${pending.tempId}">
        <div class="chat-bubble mine chat-bubble-pending">
          ${pending.text ? `<div>${escapeHtml(pending.text)}</div>` : ""}
          ${body}
        </div>
      </div>
    `;
  }

  // ---- Voice notes: tap to record, tap again to stop (MVP — no waveform or lock, see roadmap) ----
  function initVoiceRecorder(opts) {
    // opts: { micBtnId, indicatorId, onRecorded(blob, mimeType) }
    const micBtn = document.getElementById(opts.micBtnId);
    const indicator = document.getElementById(opts.indicatorId);
    if (!micBtn) return;

    let mediaRecorder = null;
    let chunks = [];
    let startedAt = 0;
    let timerHandle = null;

    function tick() {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, "0");
      const ss = String(secs % 60).padStart(2, "0");
      if (indicator) indicator.innerHTML = `${icons.record} Recording ${mm}:${ss}`;
    }

    micBtn.addEventListener("click", async () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Voice notes aren't supported in this browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = () => {
          clearInterval(timerHandle);
          if (indicator) indicator.textContent = "";
          micBtn.classList.remove("recording");
          stream.getTracks().forEach((t) => t.stop());
          const mimeType = mediaRecorder.mimeType || "audio/webm";
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size > 0) opts.onRecorded(blob, mimeType);
        };
        mediaRecorder.start();
        startedAt = Date.now();
        micBtn.classList.add("recording");
        tick();
        timerHandle = setInterval(tick, 1000);
      } catch (err) {
        alert("Couldn't access the microphone — check your browser's permission for this site.");
      }
    });
  }

  // ---- Typing indicator: throttled ping while composing, periodic poll for the other side ----
  function initTypingIndicator(opts) {
    // opts: { inputId, indicatorId, getPingUrl(): string|null, getStatusUrl(): string|null,
    //         isActive(): bool, pollMs, throttleMs }
    const input = document.getElementById(opts.inputId);
    const indicator = document.getElementById(opts.indicatorId);
    if (!input) return;

    const pollMs = opts.pollMs || 2500;
    const throttleMs = opts.throttleMs || 2000;
    let lastPing = 0;

    input.addEventListener("input", () => {
      if (!opts.isActive()) return;
      const now = Date.now();
      if (now - lastPing < throttleMs) return;
      lastPing = now;
      const url = opts.getPingUrl();
      if (url) fetch(url, { method: "POST" });
    });

    setInterval(async () => {
      if (!opts.isActive() || !indicator) return;
      const url = opts.getStatusUrl();
      if (!url) { indicator.hidden = true; return; }
      try {
        const res = await fetch(url);
        const data = await res.json();
        indicator.hidden = !data.typing;
      } catch (err) {
        // Network hiccup — leave the indicator as it was rather than flicker.
      }
    }, pollMs);
  }

  return {
    openLightbox,
    closeLightbox,
    attachmentHTML,
    cardHTML,
    ticksHTML,
    dateDividerHTML,
    isSameDay,
    initAttachMenu,
    ALLOWED_REACTIONS,
    reactionsHTML,
    replyQuoteHTML,
    messageMenuHTML,
    shouldGroup,
    unreadDividerHTML,
    initChatThread,
    wireReplyBar,
    showReplyBar,
    showEditBar,
    hideReplyBar,
    initAttachFilter,
    messageMatchesFilter,
    uploadWithProgress,
    compressImage,
    pendingBubbleHTML,
    initVoiceRecorder,
    initTypingIndicator,
    closeAllToolbarMenus,
    icons,
    doubleCheckHTML,
  };
})();
