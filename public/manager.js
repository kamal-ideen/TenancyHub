// Property Manager portal: a lighter view onto one landlord's tenants and
// maintenance requests. A manager doesn't own this data — everything here
// is scoped server-side to whichever landlord invited this account.

function formatNaira(n) {
  return "₦" + Number(n).toLocaleString("en-NG");
}
function formatDate(d) {
  return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
function frequencyLabel(rentFrequency) {
  return rentFrequency === "monthly" ? "month" : "year";
}
function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const statusLabels = { overdue: "Owing", due_soon: "Due soon", ok: "Paid up" };

function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

let dashboardData = null;
let activeChatTenantId = null;
let unreadCounts = {};

// ---- Who's logged in? ----
async function loadMe() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    window.location.href = "login.html";
    return null;
  }
  const user = await res.json();
  if (user.role !== "property_manager") {
    if (user.role === "landlord") window.location.href = "index.html";
    else if (user.role === "tenant") window.location.href = "tenant.html";
    else window.location.href = "login.html";
    return null;
  }
  document.getElementById("userChip").textContent = user.name;
  document.getElementById("unlinkedEmail").textContent = user.email;

  const accountName = document.getElementById("accountName");
  const accountEmail = document.getElementById("accountEmail");
  const accountAvatar = document.getElementById("accountAvatar");
  if (accountName) accountName.textContent = user.name;
  if (accountEmail) accountEmail.textContent = user.email || "";
  if (accountAvatar) accountAvatar.textContent = (user.name || "?").trim().charAt(0).toUpperCase();

  return user;
}

// ---- Dashboard ----
async function loadDashboard() {
  const res = await fetch("/api/manager/dashboard");
  if (!res.ok) {
    document.getElementById("unlinkedState").hidden = false;
    document.getElementById("linkedContent").hidden = true;
    return false;
  }
  dashboardData = await res.json();
  document.getElementById("unlinkedState").hidden = true;
  document.getElementById("linkedContent").hidden = false;
  document.getElementById("landlordName").textContent = dashboardData.landlordName;

  const countsRes = await fetch("/api/messages/unread-counts");
  unreadCounts = countsRes.ok ? await countsRes.json() : {};

  renderStats();
  renderTenants();
  renderMaintenance();
  renderPaymentStatus();
  renderConversationList();
  return true;
}

function renderStats() {
  const tenants = dashboardData.tenants;
  document.getElementById("statTotal").textContent = tenants.length;
  document.getElementById("statOverdue").textContent = tenants.filter((t) => t.status === "overdue").length;
  document.getElementById("statMaintenance").textContent = dashboardData.maintenance.filter((m) => m.status !== "done").length;
}

function tenantCardHTML(t) {
  const paidSoFar = t.rentAmount - (t.balanceDue != null ? t.balanceDue : t.rentAmount);
  const partialTag = paidSoFar > 0 && t.balanceDue > 0
    ? `<div class="tenant-sub" style="color: var(--blue-dark); font-weight: 600;">₦${paidSoFar.toLocaleString()} paid toward this cycle — ₦${t.balanceDue.toLocaleString()} remaining</div>`
    : "";
  const unread = unreadCounts[t.id] || 0;
  return `
    <div class="tenant-card ${t.status}" data-id="${t.id}">
      <div class="tenant-top">
        <div>
          <div class="tenant-name">${t.name}</div>
          <div class="tenant-sub">${t.propertyName}${t.unit ? " · " + t.unit : ""}</div>
        </div>
        <span class="badge ${t.status}">${statusLabels[t.status]}</span>
      </div>
      <div class="tenant-details">
        <span>Rent: ${formatNaira(t.rentAmount)}/${frequencyLabel(t.rentFrequency)}</span>
        <span>Due: ${formatDate(t.dueDate)}</span>
      </div>
      ${partialTag}
      <div class="tenant-actions">
        <button class="btn btn-paid" data-action="pay" data-id="${t.id}">Record payment</button>
        <button class="btn btn-ghost small-tag" data-action="open-chat" data-id="${t.id}">${ChatUI.icons.chat} Message${unread > 0 ? `<span class="msg-badge">${unread}</span>` : ""}</button>
      </div>
    </div>
  `;
}

function renderTenants() {
  const list = document.getElementById("tenantList");
  const empty = document.getElementById("tenantEmpty");
  const tenants = dashboardData.tenants;

  if (tenants.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const order = { overdue: 0, due_soon: 1, ok: 2 };
  const sorted = [...tenants].sort((a, b) => order[a.status] - order[b.status]);
  list.innerHTML = sorted.map(tenantCardHTML).join("");
}

function renderPaymentStatus() {
  const list = document.getElementById("paymentStatusList");
  const empty = document.getElementById("paymentStatusEmpty");
  const tenants = dashboardData.tenants;

  if (tenants.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const order = { overdue: 0, due_soon: 1, ok: 2 };
  const sorted = [...tenants].sort((a, b) => order[a.status] - order[b.status]);
  list.innerHTML = sorted.map(tenantCardHTML).join("");
}

// The inbox-style list of every tenant you can message, on the Messages page.
function renderConversationList() {
  const listEl = document.getElementById("conversationList");
  const emptyEl = document.getElementById("conversationEmpty");
  const tenants = dashboardData ? dashboardData.tenants : [];

  if (tenants.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const sorted = [...tenants].sort((a, b) => (unreadCounts[b.id] || 0) - (unreadCounts[a.id] || 0));
  listEl.innerHTML = sorted
    .map((t) => {
      const unread = unreadCounts[t.id] || 0;
      return `
        <button type="button" class="conversation-row ${t.id === activeChatTenantId ? "active" : ""}" data-action="open-chat" data-id="${t.id}">
          <span class="conversation-row-name">${t.name}${unread > 0 ? `<span class="msg-badge">${unread}</span>` : ""}</span>
          <span class="conversation-row-sub">${t.propertyName}${t.unit ? " · " + t.unit : ""}</span>
        </button>
      `;
    })
    .join("");
}

function selectConversation(tenantId) {
  const tenant = dashboardData.tenants.find((t) => t.id === tenantId);
  if (!tenant) return;

  activeChatTenantId = tenantId;
  delete unreadCounts[tenantId];
  cancelReply();
  cancelEdit();

  document.getElementById("chatCardTitle").textContent = tenant.name;
  document.getElementById("clearChatSelectionBtn").hidden = false;
  document.getElementById("chatEmptyState").hidden = true;
  document.getElementById("chatPanelBody").hidden = false;
  document.getElementById("chatWindow").innerHTML = "";

  renderConversationList();
  renderTenants();
  renderPaymentStatus();

  document.getElementById("messages").scrollIntoView({ behavior: "smooth", block: "start" });
  loadChat(tenantId);
}

document.getElementById("clearChatSelectionBtn").addEventListener("click", () => {
  activeChatTenantId = null;
  cancelReply();
  cancelEdit();
  document.getElementById("chatCardTitle").textContent = "Select a conversation";
  document.getElementById("clearChatSelectionBtn").hidden = true;
  document.getElementById("chatEmptyState").hidden = false;
  document.getElementById("chatPanelBody").hidden = true;
  renderConversationList();
});

function renderMaintenance() {
  const list = document.getElementById("maintenanceList");
  const empty = document.getElementById("maintenanceEmpty");
  const requests = dashboardData.maintenance;

  if (requests.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = requests
    .map(
      (r) => `
      <div class="maintenance-card" data-id="${r.id}">
        <div class="maintenance-info">
          <div class="m-desc">${r.description}</div>
          <div class="m-sub">${r.tenantName} · logged ${formatDate(r.dateCreated)}</div>
          ${r.imagePath ? `<img class="maintenance-thumb" src="${r.imagePath}" alt="Maintenance photo">` : ""}
        </div>
        <select class="status-select" data-action="maintenance-status" data-id="${r.id}">
          <option value="open" ${r.status === "open" ? "selected" : ""}>Open</option>
          <option value="in_progress" ${r.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="done" ${r.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </div>
    `
    )
    .join("");
}

document.getElementById("refreshLinkBtn").addEventListener("click", loadDashboard);

// ---- Actions ----
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "pay") {
    const tenant = dashboardData.tenants.find((t) => t.id === id);
    if (!tenant) return;
    const balanceDue = tenant.balanceDue != null ? tenant.balanceDue : tenant.rentAmount;
    document.getElementById("payModalTitle").textContent = `Record a payment — ${tenant.name}`;
    document.getElementById("payTenantId").value = tenant.id;
    document.getElementById("payAmountInput").value = balanceDue;
    const paidSoFar = tenant.rentAmount - balanceDue;
    document.getElementById("payModalSummary").innerHTML = `
      Rent per ${frequencyLabel(tenant.rentFrequency)}: <strong>${formatNaira(tenant.rentAmount)}</strong><br>
      ${paidSoFar > 0 ? `Already paid this cycle: <strong>${formatNaira(paidSoFar)}</strong><br>` : ""}
      Balance due: <strong>${formatNaira(balanceDue)}</strong>
    `;
    openModal("payModalOverlay");
  }

  if (btn.dataset.action === "open-chat") {
    selectConversation(id);
  }
});

document.addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-action='maintenance-status']");
  if (!select) return;
  await fetch(`/api/manager/maintenance/${select.dataset.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: select.value }),
  });
});

// ---- Messaging ----
let selectedChatFile = null;
let currentThreadMessages = [];
let replyingTo = null;
let editingMessage = null;
let chatAttachFilter = "all";
let pendingUnreadDividerId = null;
let pendingMessages = []; // optimistic bubbles: sending, uploading, or failed
let hasMoreOlder = false;
let oldestLoadedAt = null;
let loadingOlder = false;

function isPinned(m) {
  return !!(m.pinnedUntil && new Date(m.pinnedUntil) > new Date());
}

function renderPinnedBar(messages) {
  const bar = document.getElementById("pinnedBar");
  if (!bar) return;
  const pinned = messages.filter(isPinned);
  if (pinned.length === 0) { bar.innerHTML = ""; return; }
  bar.innerHTML = `
    <div class="pinned-bar">
      <div class="pinned-bar-title">${ChatUI.icons.pin} Pinned</div>
      ${pinned
        .map(
          (m) => `
        <div class="pinned-item">
          <div class="pinned-item-text">${escapeHtml(m.text) || (m.attachmentName ? ChatUI.icons.paperclip + " " + escapeHtml(m.attachmentName) : "")}</div>
          <div>
            <span class="pinned-item-meta">until ${new Date(m.pinnedUntil).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span>
            <button type="button" class="unpin-btn" data-unpin-id="${m.id}">Unpin</button>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

async function loadChat(tenantId) {
  const res = await fetch(`/api/messages/${tenantId}`);
  const data = await res.json();
  const messages = data.messages || [];
  currentThreadMessages = messages;
  pendingUnreadDividerId = data.firstUnreadId || null;
  hasMoreOlder = !!data.hasMore;
  oldestLoadedAt = messages.length ? messages[0].createdAt : null;
  renderPinnedBar(messages);
  renderChatWindow(messages);
}

async function loadOlderMessages() {
  if (!activeChatTenantId || !oldestLoadedAt || loadingOlder) return;
  loadingOlder = true;
  const win = document.getElementById("chatWindow");
  const prevScrollHeight = win.scrollHeight;
  const res = await fetch(`/api/messages/${activeChatTenantId}?before=${encodeURIComponent(oldestLoadedAt)}`);
  const data = await res.json();
  const older = data.messages || [];
  currentThreadMessages = [...older, ...currentThreadMessages];
  hasMoreOlder = !!data.hasMore;
  oldestLoadedAt = older.length ? older[0].createdAt : oldestLoadedAt;
  renderChatWindow(currentThreadMessages, prevScrollHeight);
  loadingOlder = false;
}

function renderChatWindow(messages, preserveScrollFrom) {
  const win = document.getElementById("chatWindow");
  const filtered = messages.filter((m) => ChatUI.messageMatchesFilter(m, chatAttachFilter));
  const myPending = pendingMessages.filter((p) => p.tenantId === activeChatTenantId);
  if (filtered.length === 0 && myPending.length === 0) {
    win.innerHTML = `<p class="empty-state" style="margin:0;">${chatAttachFilter === "all" ? "No messages yet — say hello!" : "Nothing here yet."}</p>`;
    return;
  }
  const messagesById = {};
  messages.forEach((m) => { messagesById[m.id] = m; });

  let lastDay = null;
  let prevMsg = null;
  const realHTML = filtered
    .map((m) => {
      const mine = m.senderRole === "landlord" || m.senderRole === "manager";
      const pinned = isPinned(m);
      const day = new Date(m.createdAt).toDateString();
      const divider = day !== lastDay ? ChatUI.dateDividerHTML(m.createdAt) : "";
      lastDay = day;
      const unreadDivider = pendingUnreadDividerId && m.id === pendingUnreadDividerId ? ChatUI.unreadDividerHTML() : "";
      const grouped = ChatUI.shouldGroup(prevMsg, m);
      prevMsg = m;
      return `
        ${divider}
        ${unreadDivider}
        <div class="chat-bubble-row ${mine ? "mine" : ""}" id="msg-${m.id}">
          <button type="button" class="pin-btn ${pinned ? "is-pinned" : ""}" data-pin-id="${m.id}" data-pinned="${pinned}" title="${pinned ? "Unpin" : "Pin this message"}">${ChatUI.icons.pin}</button>
          <div class="chat-bubble ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""}">
            ${grouped ? "" : `<div class="chat-sender">${mine ? "You" : escapeHtml(m.senderName)}</div>`}
            ${ChatUI.replyQuoteHTML(m, messagesById, escapeHtml)}
            ${ChatUI.cardHTML(m, escapeHtml, false)}
            ${ChatUI.attachmentHTML(m, escapeHtml)}
            ${m.text ? `<div>${escapeHtml(m.text)}</div>` : ""}
            <div class="chat-time">${timeAgo(m.createdAt)}${m.edited ? `<span class="chat-edited-label" title="Edited">(edited)</span>` : ""}${ChatUI.ticksHTML(m, mine)}</div>
            ${ChatUI.reactionsHTML(m)}
            ${ChatUI.messageMenuHTML(m)}
          </div>
        </div>
      `;
    })
    .join("");
  const pendingHTML = myPending.map((p) => ChatUI.pendingBubbleHTML(p, escapeHtml)).join("");
  const loadEarlierHTML = hasMoreOlder ? `<button type="button" class="chat-load-earlier" id="loadEarlierBtn">Load earlier messages</button>` : "";
  win.innerHTML = loadEarlierHTML + realHTML + pendingHTML;
  const loadEarlierBtn = document.getElementById("loadEarlierBtn");
  if (loadEarlierBtn) loadEarlierBtn.addEventListener("click", loadOlderMessages);

  if (preserveScrollFrom != null) {
    win.scrollTop = win.scrollHeight - preserveScrollFrom;
  } else {
    win.scrollTop = win.scrollHeight;
  }
}

// Chats can't be copied, forwarded, or right-clicked out of the app (a
// UI-level deterrent — paired with user-select:none in the CSS). The
// explicit "Copy" message action uses the Clipboard API directly, so it
// still works despite this.
const chatWindowEl = document.getElementById("chatWindow");
["copy", "cut", "contextmenu"].forEach((evt) => {
  chatWindowEl.addEventListener(evt, (e) => e.preventDefault());
});

// ---- Reply-to-message ----
function startReply(msg) {
  cancelEdit();
  replyingTo = msg;
  ChatUI.showReplyBar("chatReplyBar", msg, escapeHtml);
  document.getElementById("chatInput").focus();
}
function cancelReply() {
  replyingTo = null;
  ChatUI.hideReplyBar("chatReplyBar");
}

// ---- Edit-message mode ----
function startEdit(msg) {
  cancelReply();
  editingMessage = msg;
  document.getElementById("chatInput").value = msg.text || "";
  ChatUI.showEditBar("chatReplyBar");
  document.getElementById("chatInput").focus();
}
function cancelEdit() {
  if (editingMessage) document.getElementById("chatInput").value = "";
  editingMessage = null;
  ChatUI.hideReplyBar("chatReplyBar");
}
ChatUI.wireReplyBar("chatReplyBar", () => { cancelReply(); cancelEdit(); });

// ---- Reactions, reply, edit, copy, delete-for-me, quote-jump, and pending-bubble actions ----
ChatUI.initChatThread({
  windowId: "chatWindow",
  getMessages: () => currentThreadMessages,
  onReply: startReply,
  onEdit: startEdit,
  onReload: () => { if (activeChatTenantId) loadChat(activeChatTenantId); },
  onRetry: (tempId) => retryPending(tempId),
  onDiscard: (tempId) => { pendingMessages = pendingMessages.filter((p) => p.tempId !== tempId); renderChatWindow(currentThreadMessages); },
  onCancelUpload: (tempId) => { const p = pendingMessages.find((x) => x.tempId === tempId); if (p && p.cancel) p.cancel(); },
});

// ---- Filter the open thread to All / Photos / Documents ----
// ---- Typing indicator ----
ChatUI.initTypingIndicator({
  inputId: "chatInput",
  indicatorId: "chatTypingIndicator",
  isActive: () => !!activeChatTenantId,
  getPingUrl: () => (activeChatTenantId ? `/api/messages/${activeChatTenantId}/typing` : null),
  getStatusUrl: () => (activeChatTenantId ? `/api/messages/${activeChatTenantId}/typing-status` : null),
});

ChatUI.initAttachFilter("chatFilterBar", (filter) => {
  chatAttachFilter = filter;
  renderChatWindow(currentThreadMessages);
});

document.addEventListener("click", async (e) => {
  const pinBtn = e.target.closest(".pin-btn");
  if (pinBtn) {
    if (pinBtn.dataset.pinned === "true") {
      await fetch(`/api/messages/${pinBtn.dataset.pinId}/unpin`, { method: "POST" });
    } else {
      const choice = window.prompt("Pin this message for how many days? Type 7 or 30.", "7");
      if (choice === null) return;
      const duration = choice.trim() === "30" ? "30d" : "7d";
      await fetch(`/api/messages/${pinBtn.dataset.pinId}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration }),
      });
    }
    if (activeChatTenantId) loadChat(activeChatTenantId);
    return;
  }
  const unpinBtn = e.target.closest(".unpin-btn");
  if (unpinBtn) {
    await fetch(`/api/messages/${unpinBtn.dataset.unpinId}/unpin`, { method: "POST" });
    if (activeChatTenantId) loadChat(activeChatTenantId);
  }
});

// ---- Attaching a photo, video, or PDF (camera / gallery / document) ----
ChatUI.initAttachMenu({
  attachBtnId: "chatAttachBtn",
  menuId: "chatAttachMenu",
  cameraInputId: "chatCameraInput",
  mediaInputId: "chatMediaInput",
  docInputId: "chatDocInput",
  previewId: "chatAttachPreview",
  escapeHtml,
  onSelect: (file) => { selectedChatFile = file; },
  onClear: () => { selectedChatFile = null; },
});

// ---- Voice notes: tap to record, tap again to stop and send ----
ChatUI.initVoiceRecorder({
  micBtnId: "chatMicBtn",
  indicatorId: "chatVoiceIndicator",
  onRecorded: (blob, mimeType) => {
    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    sendFile(new File([blob], `voice-note.${ext}`, { type: mimeType }), "", replyingTo ? replyingTo.id : null);
    cancelReply();
  },
});

// ---- Broadcast an announcement to every tenant at once ----
const broadcastBtn = document.getElementById("broadcastBtn");
if (broadcastBtn) {
  broadcastBtn.addEventListener("click", async () => {
    const count = dashboardData.tenants.length;
    if (count === 0) { alert("There are no tenants to announce to yet."); return; }
    const text = window.prompt(`Send an announcement to all ${count} tenant${count === 1 ? "" : "s"}. What do you want to say?`);
    if (!text || !text.trim()) return;
    if (!window.confirm(`Send this to all ${count} tenant${count === 1 ? "" : "s"}?\n\n"${text.trim()}"`)) return;
    const res = await fetch("/api/messages/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Couldn't send the announcement."); return; }
    alert(`Sent to ${data.recipientCount} tenant${data.recipientCount === 1 ? "" : "s"}.`);
    if (activeChatTenantId) loadChat(activeChatTenantId);
    loadDashboard();
  });
}

// ---- Search across every conversation ----
const convSearchInput = document.getElementById("convSearchInput");
const convSearchResults = document.getElementById("convSearchResults");
if (convSearchInput && convSearchResults) {
  let searchDebounce = null;
  convSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = convSearchInput.value.trim();
    if (!q) { convSearchResults.hidden = true; convSearchResults.innerHTML = ""; return; }
    searchDebounce = setTimeout(async () => {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(q)}`);
      const results = res.ok ? await res.json() : [];
      convSearchResults.hidden = false;
      if (results.length === 0) {
        convSearchResults.innerHTML = `<div class="chat-search-empty">No messages found for "${escapeHtml(q)}"</div>`;
        return;
      }
      convSearchResults.innerHTML = results
        .map(
          (r) => `
          <button type="button" class="chat-search-result" data-tenant-id="${r.tenantId}" data-msg-id="${r.id}">
            <div class="chat-search-result-top"><span>${escapeHtml(r.tenantName)}</span><span>${new Date(r.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span></div>
            <div class="chat-search-result-text">${escapeHtml(r.text)}</div>
          </button>
        `
        )
        .join("");
    }, 300);
  });
  convSearchResults.addEventListener("click", (e) => {
    const btn = e.target.closest(".chat-search-result");
    if (!btn) return;
    convSearchResults.hidden = true;
    convSearchInput.value = "";
    selectConversation(btn.dataset.tenantId);
  });
}

// ---- Send a rent receipt as a linked card, instead of a raw PDF ----
const receiptBtn = document.getElementById("chatReceiptBtn");
const receiptMenu = document.getElementById("chatReceiptMenu");
if (receiptBtn && receiptMenu) {
  receiptBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!activeChatTenantId) return;
    const willOpen = receiptMenu.hidden;
    if (willOpen) ChatUI.closeAllToolbarMenus(receiptMenu);
    receiptMenu.hidden = !willOpen;
    if (!willOpen) return;
    receiptMenu.innerHTML = `<div class="chat-receipt-menu-empty">Loading payments…</div>`;
    const res = await fetch(`/api/tenants/${activeChatTenantId}/payments`);
    const payments = res.ok ? await res.json() : [];
    if (payments.length === 0) {
      receiptMenu.innerHTML = `<div class="chat-receipt-menu-empty">No payments recorded yet for this tenant.</div>`;
      return;
    }
    receiptMenu.innerHTML = payments
      .slice(0, 8)
      .map(
        (p) => `
        <div class="chat-receipt-menu-item" data-payment-id="${p.id}">
          <span>
            <div class="amount">₦${Number(p.amount).toLocaleString("en-NG")}</div>
            <div class="sub">${new Date(p.date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })} · ${escapeHtml(p.receiptNumber)}</div>
          </span>
          <span>Send</span>
        </div>
      `
      )
      .join("");
  });
  let sendingReceipt = false;
  receiptMenu.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-payment-id]");
    if (!item || !activeChatTenantId || sendingReceipt) return;
    sendingReceipt = true;
    receiptMenu.hidden = true;
    try {
      await fetch(`/api/messages/${activeChatTenantId}/send-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: item.dataset.paymentId }),
      });
      loadChat(activeChatTenantId);
    } finally {
      sendingReceipt = false;
    }
  });
  document.addEventListener("click", (e) => {
    if (!receiptMenu.hidden && !receiptMenu.contains(e.target) && e.target !== receiptBtn) receiptMenu.hidden = true;
  });
}

// ---- Sending a file, with upload progress shown live and retry on failure ----
async function sendFile(file, text, replyToId) {
  const compressed = await ChatUI.compressImage(file);
  const tempId = "temp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const pending = { tempId, tenantId: activeChatTenantId, text, replyToId, file: compressed, fileName: compressed.name, progress: 0, status: "sending" };
  pendingMessages.push(pending);
  renderChatWindow(currentThreadMessages);
  runUpload(pending);
}

function runUpload(pending) {
  pending.status = "sending";
  pending.progress = 0;
  const formData = new FormData();
  formData.append("file", pending.file);
  if (pending.text) formData.append("text", pending.text);
  if (pending.replyToId) formData.append("replyToId", pending.replyToId);

  const { promise, cancel } = ChatUI.uploadWithProgress(`/api/messages/${pending.tenantId}/upload`, formData, (pct) => {
    pending.progress = pct;
    const bar = document.querySelector(`#pending-${pending.tempId} .chat-pending-progress-bar`);
    if (bar) bar.style.width = pct + "%";
  });
  pending.cancel = cancel;

  promise
    .then(() => {
      pendingMessages = pendingMessages.filter((p) => p.tempId !== pending.tempId);
      if (pending.tenantId === activeChatTenantId) loadChat(pending.tenantId);
    })
    .catch((err) => {
      if (err.message === "__cancelled__") {
        pendingMessages = pendingMessages.filter((p) => p.tempId !== pending.tempId);
      } else {
        pending.status = "error";
        pending.errorMsg = err.message;
      }
      if (pending.tenantId === activeChatTenantId) renderChatWindow(currentThreadMessages);
    });
}

function retryPending(tempId) {
  const pending = pendingMessages.find((p) => p.tempId === tempId);
  if (pending) runUpload(pending);
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeChatTenantId) return;
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  const chatAttachPreview = document.getElementById("chatAttachPreview");

  if (editingMessage) {
    if (!text) return;
    await fetch(`/api/messages/${editingMessage.id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    input.value = "";
    cancelEdit();
    loadChat(activeChatTenantId);
    return;
  }

  const replyToId = replyingTo ? replyingTo.id : null;

  if (selectedChatFile) {
    const file = selectedChatFile;
    selectedChatFile = null;
    document.getElementById("chatCameraInput").value = "";
    document.getElementById("chatMediaInput").value = "";
    document.getElementById("chatDocInput").value = "";
    chatAttachPreview.hidden = true;
    chatAttachPreview.innerHTML = "";
    input.value = "";
    cancelReply();
    sendFile(file, text, replyToId);
    return;
  }

  if (!text) return;
  const tempId = "temp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const pending = { tempId, tenantId: activeChatTenantId, text, status: "sending" };
  pendingMessages.push(pending);
  input.value = "";
  cancelReply();
  renderChatWindow(currentThreadMessages);

  try {
    const res = await fetch(`/api/messages/${activeChatTenantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pending.text, replyToId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't send that message");
    pendingMessages = pendingMessages.filter((p) => p.tempId !== tempId);
    if (pending.tenantId === activeChatTenantId) loadChat(pending.tenantId);
  } catch (err) {
    pending.status = "error";
    pending.errorMsg = err.message;
    if (pending.tenantId === activeChatTenantId) renderChatWindow(currentThreadMessages);
  }
});

// ---- Generic modal close ----
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "login.html";
});

// ---- Record a payment (full or partial) ----
document.getElementById("payForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantId = document.getElementById("payTenantId").value;
  const amount = document.getElementById("payAmountInput").value;

  const res = await fetch(`/api/manager/tenants/${tenantId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Couldn't record that payment.");
    return;
  }

  closeModal("payModalOverlay");
  loadDashboard();
});

// ---- Init ----
(async function init() {
  const user = await loadMe();
  if (!user) return;
  await loadDashboard();
})();
