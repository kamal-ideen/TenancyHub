// Tenant portal: view your tenancy, report a payment, sign agreements,
// and log maintenance requests. Everything here is scoped server-side to
// whichever tenant record is linked to this account — there's no tenant
// picker because a tenant only ever sees their own tenancy.

function formatNaira(n) {
  return "₦" + Number(n).toLocaleString("en-NG");
}
function formatDate(d) {
  return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
function frequencyLabel(rentFrequency) {
  return rentFrequency === "monthly" ? "month" : "year";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const statusLabels = { overdue: "Owing", due_soon: "Due soon", ok: "Paid up" };

let currentTenant = null;

function openModal(id) {
  document.getElementById(id).hidden = false;
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
}

// ---- Who's logged in? ----
async function loadMe() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    window.location.href = "login.html";
    return null;
  }
  const user = await res.json();
  if (user.role !== "tenant") {
    // Somewhere they shouldn't be — send them to the right place.
    if (user.role === "landlord") window.location.href = "index.html";
    else if (user.role === "property_manager") window.location.href = "manager.html";
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

// ---- My tenancy ----
async function loadTenancy() {
  const res = await fetch("/api/tenant/me");
  const data = await res.json();

  if (!data.linked) {
    document.getElementById("unlinkedState").hidden = false;
    document.getElementById("linkedContent").hidden = true;
    return false;
  }

  currentTenant = data;
  document.getElementById("unlinkedState").hidden = true;
  document.getElementById("linkedContent").hidden = false;

  document.getElementById("tenancyProperty").textContent =
    data.propertyName + (data.unit ? " · " + data.unit : "");
  document.getElementById("tenancyAddress").textContent = data.propertyAddress || "";
  document.getElementById("tenancyAgent").textContent = data.agentName
    ? "Rent collected by: " + data.agentName
    : "";
  document.getElementById("tenancyRent").textContent =
    "Rent: " + formatNaira(data.rentAmount) + "/" + frequencyLabel(data.rentFrequency);
  document.getElementById("tenancyDue").textContent = "Due: " + formatDate(data.dueDate);

  const balanceRow = document.getElementById("tenancyBalanceRow");
  const paidSoFar = data.rentAmount - (data.balanceDue != null ? data.balanceDue : data.rentAmount);
  if (paidSoFar > 0 && data.balanceDue > 0) {
    balanceRow.hidden = false;
    balanceRow.textContent = `₦${paidSoFar.toLocaleString()} paid toward this cycle — ₦${data.balanceDue.toLocaleString()} remaining`;
  } else {
    balanceRow.hidden = true;
  }

  const badge = document.getElementById("tenancyStatusBadge");
  badge.textContent = statusLabels[data.status];
  badge.className = "badge " + data.status;
  document.getElementById("tenancyCard").className = "tenant-card " + data.status;

  const notifyBtn = document.getElementById("notifyPaymentBtn");
  const pendingNote = document.getElementById("pendingClaimNote");
  if (data.pendingPaymentClaim) {
    notifyBtn.disabled = true;
    notifyBtn.textContent = "Payment reported";
    pendingNote.hidden = false;
    pendingNote.textContent = `Payment of ₦${(data.pendingPaymentClaim.amount || data.rentAmount).toLocaleString()} reported — waiting for your landlord to confirm.`;
  } else {
    notifyBtn.disabled = false;
    notifyBtn.textContent = "I've made this payment";
    pendingNote.hidden = true;
  }

  const deposit = data.deposit;
  const depositAmountStat = document.getElementById("depositAmountStat");
  const depositStatusStat = document.getElementById("depositStatusStat");
  if (!deposit || deposit.status === "none") {
    depositAmountStat.textContent = "—";
    depositStatusStat.textContent = "No deposit on file";
  } else if (deposit.status === "refunded") {
    depositAmountStat.textContent = formatNaira(deposit.refundedAmount);
    depositStatusStat.textContent = "Deposit refunded";
  } else {
    depositAmountStat.textContent = formatNaira(deposit.netRefundable);
    depositStatusStat.textContent = "Deposit held (refundable)";
  }

  return true;
}

document.getElementById("refreshLinkBtn").addEventListener("click", loadTenancy);

document.getElementById("notifyPaymentBtn").addEventListener("click", () => {
  if (!currentTenant) return;
  const balanceDue = currentTenant.balanceDue != null ? currentTenant.balanceDue : currentTenant.rentAmount;
  const paidSoFar = currentTenant.rentAmount - balanceDue;
  document.getElementById("payClaimAmountInput").value = balanceDue;
  document.getElementById("payClaimSummary").innerHTML = `
    Rent per ${frequencyLabel(currentTenant.rentFrequency)}: <strong>${formatNaira(currentTenant.rentAmount)}</strong><br>
    ${paidSoFar > 0 ? `Already paid this cycle: <strong>${formatNaira(paidSoFar)}</strong><br>` : ""}
    Balance due: <strong>${formatNaira(balanceDue)}</strong>
  `;
  openModal("payClaimModalOverlay");
});

document.getElementById("payClaimForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = document.getElementById("payClaimAmountInput").value;

  const res = await fetch("/api/tenant/payments/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Couldn't report that payment.");
    return;
  }

  closeModal("payClaimModalOverlay");
  loadTenancy();
});

// ---- Lease agreements ----
async function loadAgreements() {
  const res = await fetch("/api/tenant/agreements");
  const agreements = await res.json();

  const list = document.getElementById("agreementList");
  const empty = document.getElementById("agreementEmpty");

  if (agreements.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = agreements
    .map((a) => {
      const signedNote = a.status === "signed"
        ? `<div class="agreement-signed-note">Signed by ${a.signedByName} on ${formatDate(a.signedAt)}</div>`
        : "";
      const signButton = a.status === "unsigned"
        ? `<button class="btn btn-paid" data-action="open-sign" data-id="${a.id}">Sign now</button>`
        : "";
      return `
        <div class="maintenance-card" data-id="${a.id}">
          <div class="maintenance-info">
            <div class="m-desc">${a.title}</div>
            ${signedNote}
          </div>
          <div class="tenant-actions" style="margin-top:0;">
            <span class="badge ${a.status}">${a.status === "signed" ? "Signed" : "Unsigned"}</span>
            ${signButton}
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("[data-action='open-sign']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const agreement = agreements.find((a) => a.id === btn.dataset.id);
      document.getElementById("signModalTitle").textContent = "Sign: " + agreement.title;
      document.getElementById("signAgreementText").textContent = agreement.text;
      document.getElementById("signAgreementId").value = agreement.id;
      openModal("signModalOverlay");
    });
  });
}

document.getElementById("signForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const agreementId = document.getElementById("signAgreementId").value;
  const name = document.getElementById("signNameInput").value;

  await fetch(`/api/tenant/agreements/${agreementId}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  e.target.reset();
  closeModal("signModalOverlay");
  loadAgreements();
});

// ---- Maintenance requests ----
async function loadMaintenance() {
  const res = await fetch("/api/tenant/maintenance");
  const requests = await res.json();

  const list = document.getElementById("maintenanceList");
  const empty = document.getElementById("maintenanceEmpty");

  if (requests.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const statusText = { open: "Open", in_progress: "In progress", done: "Done" };

  list.innerHTML = requests
    .map(
      (r) => `
      <div class="maintenance-card" data-id="${r.id}">
        <div class="maintenance-info">
          <div class="m-desc">${r.description}</div>
          <div class="m-sub">Logged ${formatDate(r.dateCreated)}</div>
          ${r.imagePath ? `<img class="maintenance-thumb" src="${r.imagePath}" alt="Maintenance photo">` : ""}
        </div>
        <span class="badge ${r.status === "done" ? "ok" : r.status === "in_progress" ? "due_soon" : "overdue"}">
          ${statusText[r.status]}
        </span>
      </div>
    `
    )
    .join("");
}

document.getElementById("addMaintenanceBtn").addEventListener("click", () => openModal("maintenanceModalOverlay"));

document.getElementById("maintenanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);

  await fetch("/api/tenant/maintenance", {
    method: "POST",
    body: formData,
  });

  e.target.reset();
  closeModal("maintenanceModalOverlay");
  loadMaintenance();
});

// ---- Payment history ----
async function loadPayments() {
  const res = await fetch("/api/tenant/payments");
  const payments = await res.json();

  const list = document.getElementById("paymentList");
  const empty = document.getElementById("paymentEmpty");

  if (payments.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = payments
    .map(
      (p) => `
      <div class="payment-row">
        <span>${formatDate(p.date)} — ${formatNaira(p.amount)}${p.balanceAfter > 0 ? ` <span style="color: var(--blue-dark); font-weight: 600;">(partial — ${formatNaira(p.balanceAfter)} left)</span>` : ""}</span>
        <a class="receipt-link" href="/api/tenant/payments/${p.id}/receipt" target="_blank" rel="noopener">Download receipt</a>
      </div>
    `
    )
    .join("");
}

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

function renderChat(messages) {
  currentThreadMessages = messages;
  renderPinnedBar(messages);
  renderChatWindow(messages);
}

function renderChatWindow(messages, preserveScrollFrom) {
  const win = document.getElementById("chatWindow");
  const filtered = messages.filter((m) => ChatUI.messageMatchesFilter(m, chatAttachFilter));
  if (filtered.length === 0 && pendingMessages.length === 0) {
    win.innerHTML = `<p class="empty-state" style="margin:0;">${chatAttachFilter === "all" ? "No messages yet — say hello!" : "Nothing here yet."}</p>`;
    return;
  }
  const messagesById = {};
  messages.forEach((m) => { messagesById[m.id] = m; });

  let lastDay = null;
  let prevMsg = null;
  const realHTML = filtered
    .map((m) => {
      const mine = m.senderRole === "tenant";
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
            ${ChatUI.cardHTML(m, escapeHtml, true)}
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
  const pendingHTML = pendingMessages.map((p) => ChatUI.pendingBubbleHTML(p, escapeHtml)).join("");
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

async function loadChat() {
  const res = await fetch("/api/tenant/messages");
  const data = await res.json();
  pendingUnreadDividerId = data.firstUnreadId || null;
  hasMoreOlder = !!data.hasMore;
  const messages = data.messages || [];
  oldestLoadedAt = messages.length ? messages[0].createdAt : null;
  renderChat(messages);
}

async function loadOlderMessages() {
  if (!oldestLoadedAt || loadingOlder) return;
  loadingOlder = true;
  const win = document.getElementById("chatWindow");
  const prevScrollHeight = win.scrollHeight;
  const res = await fetch(`/api/tenant/messages?before=${encodeURIComponent(oldestLoadedAt)}`);
  const data = await res.json();
  const older = data.messages || [];
  currentThreadMessages = [...older, ...currentThreadMessages];
  hasMoreOlder = !!data.hasMore;
  oldestLoadedAt = older.length ? older[0].createdAt : oldestLoadedAt;
  renderChatWindow(currentThreadMessages, prevScrollHeight);
  loadingOlder = false;
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
  onReload: () => loadChat(),
  onRetry: (tempId) => retryPending(tempId),
  onDiscard: (tempId) => { pendingMessages = pendingMessages.filter((p) => p.tempId !== tempId); renderChatWindow(currentThreadMessages); },
  onCancelUpload: (tempId) => { const p = pendingMessages.find((x) => x.tempId === tempId); if (p && p.cancel) p.cancel(); },
});

// ---- Filter the thread to All / Photos / Documents ----
// ---- Typing indicator ----
ChatUI.initTypingIndicator({
  inputId: "chatInput",
  indicatorId: "chatTypingIndicator",
  isActive: () => true,
  getPingUrl: () => "/api/tenant/messages/typing",
  getStatusUrl: () => "/api/tenant/messages/typing-status",
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
    loadChat();
    return;
  }
  const unpinBtn = e.target.closest(".unpin-btn");
  if (unpinBtn) {
    await fetch(`/api/messages/${unpinBtn.dataset.unpinId}/unpin`, { method: "POST" });
    loadChat();
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
// ---- Search within your own conversation ----
const convSearchInput = document.getElementById("convSearchInput");
const convSearchResults = document.getElementById("convSearchResults");
const convSearchClear = document.getElementById("convSearchClear");
if (convSearchInput && convSearchResults) {
  let searchDebounce = null;
  convSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = convSearchInput.value.trim();
    if (convSearchClear) convSearchClear.hidden = !q;
    if (!q) { convSearchResults.hidden = true; convSearchResults.innerHTML = ""; return; }
    searchDebounce = setTimeout(async () => {
      const res = await fetch(`/api/tenant/messages/search?q=${encodeURIComponent(q)}`);
      const results = res.ok ? await res.json() : [];
      convSearchResults.hidden = false;
      if (results.length === 0) {
        convSearchResults.innerHTML = `<div class="chat-search-empty">No messages found for "${escapeHtml(q)}"</div>`;
        return;
      }
      convSearchResults.innerHTML = results
        .map(
          (r) => `
          <button type="button" class="chat-search-result" data-msg-id="${r.id}">
            <div class="chat-search-result-top"><span>${escapeHtml(r.senderName)}</span><span>${new Date(r.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span></div>
            <div class="chat-search-result-text">${escapeHtml(r.text)}</div>
          </button>
        `
        )
        .join("");
    }, 300);
  });
  if (convSearchClear) {
    convSearchClear.addEventListener("click", () => {
      convSearchInput.value = "";
      convSearchClear.hidden = true;
      convSearchResults.hidden = true;
      convSearchResults.innerHTML = "";
    });
  }
  convSearchResults.addEventListener("click", async (e) => {
    const btn = e.target.closest(".chat-search-result");
    if (!btn) return;
    convSearchResults.hidden = true;
    const targetId = btn.dataset.msgId;
    // The message might be further back than what's currently loaded —
    // keep loading older pages (bounded) until we find it or run out.
    for (let attempts = 0; attempts < 15 && !document.getElementById(`msg-${targetId}`); attempts++) {
      if (!hasMoreOlder) break;
      await loadOlderMessages();
    }
    const target = document.getElementById(`msg-${targetId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("chat-flash");
      setTimeout(() => target.classList.remove("chat-flash"), 1200);
    }
  });
}

ChatUI.initVoiceRecorder({
  micBtnId: "chatMicBtn",
  indicatorId: "chatVoiceIndicator",
  onRecorded: (blob, mimeType) => {
    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    sendFile(new File([blob], `voice-note.${ext}`, { type: mimeType }), "", replyingTo ? replyingTo.id : null);
    cancelReply();
  },
});

// ---- Sending a file, with upload progress shown live and retry on failure ----
async function sendFile(file, text, replyToId) {
  const compressed = await ChatUI.compressImage(file);
  const tempId = "temp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const pending = { tempId, text, replyToId, file: compressed, fileName: compressed.name, progress: 0, status: "sending" };
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

  const { promise, cancel } = ChatUI.uploadWithProgress("/api/tenant/messages/upload", formData, (pct) => {
    pending.progress = pct;
    const bar = document.querySelector(`#pending-${pending.tempId} .chat-pending-progress-bar`);
    if (bar) bar.style.width = pct + "%";
  });
  pending.cancel = cancel;

  promise
    .then(() => {
      pendingMessages = pendingMessages.filter((p) => p.tempId !== pending.tempId);
      loadChat();
    })
    .catch((err) => {
      if (err.message === "__cancelled__") {
        pendingMessages = pendingMessages.filter((p) => p.tempId !== pending.tempId);
      } else {
        pending.status = "error";
        pending.errorMsg = err.message;
      }
      renderChatWindow(currentThreadMessages);
    });
}

function retryPending(tempId) {
  const pending = pendingMessages.find((p) => p.tempId === tempId);
  if (pending) runUpload(pending);
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
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
    loadChat();
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
  const pending = { tempId, text, status: "sending" };
  pendingMessages.push(pending);
  input.value = "";
  cancelReply();
  renderChatWindow(currentThreadMessages);

  try {
    const res = await fetch("/api/tenant/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pending.text, replyToId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't send that message");
    pendingMessages = pendingMessages.filter((p) => p.tempId !== tempId);
    loadChat();
  } catch (err) {
    pending.status = "error";
    pending.errorMsg = err.message;
    renderChatWindow(currentThreadMessages);
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

// ---- Init ----
(async function init() {
  const user = await loadMe();
  if (!user) return;
  const linked = await loadTenancy();
  if (linked) {
    loadAgreements();
    loadMaintenance();
    loadPayments();
    loadChat();
    setInterval(loadChat, 15000); // light polling so new landlord replies show up
  }
})();
