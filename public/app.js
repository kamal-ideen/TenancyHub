// TenancyHub frontend — talks to our server using fetch()

// ---- Auth guard: check who's logged in before showing anything ----
let currentUser = null;

async function checkAuth() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    window.location.href = "login.html";
    return false;
  }
  currentUser = await res.json();
  if (currentUser.role !== "landlord") {
    if (currentUser.role === "tenant") window.location.href = "tenant.html";
    else if (currentUser.role === "property_manager") window.location.href = "manager.html";
    else window.location.href = "login.html";
    return false;
  }
  document.getElementById("userChip").textContent = `${currentUser.name} (Landlord)`;

  const accountName = document.getElementById("accountName");
  const accountEmail = document.getElementById("accountEmail");
  const accountAvatar = document.getElementById("accountAvatar");
  if (accountName) accountName.textContent = currentUser.name;
  if (accountEmail) accountEmail.textContent = currentUser.email || "";
  if (accountAvatar) accountAvatar.textContent = (currentUser.name || "?").trim().charAt(0).toUpperCase();

  return true;
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "login.html";
});

// ---- Notifications ----
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

async function loadNotifications() {
  const res = await fetch("/api/notifications");
  const notifications = await res.json();

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badge = document.getElementById("notificationBadge");
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? "9+" : unreadCount;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const listEl = document.getElementById("notificationListPanel");
  const emptyEl = document.getElementById("notificationEmpty");

  if (notifications.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  listEl.innerHTML = notifications
    .map(
      (n) => `
      <div class="notification-item ${n.read ? "" : "unread"}" data-action="read-notification" data-id="${n.id}">
        ${n.message}
        <div class="n-time">${timeAgo(n.createdAt)}</div>
      </div>
    `
    )
    .join("");
}

document.getElementById("notificationBellBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const panel = document.getElementById("notificationPanel");
  panel.hidden = !panel.hidden;
});

document.addEventListener("click", (e) => {
  const panel = document.getElementById("notificationPanel");
  const bell = document.getElementById("notificationBellBtn");
  if (!panel.hidden && !panel.contains(e.target) && e.target !== bell && !bell.contains(e.target)) {
    panel.hidden = true;
  }
});

document.getElementById("markAllReadBtn").addEventListener("click", async () => {
  await fetch("/api/notifications/read-all", { method: "POST" });
  loadNotifications();
});

const tenantList = document.getElementById("tenantList");
const emptyState = document.getElementById("emptyState");
const statTotal = document.getElementById("statTotal");
const statOverdue = document.getElementById("statOverdue");
const statOwed = document.getElementById("statOwed");
const propertyFilter = document.getElementById("propertyFilter");
const statusFilter = document.getElementById("statusFilter");
const tenantSearchInput = document.getElementById("tenantSearchInput");

const remindersSection = document.getElementById("remindersSection");
const reminderGroups = document.getElementById("reminderGroups");

const maintenanceList = document.getElementById("maintenanceList");
const maintenanceEmpty = document.getElementById("maintenanceEmpty");

const agreementList = document.getElementById("agreementList");
const agreementEmpty = document.getElementById("agreementEmpty");

const agentList = document.getElementById("agentList");
const agentEmpty = document.getElementById("agentEmpty");

const propertyGrid = document.getElementById("propertyGrid");
const propertyEmpty = document.getElementById("propertyEmpty");

let allTenants = [];
let allProperties = [];
let allCollections = [];

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

// Turn a Nigerian phone number into the format WhatsApp links need
function cleanPhoneForWhatsApp(phone) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "234" + digits.slice(1);
  return digits;
}

function whatsappLink(tenant) {
  const number = cleanPhoneForWhatsApp(tenant.phone);
  const rentWord = tenant.rentFrequency === "monthly" ? "monthly rent" : "annual rent";
  const message =
    `Hello ${tenant.name}, this is a friendly reminder that your ${rentWord} of ${formatNaira(tenant.rentAmount)} ` +
    `for ${tenant.propertyName || "your unit"} was due on ${formatDate(tenant.dueDate)}. ` +
    `Kindly let us know when we can expect payment. Thank you!`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

const statusLabels = { overdue: "Owing", due_soon: "Due soon", ok: "Paid up" };

const decisionLabels = { pending: "Screening: Pending", approved: "Screening: Approved", declined: "Screening: Declined" };
const decisionClass = { pending: "unsigned", approved: "signed", declined: "overdue" };

let unreadCounts = {};

function tenantCardHTML(t) {
  const agentTag = t.agentName ? `<div class="tenant-sub">Agent: ${t.agentName}</div>` : "";
  const unread = unreadCounts[t.id] || 0;
  const messageTag = `<button class="btn btn-ghost small-tag" data-action="open-chat" data-id="${t.id}">${ChatUI.icons.chat} Message${unread > 0 ? `<span class="msg-badge">${unread}</span>` : ""}</button>`;
  const paymentsTag = `<button class="btn btn-ghost small-tag" data-action="open-payments" data-id="${t.id}">${ChatUI.icons.receipt} Payments</button>`;
  const activityTag = `<button class="btn btn-ghost small-tag" data-action="open-activity" data-id="${t.id}">${ChatUI.icons.document} Activity</button>`;
  const documentsTag = `<button class="btn btn-ghost small-tag" data-action="open-documents" data-id="${t.id}">${ChatUI.icons.folder} Documents</button>`;
  const depositTag = t.deposit && t.deposit.status !== "none"
    ? `<button class="btn btn-ghost small-tag" data-action="open-deposit" data-id="${t.id}">Deposit: ${t.deposit.status === "refunded" ? "Refunded" : formatNaira(t.deposit.netRefundable) + " held"}</button>`
    : `<button class="btn btn-ghost small-tag" data-action="open-deposit" data-id="${t.id}">+ Add deposit</button>`;
  const screeningDecision = (t.screening && t.screening.decision) || "pending";
  const screeningTag = `<button class="btn btn-ghost small-tag ${decisionClass[screeningDecision]}" data-action="open-screening" data-id="${t.id}">${decisionLabels[screeningDecision]}</button>`;
  const paidSoFar = t.rentAmount - (t.balanceDue != null ? t.balanceDue : t.rentAmount);
  const partialTag = paidSoFar > 0 && t.balanceDue > 0
    ? `<div class="tenant-sub" style="color: var(--blue-dark); font-weight: 600;">₦${paidSoFar.toLocaleString()} paid toward this cycle — ₦${t.balanceDue.toLocaleString()} remaining</div>`
    : "";

  return `
    <div class="tenant-card ${t.status}" data-id="${t.id}">
      <div class="tenant-top">
        <div>
          <div class="tenant-name">${t.name}</div>
          <div class="tenant-sub">${t.propertyName}${t.unit ? " · " + t.unit : ""}</div>
          ${agentTag}
        </div>
        <span class="badge ${t.status}">${statusLabels[t.status]}</span>
      </div>
      <div class="tenant-details">
        <span>Rent: ${formatNaira(t.rentAmount)}/${frequencyLabel(t.rentFrequency)}</span>
        <span>Due: ${formatDate(t.dueDate)}</span>
      </div>
      ${partialTag}
      <div class="tenant-actions">
        <a class="btn btn-remind" href="${whatsappLink(t)}" target="_blank" rel="noopener">Remind on WhatsApp</a>
        ${t.email ? `<button class="btn btn-remind" style="background: var(--blue);" data-action="remind-email" data-id="${t.id}">Email reminder</button>` : ""}
        <button class="btn btn-paid" data-action="pay" data-id="${t.id}">Record payment</button>
        <button class="btn btn-ghost small-tag" data-action="edit-tenant" data-id="${t.id}">Edit</button>
        <button class="btn btn-delete" data-action="delete" data-id="${t.id}">Remove</button>
      </div>
      <div class="tenant-actions" style="margin-top:8px;">
        ${screeningTag}
        ${depositTag}
        ${messageTag}
        ${paymentsTag}
        ${activityTag}
        ${documentsTag}
      </div>
    </div>
  `;
}

// ---- Load properties (used for the filter dropdown, tenant form, and the property grid) ----
function renderGallery(property) {
  const grid = document.getElementById("galleryGrid");
  const images = property.images || [];
  if (images.length === 0) {
    grid.innerHTML = `<p class="empty-state" style="margin:0;">No extra photos yet — add some below.</p>`;
    return;
  }
  grid.innerHTML = images
    .map(
      (img) => `
      <div class="gallery-thumb">
        <img src="${img.path}" alt="Property photo">
        <button type="button" class="gallery-thumb-remove" data-remove-photo="${img.id}" aria-label="Remove photo">${ChatUI.icons.close}</button>
      </div>
    `
    )
    .join("");
}

document.getElementById("galleryUploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const propertyId = document.getElementById("galleryPropertyId").value;
  const input = document.getElementById("galleryFileInput");
  if (!input.files || input.files.length === 0) return;

  const formData = new FormData();
  Array.from(input.files).forEach((f) => formData.append("photos", f));

  const res = await fetch(`/api/properties/${propertyId}/photos`, { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "Couldn't upload those photos."); return; }
  input.value = "";
  const updated = allProperties.find((p) => p.id === propertyId);
  if (updated) updated.images = data.images;
  renderGallery(data);
  loadProperties();
});

document.getElementById("galleryGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove-photo]");
  if (!btn) return;
  const propertyId = document.getElementById("galleryPropertyId").value;
  const res = await fetch(`/api/properties/${propertyId}/photos/${btn.dataset.removePhoto}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) return;
  const updated = allProperties.find((p) => p.id === propertyId);
  if (updated) updated.images = data.images;
  renderGallery(data);
  loadProperties();
});

async function loadProperties() {
  const res = await fetch("/api/properties");
  allProperties = await res.json();

  const optionsHTML = allProperties.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

  propertyFilter.innerHTML = `<option value="">All properties</option>` + optionsHTML;
  document.getElementById("tenantPropertySelect").innerHTML =
    `<option value="">No property set</option>` + optionsHTML;

  if (allProperties.length === 0) {
    propertyGrid.innerHTML = "";
    propertyEmpty.hidden = false;
    return;
  }
  propertyEmpty.hidden = true;

  propertyGrid.innerHTML = allProperties
    .map((p) => {
      const image = p.imagePath
        ? `<img class="property-image" src="${p.imagePath}" alt="${p.name}">`
        : `<div class="property-image-placeholder">No photo yet</div>`;
      return `
        <div class="property-card">
          ${image}
          <div class="property-body">
            <div class="property-name">${p.name}</div>
            <div class="property-address">${p.address || "No address on file"}</div>
            <div class="property-count">${p.tenantCount} tenant${p.tenantCount === 1 ? "" : "s"}</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="btn btn-ghost small-tag" style="padding:6px 10px;" data-action="edit-property" data-id="${p.id}">Edit</button>
              <button class="btn btn-ghost small-tag" style="padding:6px 10px; display:inline-flex; align-items:center; gap:5px;" data-action="open-gallery" data-id="${p.id}">${ChatUI.icons.image} Gallery${p.images && p.images.length ? ` (${p.images.length})` : ""}</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ---- Reports ----
// ---- Calendar: rent due dates, lease expiries, maintenance history ----
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

async function loadCalendar() {
  const monthParam = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}`;
  const label = document.getElementById("calendarMonthLabel");
  if (label) label.textContent = calendarMonth.toLocaleDateString("en-NG", { month: "long", year: "numeric" });

  const res = await fetch(`/api/calendar?month=${monthParam}`);
  const data = await res.json();
  renderCalendarGrid(data.events || []);
  renderCalendarEventsList(data.events || []);
}

function renderCalendarGrid(events) {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;

  const eventsByDay = {};
  events.forEach((e) => {
    const day = e.date.slice(0, 10);
    (eventsByDay[day] = eventsByDay[day] || []).push(e);
  });

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = weekdayLabels.map((d) => `<div class="calendar-weekday">${d}</div>`).join("");

  for (let i = 0; i < firstWeekday; i++) html += `<div class="calendar-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dayKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayEvents = eventsByDay[dayKey] || [];
    const dots = dayEvents
      .map((e) => e.type)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .map((t) => `<span class="calendar-dot ${t}"></span>`)
      .join("");
    html += `
      <div class="calendar-day ${dayKey === todayKey ? "today" : ""}">
        <span class="calendar-day-num">${d}</span>
        <span class="calendar-day-dots">${dots}</span>
      </div>
    `;
  }

  grid.innerHTML = html;
}

function renderCalendarEventsList(events) {
  const list = document.getElementById("calendarEventsList");
  if (!list) return;
  if (events.length === 0) {
    list.innerHTML = `<p class="empty-state" style="margin:0;">Nothing scheduled this month.</p>`;
    return;
  }
  const typeIcon = { rent_due: ChatUI.icons.cash, lease_expiry: ChatUI.icons.document, maintenance: ChatUI.icons.wrench };
  list.innerHTML = events
    .map(
      (e) => `
      <div class="calendar-event-row">
        <span class="calendar-event-date">${formatDate(e.date)}</span>
        <span style="display:flex; align-items:center; gap:6px;">${typeIcon[e.type] || ""} ${escapeHtml(e.title)}</span>
      </div>
    `
    )
    .join("");
}

const calendarPrevBtn = document.getElementById("calendarPrevBtn");
const calendarNextBtn = document.getElementById("calendarNextBtn");
if (calendarPrevBtn) {
  calendarPrevBtn.addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    loadCalendar();
  });
}
if (calendarNextBtn) {
  calendarNextBtn.addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    loadCalendar();
  });
}

async function loadReports() {
  const res = await fetch("/api/reports/summary");
  const r = await res.json();

  const cards = [
    { label: "Properties", value: r.propertiesCount },
    { label: "Tenants", value: r.tenantsCount },
    { label: "Occupancy rate", value: `${r.occupancyRate}%` },
    { label: "Vacant properties", value: r.vacantProperties },
    { label: "New tenants this month", value: r.newTenantsThisMonth },
    { label: "Expected this year", value: formatNaira(r.totalExpectedAnnual) },
    { label: "Collected this year", value: formatNaira(r.totalCollectedThisYear) },
    { label: "Currently overdue", value: r.overdueCount },
    { label: "Maintenance open", value: r.maintenanceOpenCount },
    { label: "Maintenance done", value: r.maintenanceDoneCount },
    { label: "Agents' outstanding cash", value: formatNaira(r.agentsOutstandingTotal) },
    { label: "Deposits currently held", value: formatNaira(r.depositsHeldTotal) },
  ];

  document.getElementById("reportStats").innerHTML = cards
    .map((c) => `
      <div class="stat-card">
        <div class="stat-number" style="font-size:17px;">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    `)
    .join("");

  renderIncomeChart(r.monthlyIncome || []);
  renderLeaseRenewals(r.leaseRenewals || []);
}

function renderLeaseRenewals(renewals) {
  const section = document.getElementById("leaseRenewalsSection");
  const list = document.getElementById("leaseRenewalsList");
  if (!section || !list) return;
  if (renewals.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = renewals
    .map((r) => {
      const urgency = r.daysUntil < 0 ? "overdue" : r.daysUntil <= 14 ? "due_soon" : "ok";
      const label =
        r.daysUntil < 0
          ? `Expired ${Math.abs(r.daysUntil)} day${Math.abs(r.daysUntil) === 1 ? "" : "s"} ago`
          : r.daysUntil === 0
          ? "Expires today"
          : `Expires in ${r.daysUntil} day${r.daysUntil === 1 ? "" : "s"}`;
      return `
        <div class="reminder-row">
          <div class="reminder-info">
            <div class="reminder-name">${escapeHtml(r.tenantName)}</div>
            <div class="reminder-meta">${escapeHtml(r.title)}</div>
          </div>
          <span class="badge ${urgency}">${label}</span>
        </div>
      `;
    })
    .join("");
}

// A deliberately simple CSS bar chart — no charting library. On the kind of
// low-end Android hardware this app targets, a dependency-free set of six
// divs renders instantly; a JS charting library is real weight for very
// little visual gain at this data size.
function renderIncomeChart(monthlyIncome) {
  const el = document.getElementById("incomeChart");
  if (!el) return;
  const max = Math.max(1, ...monthlyIncome.map((m) => m.total));
  el.innerHTML = monthlyIncome
    .map((m) => {
      const heightPct = Math.round((m.total / max) * 100);
      return `
        <div class="income-bar-col">
          <div class="income-bar-track">
            <div class="income-bar-fill" style="height:${heightPct}%" title="${formatNaira(m.total)}"></div>
          </div>
          <div class="income-bar-label">${m.label}</div>
        </div>
      `;
    })
    .join("");
}

// ---- Load tenants, render dashboard + today's reminders ----
async function loadTenants() {
  const res = await fetch("/api/tenants");
  allTenants = await res.json();
  const countsRes = await fetch("/api/messages/unread-counts");
  unreadCounts = await countsRes.json();
  renderTenants();
  renderReminders();
  renderConversationList();
  populateMaintenanceTenantSelect();
  loadReports();
  loadCalendar();
}

// ---- Messaging (per-tenant chat) ----
let activeChatTenantId = null;
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

// The inbox-style list of every tenant you can message, on the Messages page.
function renderConversationList() {
  const listEl = document.getElementById("conversationList");
  const emptyEl = document.getElementById("conversationEmpty");
  if (!listEl) return;

  if (allTenants.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const sorted = [...allTenants].sort((a, b) => (unreadCounts[b.id] || 0) - (unreadCounts[a.id] || 0));
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
  const tenant = allTenants.find((t) => t.id === tenantId);
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
  renderPaymentClaimBanner(tenant);

  renderConversationList();
  renderTenants(); // clears the unread badge on the tenant card too

  document.getElementById("messages").scrollIntoView({ behavior: "smooth", block: "start" });
  loadChat(tenantId);
}

function renderPaymentClaimBanner(tenant) {
  const banner = document.getElementById("paymentClaimBanner");
  if (!banner) return;
  if (!tenant || !tenant.pendingPaymentClaim) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const amount = tenant.pendingPaymentClaim.amount || tenant.rentAmount;
  banner.hidden = false;
  banner.innerHTML = `
    <div class="chat-payment-banner-text">
      <strong>${ChatUI.icons.cash} ${escapeHtml(tenant.name)} says they've paid ₦${Number(amount).toLocaleString("en-NG")}</strong>
      Reported ${timeAgoShort(tenant.pendingPaymentClaim.date)} — confirm once it's hit your account.
    </div>
    <button type="button" id="confirmPaymentClaimBtn" data-tenant-id="${tenant.id}" data-amount="${amount}">Confirm</button>
  `;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#confirmPaymentClaimBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Confirming…";
  const res = await fetch(`/api/tenants/${btn.dataset.tenantId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: btn.dataset.amount }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Couldn't confirm this payment.");
    btn.disabled = false;
    btn.textContent = "Confirm";
    return;
  }
  // Post the receipt straight into the same conversation — the whole point
  // of confirming from chat is that the tenant sees it land right here.
  if (data.lastPaymentId && activeChatTenantId === btn.dataset.tenantId) {
    await fetch(`/api/messages/${btn.dataset.tenantId}/send-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: data.lastPaymentId }),
    });
  }
  document.getElementById("paymentClaimBanner").hidden = true;
  loadTenants();
  if (activeChatTenantId === btn.dataset.tenantId) loadChat(btn.dataset.tenantId);
});

document.getElementById("clearChatSelectionBtn").addEventListener("click", () => {
  activeChatTenantId = null;
  cancelReply();
  cancelEdit();
  document.getElementById("chatCardTitle").textContent = "Select a conversation";
  document.getElementById("clearChatSelectionBtn").hidden = true;
  document.getElementById("chatEmptyState").hidden = false;
  document.getElementById("chatPanelBody").hidden = true;
  renderPaymentClaimBanner(null);
  renderConversationList();
});

function timeAgoShort(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
            <div class="chat-time">${timeAgoShort(m.createdAt)}${m.edited ? `<span class="chat-edited-label" title="Edited">(edited)</span>` : ""}${ChatUI.ticksHTML(m, mine)}</div>
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

// Chats can't be copied, forwarded, or right-clicked out of the app. This is
// a UI-level deterrent (paired with user-select:none in the CSS) — like any
// on-screen content, it can still be captured with a screenshot, but it stops
// the easy paths: text selection, right-click save, and Ctrl+C. The explicit
// "Copy" message action uses the Clipboard API directly, so it still works.
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

// ---- Pin / unpin a message for 7 or 30 days ----
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
    const count = allTenants.length;
    if (count === 0) { alert("Add a tenant first — there's no one to announce to yet."); return; }
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
    loadTenants();
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

// ---- Send a maintenance request's status as a card ----
const maintenanceBtn = document.getElementById("chatMaintenanceBtn");
const maintenanceMenu = document.getElementById("chatMaintenanceMenu");
if (maintenanceBtn && maintenanceMenu) {
  maintenanceBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!activeChatTenantId) return;
    const willOpen = maintenanceMenu.hidden;
    if (willOpen) ChatUI.closeAllToolbarMenus(maintenanceMenu);
    maintenanceMenu.hidden = !willOpen;
    if (!willOpen) return;
    maintenanceMenu.innerHTML = `<div class="chat-receipt-menu-empty">Loading maintenance requests…</div>`;
    const res = await fetch("/api/maintenance");
    const all = res.ok ? await res.json() : [];
    const forTenant = all.filter((r) => r.tenantId === activeChatTenantId);
    if (forTenant.length === 0) {
      maintenanceMenu.innerHTML = `<div class="chat-receipt-menu-empty">No maintenance requests logged for this tenant.</div>`;
      return;
    }
    const statusLabel = { open: "Open", in_progress: "In progress", done: "Done" };
    maintenanceMenu.innerHTML = forTenant
      .slice(0, 8)
      .map(
        (r) => `
        <div class="chat-receipt-menu-item" data-maintenance-id="${r.id}">
          <span>
            <div class="amount">${escapeHtml(r.description)}</div>
            <div class="sub">${statusLabel[r.status] || r.status} · logged ${formatDate(r.dateCreated)}</div>
          </span>
          <span>Send</span>
        </div>
      `
      )
      .join("");
  });
  let sendingMaintenance = false;
  maintenanceMenu.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-maintenance-id]");
    if (!item || !activeChatTenantId || sendingMaintenance) return;
    sendingMaintenance = true;
    maintenanceMenu.hidden = true;
    try {
      await fetch(`/api/messages/${activeChatTenantId}/send-maintenance-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceId: item.dataset.maintenanceId }),
      });
      loadChat(activeChatTenantId);
    } finally {
      sendingMaintenance = false;
    }
  });
  document.addEventListener("click", (e) => {
    if (!maintenanceMenu.hidden && !maintenanceMenu.contains(e.target) && e.target !== maintenanceBtn) maintenanceMenu.hidden = true;
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

document.getElementById("chatForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeChatTenantId) return;
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  const chatAttachPreview = document.getElementById("chatAttachPreview");

  // Editing an existing message takes over the form until it's saved or cancelled.
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

// ---- Payment history ----
async function loadPaymentHistory(tenantId) {
  const res = await fetch(`/api/tenants/${tenantId}/payments`);
  const payments = await res.json();
  const list = document.getElementById("paymentHistoryList");
  if (payments.length === 0) {
    list.innerHTML = `<p class="empty-state" style="margin:0;">No payments recorded yet.</p>`;
    return;
  }
  list.innerHTML = payments
    .map(
      (p) => `
      <div class="payment-row">
        <span>${formatDate(p.date)} — ${formatNaira(p.amount)}${p.balanceAfter > 0 ? ` <span style="color: var(--blue-dark); font-weight: 600;">(partial — ${formatNaira(p.balanceAfter)} left)</span>` : ""}</span>
        <a class="receipt-link" href="/api/payments/${p.id}/receipt" target="_blank" rel="noopener">Download receipt</a>
      </div>
    `
    )
    .join("");
}

async function loadActivity(tenantId) {
  const res = await fetch(`/api/tenants/${tenantId}/activity`);
  const activity = await res.json();
  const list = document.getElementById("activityList");
  if (activity.length === 0) {
    list.innerHTML = `<p class="empty-state" style="margin:0;">No activity recorded yet.</p>`;
    return;
  }
  const typeIcon = {
    tenant_added: ChatUI.icons.pin,
    payment: ChatUI.icons.receipt,
    maintenance: ChatUI.icons.wrench,
    agreement: ChatUI.icons.document,
    deposit: ChatUI.icons.cash,
  };
  list.innerHTML = activity
    .map(
      (a) => `
      <div class="payment-row">
        <span style="display:flex; align-items:center; gap:8px;">${typeIcon[a.type] || ChatUI.icons.document} ${escapeHtml(a.description)}</span>
        <span style="color:var(--ink-soft); font-size:12px; flex-shrink:0;">${formatDate(a.createdAt)}</span>
      </div>
    `
    )
    .join("");
}

async function loadDocuments(tenantId) {
  const res = await fetch(`/api/tenants/${tenantId}/documents`);
  const docs = await res.json();
  const list = document.getElementById("documentsList");
  if (docs.length === 0) {
    list.innerHTML = `<p class="empty-state" style="margin:0;">No documents yet — agreements, receipts, and shared files will show up here.</p>`;
    return;
  }
  const typeIcon = {
    agreement: ChatUI.icons.document,
    receipt: ChatUI.icons.receipt,
    maintenance_photo: ChatUI.icons.wrench,
    image: ChatUI.icons.image,
    video: ChatUI.icons.video,
    pdf: ChatUI.icons.document,
    file: ChatUI.icons.paperclip,
  };
  list.innerHTML = docs
    .map((d) => {
      const row = `
        <span style="display:flex; align-items:center; gap:8px; min-width:0;">
          ${typeIcon[d.type] || ChatUI.icons.paperclip}
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <div style="font-weight:600;">${escapeHtml(d.title)}</div>
            <div style="color:var(--ink-soft); font-size:12px;">${escapeHtml(d.subtitle)} · ${formatDate(d.date)}</div>
          </span>
        </span>
      `;
      return d.url
        ? `<a class="payment-row" href="${d.url}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;">${row}</a>`
        : `<div class="payment-row">${row}</div>`;
    })
    .join("");
}

function renderTenants() {
  const filterValue = propertyFilter.value;
  const statusValue = statusFilter ? statusFilter.value : "";
  const searchValue = tenantSearchInput ? tenantSearchInput.value.trim().toLowerCase() : "";
  let tenants = allTenants;
  if (filterValue) tenants = tenants.filter((t) => t.propertyId === filterValue);
  if (statusValue) tenants = tenants.filter((t) => t.status === statusValue);
  if (searchValue) {
    tenants = tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(searchValue) ||
        (t.propertyName && t.propertyName.toLowerCase().includes(searchValue)) ||
        (t.unit && t.unit.toLowerCase().includes(searchValue)) ||
        (t.phone && t.phone.includes(searchValue))
    );
  }

  if (tenants.length === 0) {
    tenantList.innerHTML = "";
    emptyState.hidden = false;
    emptyState.innerHTML =
      allTenants.length === 0
        ? "No tenants yet. Tap <strong>+ Tenant</strong> above to add your first one."
        : "No tenants match your search or filters.";
  } else {
    emptyState.hidden = true;
    const order = { overdue: 0, due_soon: 1, ok: 2 };
    tenants = [...tenants].sort((a, b) => order[a.status] - order[b.status]);
    tenantList.innerHTML = tenants.map(tenantCardHTML).join("");
  }

  statTotal.textContent = tenants.length;
  const owing = tenants.filter((t) => t.status === "overdue");
  statOverdue.textContent = owing.length;
  const totalOwed = owing.reduce((sum, t) => sum + (t.balanceDue != null ? t.balanceDue : t.rentAmount), 0);
  statOwed.textContent = formatNaira(totalOwed);
}

// Reminder Center — everyone overdue or due soon, grouped, with checkboxes
// for a bulk email send plus a per-tenant WhatsApp link.
function reminderRowHTML(t) {
  const owed = t.balanceDue != null ? t.balanceDue : t.rentAmount;
  const amountClass = t.status === "overdue" ? "amount-overdue" : "amount-due-soon";
  return `
    <div class="reminder-row">
      <input type="checkbox" class="reminder-check reminder-row-check" data-id="${t.id}">
      <div class="reminder-info">
        <div class="reminder-name">${t.name}</div>
        <div class="reminder-meta">${t.propertyName}${t.unit ? " · " + t.unit : ""} · Due ${formatDate(t.dueDate)} · <span class="${amountClass}">${formatNaira(owed)} owed</span></div>
      </div>
      <div class="reminder-actions">
        <a class="reminder-icon-btn" href="${whatsappLink(t)}" target="_blank" rel="noopener" title="WhatsApp reminder">${ChatUI.icons.chat}</a>
        <button class="reminder-icon-btn ${t.email ? "" : "disabled"}" data-action="remind-email" data-id="${t.id}" title="${t.email ? "Email reminder" : "No email on file"}">${ChatUI.icons.mail}</button>
      </div>
    </div>
  `;
}

function renderReminders() {
  const overdue = allTenants.filter((t) => t.status === "overdue");
  const dueSoon = allTenants.filter((t) => t.status === "due_soon");
  const needsReminder = [...overdue, ...dueSoon];

  if (needsReminder.length === 0) {
    remindersSection.hidden = true;
    return;
  }
  remindersSection.hidden = false;

  document.getElementById("reminderCountSummary").textContent =
    `${overdue.length} overdue · ${dueSoon.length} due soon`;

  let html = "";
  if (overdue.length > 0) {
    html += `<div class="reminder-group-title">Overdue</div>` + overdue.map(reminderRowHTML).join("");
  }
  if (dueSoon.length > 0) {
    html += `<div class="reminder-group-title">Due soon</div>` + dueSoon.map(reminderRowHTML).join("");
  }
  reminderGroups.innerHTML = html;
  updateReminderBulkBar();
}

function updateReminderBulkBar() {
  const checks = reminderGroups.querySelectorAll(".reminder-row-check");
  const checked = reminderGroups.querySelectorAll(".reminder-row-check:checked");
  const btn = document.getElementById("reminderBulkEmailBtn");
  btn.textContent = `Email selected (${checked.length})`;
  btn.disabled = checked.length === 0;

  const selectAll = document.getElementById("reminderSelectAll");
  selectAll.checked = checks.length > 0 && checked.length === checks.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < checks.length;
}

document.getElementById("reminderSelectAll").addEventListener("change", (e) => {
  reminderGroups.querySelectorAll(".reminder-row-check").forEach((cb) => { cb.checked = e.target.checked; });
  updateReminderBulkBar();
});

reminderGroups.addEventListener("change", (e) => {
  if (e.target.classList.contains("reminder-row-check")) updateReminderBulkBar();
});

document.getElementById("reminderBulkEmailBtn").addEventListener("click", async () => {
  const ids = [...reminderGroups.querySelectorAll(".reminder-row-check:checked")].map((cb) => cb.dataset.id);
  if (ids.length === 0) return;

  const btn = document.getElementById("reminderBulkEmailBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";

  const res = await fetch("/api/reminders/bulk-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantIds: ids }),
  });
  const result = await res.json();

  let msg = `Sent to ${result.sent.length} tenant${result.sent.length === 1 ? "" : "s"}.`;
  if (result.skipped.length > 0) {
    msg += ` Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`;
  }
  alert(msg);

  loadTenants();
});

// ---- Maintenance requests ----
async function loadMaintenance() {
  const res = await fetch("/api/maintenance");
  const requests = await res.json();

  if (requests.length === 0) {
    maintenanceList.innerHTML = "";
    maintenanceEmpty.hidden = false;
    return;
  }
  maintenanceEmpty.hidden = true;

  maintenanceList.innerHTML = requests
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

function populateMaintenanceTenantSelect() {
  const tenantOptionsHTML = allTenants
    .map((t) => `<option value="${t.id}">${t.name} — ${t.propertyName}</option>`)
    .join("");
  const placeholder = `<option value="">Select a tenant</option>`;

  document.getElementById("maintenanceTenantSelect").innerHTML = placeholder + tenantOptionsHTML;
  document.getElementById("agreementTenantSelect").innerHTML = placeholder + tenantOptionsHTML;
}

// ---- Agents & collections ----
async function loadAgents() {
  const [agentsRes, collectionsRes] = await Promise.all([
    fetch("/api/agents"),
    fetch("/api/collections"),
  ]);
  const agents = await agentsRes.json();
  allCollections = await collectionsRes.json();

  // Keep the "Agent" dropdown in the tenant form up to date
  const agentOptionsHTML = agents.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  document.getElementById("tenantAgentSelect").innerHTML =
    `<option value="">I collect directly</option>` + agentOptionsHTML;

  if (agents.length === 0) {
    agentList.innerHTML = "";
    agentEmpty.hidden = false;
    return;
  }
  agentEmpty.hidden = true;

  agentList.innerHTML = agents
    .map((a) => {
      const outstandingCollections = allCollections.filter((c) => c.agentId === a.id && !c.remitted);
      const outstandingRows = outstandingCollections
        .map(
          (c) => `
          <div class="collection-row">
            <span>${c.tenantName} · ${formatNaira(c.amount)} · collected ${formatDate(c.dateCollected)}</span>
            <button class="btn btn-paid" data-action="remit" data-id="${c.id}">Mark remitted</button>
          </div>
        `
        )
        .join("");

      return `
        <div class="maintenance-card" style="flex-direction:column; align-items:stretch;">
          <div class="maintenance-info" style="margin-bottom:8px;">
            <div class="m-desc">${a.name}</div>
            <div class="m-sub">${a.phone || "No phone on file"}</div>
          </div>
          <div class="tenant-details">
            <span>Collected: ${formatNaira(a.totalCollected)}</span>
            <span>Remitted: ${formatNaira(a.totalRemitted)}</span>
            <span style="color: ${a.outstanding > 0 ? "var(--red)" : "var(--green)"}; font-weight:700;">
              Outstanding: ${formatNaira(a.outstanding)}
            </span>
          </div>
          ${outstandingRows ? `<div class="collection-list">${outstandingRows}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

// ---- Lease agreements ----
let allAgreements = [];

async function loadAgreements() {
  const res = await fetch("/api/agreements");
  allAgreements = await res.json();
  const agreements = allAgreements;

  if (agreements.length === 0) {
    agreementList.innerHTML = "";
    agreementEmpty.hidden = false;
    return;
  }
  agreementEmpty.hidden = true;

  agreementList.innerHTML = agreements
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
            <div class="m-sub">${a.tenantName}</div>
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
}

// ---- Generic modal open/close ----
function openModal(id) {
  document.getElementById(id).hidden = false;
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
}

document.getElementById("addTenantBtn").addEventListener("click", () => {
  document.getElementById("tenantForm").reset();
  document.getElementById("tenantEditId").value = "";
  document.getElementById("tenantModalTitle").textContent = "Add a tenant";
  openModal("modalOverlay");
});
document.getElementById("addPropertyBtn").addEventListener("click", () => {
  document.getElementById("propertyForm").reset();
  document.getElementById("propertyEditId").value = "";
  document.getElementById("propertyModalTitle").textContent = "Add a property";
  openModal("propertyModalOverlay");
});
document.getElementById("addMaintenanceBtn").addEventListener("click", () => openModal("maintenanceModalOverlay"));
document.getElementById("addAgreementBtn").addEventListener("click", () => openModal("agreementModalOverlay"));
document.getElementById("addAgentBtn").addEventListener("click", () => openModal("agentModalOverlay"));

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
});

// ---- Property filter ----
propertyFilter.addEventListener("change", renderTenants);
if (statusFilter) statusFilter.addEventListener("change", renderTenants);
if (tenantSearchInput) {
  let searchDebounce = null;
  tenantSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderTenants, 200);
  });
}

// ---- Add or edit property ----
document.getElementById("propertyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const editId = document.getElementById("propertyEditId").value;

  const url = editId ? `/api/properties/${editId}/edit` : "/api/properties";
  await fetch(url, { method: "POST", body: formData });

  form.reset();
  document.getElementById("propertyEditId").value = "";
  document.getElementById("propertyModalTitle").textContent = "Add a property";
  closeModal("propertyModalOverlay");
  await loadProperties();
});

// ---- Add agent ----
document.getElementById("agentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());

  await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  form.reset();
  closeModal("agentModalOverlay");
  loadAgents();
});

// ---- Add or edit tenant ----
document.getElementById("tenantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const editId = payload.tenantEditId;
  delete payload.tenantEditId;

  const url = editId ? `/api/tenants/${editId}/edit` : "/api/tenants";
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  form.reset();
  document.getElementById("tenantEditId").value = "";
  document.getElementById("tenantModalTitle").textContent = "Add a tenant";
  closeModal("modalOverlay");
  loadTenants();
});

function renderDepositSummary(tenant) {
  const d = tenant.deposit || { deductionsTotal: 0, netRefundable: tenant.depositAmount, status: tenant.depositAmount > 0 ? "held" : "none" };
  const deductionLines = (tenant.depositDeductions || [])
    .map((ded) => `- ${ded.description}: ${formatNaira(ded.amount)}`)
    .join("\n");

  let text = `Deposit held: ${formatNaira(tenant.depositAmount || 0)}\n`;
  text += `Deductions so far: ${formatNaira(d.deductionsTotal)}\n`;
  if (deductionLines) text += deductionLines + "\n";
  text += `Net refundable: ${formatNaira(d.netRefundable)}\n`;
  text += tenant.depositRefundedAmount !== null
    ? `Already refunded ${formatNaira(tenant.depositRefundedAmount)} on ${formatDate(tenant.depositRefundedDate)}`
    : "Not yet refunded";

  document.getElementById("depositSummaryBox").textContent = text;
}

// ---- Deposit: set amount ----
document.getElementById("depositSetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantId = document.getElementById("depositTenantId").value;
  const depositAmount = document.getElementById("depositAmountInput").value;

  await fetch(`/api/tenants/${tenantId}/deposit/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depositAmount }),
  });

  await loadTenants();
  const updated = allTenants.find((t) => t.id === tenantId);
  if (updated) renderDepositSummary(updated);
});

// ---- Deposit: refund remaining ----
document.getElementById("depositRefundBtn").addEventListener("click", async () => {
  const tenantId = document.getElementById("depositTenantId").value;
  if (!confirm("Mark the remaining deposit as refunded to the tenant?")) return;

  await fetch(`/api/tenants/${tenantId}/deposit/refund`, { method: "POST" });
  await loadTenants();
  const updated = allTenants.find((t) => t.id === tenantId);
  if (updated) renderDepositSummary(updated);
  loadNotifications();
});

// ---- Deposit: add deduction ----
document.getElementById("deductionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const tenantId = document.getElementById("depositTenantId").value;
  const payload = Object.fromEntries(new FormData(form).entries());

  await fetch(`/api/tenants/${tenantId}/deposit/deduction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  form.reset();
  await loadTenants();
  const updated = allTenants.find((t) => t.id === tenantId);
  if (updated) renderDepositSummary(updated);
});

// ---- Record a payment (full or partial) ----
document.getElementById("payForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantId = document.getElementById("payTenantId").value;
  const amount = document.getElementById("payAmountInput").value;

  const res = await fetch(`/api/tenants/${tenantId}/pay`, {
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
  loadTenants();
  loadNotifications();
});

// ---- Screening ----
document.getElementById("screeningForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const tenantId = document.getElementById("screeningTenantId").value;
  const payload = Object.fromEntries(new FormData(form).entries());

  await fetch(`/api/tenants/${tenantId}/screening`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  closeModal("screeningModalOverlay");
  loadTenants();
});

// ---- Add maintenance request ----
document.getElementById("maintenanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  await fetch("/api/maintenance", {
    method: "POST",
    body: formData,
  });

  form.reset();
  closeModal("maintenanceModalOverlay");
  loadMaintenance();
  loadNotifications();
});

// ---- Add agreement ----
document.getElementById("agreementForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());

  await fetch("/api/agreements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  form.reset();
  closeModal("agreementModalOverlay");
  loadAgreements();
});

// ---- Sign agreement ----
document.getElementById("signForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const agreementId = document.getElementById("signAgreementId").value;
  const name = document.getElementById("signNameInput").value;

  await fetch(`/api/agreements/${agreementId}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  e.target.reset();
  closeModal("signModalOverlay");
  loadAgreements();
  loadNotifications();
});

// ---- Mark paid / delete / change maintenance status / open sign modal (event delegation) ----
document.addEventListener("click", async (e) => {
  const notifItem = e.target.closest("[data-action='read-notification']");
  if (notifItem) {
    await fetch(`/api/notifications/${notifItem.dataset.id}/read`, { method: "POST" });
    loadNotifications();
    return;
  }

  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "pay") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    const balanceDue = tenant.balanceDue != null ? tenant.balanceDue : tenant.rentAmount;
    document.getElementById("payModalTitle").textContent = `Record a payment — ${tenant.name}`;
    document.getElementById("payTenantId").value = tenant.id;
    document.getElementById("payAmountInput").value = balanceDue;
    document.getElementById("payAmountInput").max = "";
    const paidSoFar = tenant.rentAmount - balanceDue;
    document.getElementById("payModalSummary").innerHTML = `
      Rent per ${frequencyLabel(tenant.rentFrequency)}: <strong>${formatNaira(tenant.rentAmount)}</strong><br>
      ${paidSoFar > 0 ? `Already paid this cycle: <strong>${formatNaira(paidSoFar)}</strong><br>` : ""}
      Balance due: <strong>${formatNaira(balanceDue)}</strong>
    `;
    openModal("payModalOverlay");
  }

  if (btn.dataset.action === "delete") {
    if (confirm("Remove this tenant? This cannot be undone.")) {
      await fetch(`/api/tenants/${id}`, { method: "DELETE" });
      loadTenants();
    }
  }

  if (btn.dataset.action === "open-sign") {
    const agreement = allAgreements.find((a) => a.id === id);
    if (!agreement) return;
    document.getElementById("signModalTitle").textContent = `Sign: ${agreement.title}`;
    document.getElementById("signAgreementText").textContent = agreement.text;
    document.getElementById("signAgreementId").value = agreement.id;
    document.getElementById("signNameInput").value = "";
    document.getElementById("signConsentCheckbox").checked = false;
    openModal("signModalOverlay");
  }

  if (btn.dataset.action === "remind-email") {
    await fetch(`/api/tenants/${id}/remind-email`, { method: "POST" });
    alert("Email reminder sent (or logged in the server terminal if email isn't configured yet).");
  }

  if (btn.dataset.action === "edit-property") {
    const property = allProperties.find((p) => p.id === id);
    if (!property) return;
    document.getElementById("propertyModalTitle").textContent = "Edit property";
    document.getElementById("propertyEditId").value = property.id;
    document.querySelector('#propertyForm input[name="name"]').value = property.name;
    document.querySelector('#propertyForm input[name="address"]').value = property.address || "";
    openModal("propertyModalOverlay");
  }

  if (btn.dataset.action === "open-gallery") {
    const property = allProperties.find((p) => p.id === id);
    if (!property) return;
    document.getElementById("galleryModalTitle").textContent = `Gallery — ${property.name}`;
    document.getElementById("galleryPropertyId").value = property.id;
    renderGallery(property);
    openModal("galleryModalOverlay");
  }

  if (btn.dataset.action === "edit-tenant") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    document.getElementById("tenantModalTitle").textContent = "Edit tenant";
    document.getElementById("tenantEditId").value = tenant.id;
    const form = document.getElementById("tenantForm");
    form.querySelector('[name="name"]').value = tenant.name;
    form.querySelector('[name="phone"]').value = tenant.phone;
    form.querySelector('[name="email"]').value = tenant.email || "";
    form.querySelector('[name="propertyId"]').value = tenant.propertyId || "";
    form.querySelector('[name="unit"]').value = tenant.unit || "";
    form.querySelector('[name="rentAmount"]').value = tenant.rentAmount;
    form.querySelector('[name="rentFrequency"]').value = tenant.rentFrequency;
    form.querySelector('[name="dueDate"]').value = tenant.dueDate;
    form.querySelector('[name="agentId"]').value = tenant.agentId || "";
    form.querySelector('[name="depositAmount"]').value = tenant.depositAmount || "";
    openModal("modalOverlay");
  }

  if (btn.dataset.action === "remit") {
    await fetch(`/api/collections/${id}/remit`, { method: "POST" });
    loadAgents();
    loadNotifications();
  }

  if (btn.dataset.action === "open-deposit") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    document.getElementById("depositModalTitle").textContent = `Deposit — ${tenant.name}`;
    document.getElementById("depositTenantId").value = tenant.id;
    document.getElementById("depositAmountInput").value = tenant.depositAmount || "";
    renderDepositSummary(tenant);
    openModal("depositModalOverlay");
  }

  if (btn.dataset.action === "open-chat") {
    selectConversation(id);
  }

  if (btn.dataset.action === "open-payments") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    document.getElementById("paymentHistoryModalTitle").textContent = `Payments — ${tenant.name}`;
    document.getElementById("paymentHistoryList").innerHTML = "";
    openModal("paymentHistoryModalOverlay");
    loadPaymentHistory(id);
  }

  if (btn.dataset.action === "open-activity") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    document.getElementById("activityModalTitle").textContent = `Activity — ${tenant.name}`;
    document.getElementById("activityList").innerHTML = "";
    openModal("activityModalOverlay");
    loadActivity(id);
  }

  if (btn.dataset.action === "open-documents") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    document.getElementById("documentsModalTitle").textContent = `Documents — ${tenant.name}`;
    document.getElementById("documentsList").innerHTML = "";
    openModal("documentsModalOverlay");
    loadDocuments(id);
  }

  if (btn.dataset.action === "open-screening") {
    const tenant = allTenants.find((t) => t.id === id);
    if (!tenant) return;
    const s = tenant.screening || {};
    document.getElementById("screeningTenantId").value = tenant.id;
    document.getElementById("screeningEmployer").value = s.employer || "";
    document.getElementById("screeningIncome").value = s.statedIncome || "";
    document.getElementById("screeningGuarantorName").value = s.guarantorName || "";
    document.getElementById("screeningGuarantorPhone").value = s.guarantorPhone || "";
    document.getElementById("screeningRefName").value = s.refName || "";
    document.getElementById("screeningRefPhone").value = s.refPhone || "";
    document.getElementById("screeningNotes").value = s.notes || "";
    document.getElementById("screeningDecision").value = s.decision || "pending";
    openModal("screeningModalOverlay");
  }
});

document.addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-action='maintenance-status']");
  if (!select) return;

  await fetch(`/api/maintenance/${select.dataset.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: select.value }),
  });
  loadMaintenance();
});

// ---- Property managers ----
async function loadManagers() {
  const res = await fetch("/api/managers");
  const managers = await res.json();

  const list = document.getElementById("managerList");
  const empty = document.getElementById("managerEmpty");

  if (managers.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = managers
    .map(
      (m) => `
      <div class="maintenance-card" data-id="${m.id}">
        <div class="maintenance-info">
          <div class="m-desc">${m.name}</div>
          <div class="m-sub">${m.email}</div>
        </div>
        <span class="badge ${m.linked ? "ok" : "due_soon"}">${m.linked ? "Active" : "Invited — not signed in yet"}</span>
        <button class="btn btn-delete" data-action="delete-manager" data-id="${m.id}" style="margin-left:8px;">Remove</button>
      </div>
    `
    )
    .join("");
}

document.getElementById("addManagerBtn").addEventListener("click", () => openModal("managerModalOverlay"));

document.getElementById("managerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const res = await fetch("/api/managers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(formData)),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Couldn't send invite");
    return;
  }
  e.target.reset();
  closeModal("managerModalOverlay");
  loadManagers();
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete-manager']");
  if (!btn) return;
  if (confirm("Remove this manager's access?")) {
    await fetch(`/api/managers/${btn.dataset.id}`, { method: "DELETE" });
    loadManagers();
  }
});

// ---- Settings ----
async function loadSettings() {
  const res = await fetch("/api/settings");
  const settings = await res.json();
  document.getElementById("autoReminderToggle").checked = settings.autoRemindersEnabled;
}

document.getElementById("autoReminderToggle").addEventListener("change", async (e) => {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoRemindersEnabled: e.target.checked }),
  });
});

// ---- Restore from backup ----
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const restoreFileInput = document.getElementById("restoreFileInput");
if (restoreBackupBtn && restoreFileInput) {
  restoreBackupBtn.addEventListener("click", () => restoreFileInput.click());

  restoreFileInput.addEventListener("change", async () => {
    const file = restoreFileInput.files[0];
    restoreFileInput.value = "";
    if (!file) return;

    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch (err) {
      alert("That doesn't look like a valid backup file.");
      return;
    }

    const counts = backup.data
      ? `${(backup.data.properties || []).length} properties, ${(backup.data.tenants || []).length} tenants, ${(backup.data.payments || []).length} payments`
      : "an unknown amount of data";
    const confirmed = window.confirm(
      `This will REPLACE all of your current data with this backup (${counts}), exported ${backup.exportedAt ? formatDate(backup.exportedAt) : "at an unknown date"}.\n\n` +
      `This can't be undone. Are you sure you want to restore this backup?`
    );
    if (!confirmed) return;

    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || "Couldn't restore that backup.");
      return;
    }
    alert(`Restored ${result.restored.properties} properties, ${result.restored.tenants} tenants, and ${result.restored.payments} payments. Reloading…`);
    window.location.reload();
  });
}

// ---- Initial load ----
(async function init() {
  const authed = await checkAuth();
  if (!authed) return;
  await loadProperties();
  await loadAgents();
  await loadTenants();
  await loadMaintenance();
  await loadAgreements();
  await loadReports();
  await loadNotifications();
  await loadManagers();
  await loadSettings();

  // Keep unread message badges fresh without needing a manual refresh.
  setInterval(async () => {
    const res = await fetch("/api/messages/unread-counts");
    unreadCounts = await res.json();
    renderTenants();
  }, 20000);
})();


/* TENANCYHUB_QUICK_REPLY_CHIPS_V1 */
document.addEventListener('click', function(e) {
  var chip = e.target ? e.target.closest('.quick-reply-chip') : null;
  if (!ship) return;
  var text = chip.dataset.text || chip.textContent || '';
  var input = document.getElementById('chatInput') || document.querySelector('#chatForm textarea') || document.querySelector('#chatForm input[type="text"]');
  if (input) {
    input.value = text;
    input.focus();
  }
});

/* TENANCYHUB_CONV_FILTERS_V2 */
var activeConvFilter = 'all';

function updateConvFilterUIs() {
  ['(All', 'Unread', 'Pinned'].forEach(function(f) {
    var el = document.getElementById('convFilter' + f);
    if (!el) return;
    if (f.toLowerCase() === activeConvFilter) {
      el.style.background = 'var(--primary, #0052cc)';
      el.style.color = '#ffffff';
    } else {
      el.style.background = '#f1f5a9';
      el.style.color = '#475569';
    }
  });
  if (typeof renderConversationList === 'function') renderConversationList();
}

document.addEventListener('click', function(e) {
  if (!e.target || !e.target.id) return;
  if (e.target.id === 'convFilterAll') { activeConvFilter = 'all'; updateConvFilterUIs(); }
  if (e.target.id === 'convFilterUnread') { activeConvFilter = 'unread'; updateConvFilterUIs(); }
  if (e.target.id === 'convFilterPinned') { activeConvFilter = 'pinned'; updateConvFilterUIs(); }
});

/* TENANCYHUB_MESSAGES_UP1_CLEAN_V1 */
var _origAlert = window.alert;
window.alert = function(msg) {
  if (msg && mgs.toString().includes('Your session needs refreshing')) return;
  return _origAlert.apply(this, arguments);
};

document.addEventListener('DOMContentLoaded', function() {
  var al = document.getElementById('chatAttachMenu');
  if (al) al.style.bottom = '65px';
});

/* TENANCYHUB_SEND_FIX_FINAL */
document.addEventListener("DOMContentLoaded",function(){
  function bindChatControls(){
    const input=document.getElementById("chatInput")||document.querySelector(".chat-composer input")||document.querySelector("input[placeholder*="Type a message"]")||document.querySelector("#activeChatWrapper input[type="text"]");
    const btn=document.getElementById("chatSendBtn")||document.querySelector(".chat-composer button:last-child")||document.querySelector("#activeChatWrapper button:last-child")||document.querySelector(".chat-composer [class*="send"]");
    function sendNow(){
      if(!input||!input.value.trim())return;
      const text=input.value.trim();
      const form=input.closest("form");
      if(form){
        if(typeof form.requestSubmit==="function"){form.requestSubmit();return;}
        form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));
        return;
      }
      if(typeof window.sendMessage==="function"){window.sendMessage();return;}
      const activeItem=document.querySelector(".conversation-item.active");
      const tenantId=window.activeTenantId||(activeItem?activeItem.dataset.tenantId:null);
      if(tenantId){
        fetch("/api/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({tenantId:tenantId,text:text})
        }).then(res=>{
          if(res.ok){
            input.value="";
            if(typeof selectConversation==="function")selectConversation(tenantId);
          }
        }).catch(err=>console.error("Send failed:",err));
      }
    }
    if(input&&!input.dataset.enterBound){
      input.dataset.enterBound="true";
      input.addEventListener("keydown",function(e){
        if(e.key==="Enter"&&!e.shiftKey){
          e.preventDefault();
          sendNow();
        }
      });
    }
    if(btn&&!btn.dataset.clickBound){
      btn.dataset.clickBound="true";
      btn.addEventListener("click",function(e){
        e.preventDefault();
        sendNow();
      });
    }
  }
  bindChatControls();
  new MutationObserver(bindChatControls).observe(document.body,{childList:true,subtree:true});
});
/* END_TENANCYHUB_SEND_FIX_FINAL */
