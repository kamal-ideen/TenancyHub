// TenancyHub server
// Stores everything in data.json (no complicated database).
// Runs on your own computer at http://localhost:3000
//
// This version adds real accounts: registration, login, and role-based
// access (Landlord / Tenant / Property Manager). Passwords are hashed with
// bcrypt — never stored as plain text. Sessions use express-session's
// default in-memory store, which is fine for one person running this
// locally, but would need a real session store (e.g. Redis) if this were
// ever deployed for multiple people to use at once.

const express = require("express");
const http = require('http');
const { Server } = require('socket.io');
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const PDFDocument = require("pdfkit");
require("dotenv").config();

let rateLimit;
try {
  rateLimit = require("express-rate-limit");
} catch (e) {
  // Not installed yet — run npm install. Falls back to no rate limiting
  // rather than crashing, same pattern used for the optional Twilio import below.
  rateLimit = () => (req, res, next) => next();
}

let helmet;
try {
  helmet = require("helmet");
} catch (e) {
  // Not installed yet — run npm install. Falls back to a no-op middleware
  // rather than crashing.
  helmet = () => (req, res, next) => next();
}

// Twilio is optional — if it's not installed or not configured in .env,
// WhatsApp sending is simply skipped (same pattern as email below).
let Twilio = null;
try { Twilio = require("twilio"); } catch (e) { /* not installed yet — run npm install */ }

// QRCode is optional too — receipts still generate fine without it, they
// just won't have a scannable verification code on them until installed.
let QRCode = null;
try { QRCode = require("qrcode"); } catch (e) { /* not installed yet — run npm install */ }

const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  socket.on('join_conversation', (convId) => {
    socket.join(convId);
  });
  socket.on('send_message', (data) => {
    io.to(data.conversationId).emit('receive_message', data);
  });
  socket.on('broadcast_announcement', (announcement) => {
    io.emit('pinned_announcement', announcement);
  });
});
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({
      users: [],
      properties: [],
      tenants: [],
      maintenanceRequests: [],
      agreements: [],
      agents: [],
      collections: [],
      payments: [],
      notifications: [],
      managers: [],
      messages: [],
      activityLog: []
    }, null, 2)
  );
}
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Email is optional — if EMAIL_USER/EMAIL_APP_PASSWORD aren't set in a .env
// file, the app just skips sending and logs a note, instead of crashing.
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
  emailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
  });
}

async function sendEmail(to, subject, text) {
  if (!emailTransporter || !to) {
    console.log(`\n[Email not sent — not configured or no address]\nTo: ${to || "none"}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  try {
    await emailTransporter.sendMail({ from: process.env.EMAIL_USER, to, subject, text });
    return true;
  } catch (err) {
    console.log("[Email failed to send]", err.message);
    return false;
  }
}

// WhatsApp is optional — if TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM
// aren't set in .env, the app just skips sending and logs a note, instead of crashing.
// See .env.example for how to get a free Twilio WhatsApp sandbox number.
let twilioClient = null;
if (Twilio && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Turn a Nigerian phone number into the digits-only format WhatsApp needs
// (matches the same logic used on the frontend for wa.me links).
function cleanPhoneForWhatsApp(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "234" + digits.slice(1);
  return digits;
}

async function sendWhatsApp(toPhone, text) {
  if (!twilioClient || !process.env.TWILIO_WHATSAPP_FROM || !toPhone) {
    console.log(`\n[WhatsApp not sent — not configured or no number]\nTo: ${toPhone || "none"}\n${text}\n`);
    return false;
  }
  try {
    const number = cleanPhoneForWhatsApp(toPhone);
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM, // e.g. "whatsapp:+14155238886"
      to: `whatsapp:+${number}`,
      body: text,
    });
    return true;
  } catch (err) {
    console.log("[WhatsApp failed to send]", err.message);
    return false;
  }
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // 6-digit code
}

// Security headers (clickjacking, MIME-sniffing, etc.). Content-Security-Policy
// is turned off deliberately: the current templates use inline `style="..."`
// attributes throughout and two inline <script> blocks (forgot/reset password),
// and Helmet's default CSP would block all of that immediately. Turning on a
// real CSP is worth doing later, but it means auditing and moving every inline
// style/script first — a separate, deliberate task, not a side effect of this one.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
const SESSION_SECRET = process.env.SESSION_SECRET || "tenancyhub-local-dev-secret";
if (!process.env.SESSION_SECRET) {
  console.warn(
    "⚠️  SESSION_SECRET is not set in .env — using a built-in development secret. " +
    "This is fine on your own machine, but set a real SESSION_SECRET before this app " +
    "ever holds real tenant data anywhere else (see .env.example)."
  );
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  })
);

// ---- CSRF protection ----
// A token tied to the session, required on every state-changing request.
// The client fetches it once (see theme.js's sibling, csrf.js) and a global
// fetch() wrapper attaches it automatically to every POST/PUT/PATCH/DELETE —
// this avoids having to touch the dozens of existing fetch() calls across
// every page individually.
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  next();
});

app.get("/api/csrf-token", (req, res) => {
  res.json({ token: req.session.csrfToken });
});

app.use("/api", (req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  const headerToken = req.get("X-CSRF-Token");
  if (!headerToken || headerToken !== req.session.csrfToken) {
    return res.status(403).json({ error: "Your session needs refreshing — please reload the page and try again." });
  }
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, newId() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Property photo gallery: multiple images per property, image-only (the
// shared "upload" above has no type restriction, which is fine for its
// existing single-image use, but a gallery accepting arbitrary files is a
// bigger surface — this stays strictly images).
const galleryUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, newId() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files can be added to a property gallery"));
  },
});

// Chat attachments allow images, PDFs, video, and voice notes — bigger limit for video files.
const CHAT_ALLOWED_TYPES = /^(image\/|video\/|application\/pdf|audio\/)/;
const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, newId() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — enough for short videos
  fileFilter: (req, file, cb) => {
    if (CHAT_ALLOWED_TYPES.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only images, videos, voice notes, and PDF files can be sent in chat"));
  },
});

// Auth rate limits, scoped per IP since there's no logged-in user yet to key
// on. Login is the tightest — this is specifically the brute-force guard
// that was missing before.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts — please wait a few minutes and try again." },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-up attempts from this connection — please wait a while and try again." },
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts — please wait a few minutes and try again." },
});

// Rate limits on chat, scoped per logged-in user rather than per IP, so one
// account flooding the chat can't also lock out everyone sharing a network.
const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too fast — please slow down a little." },
});
const chatUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attachments too quickly — please wait a moment and try again." },
});

// "Typing…" state lives in memory, not data.json — it's pinged on every
// keystroke, and writing that to disk on every keystroke would be a lot of
// needless I/O for something that's meaningless a few seconds later anyway.
// Losing it on a server restart is fine; it's not a record of anything.
const typingState = {}; // tenantId -> { landlordSideUntil, tenantSideUntil }
const TYPING_TTL_MS = 4000;

function setTyping(tenantId, side) {
  if (!typingState[tenantId]) typingState[tenantId] = {};
  typingState[tenantId][side === "tenant" ? "tenantSideUntil" : "landlordSideUntil"] = Date.now() + TYPING_TTL_MS;
}

function isTyping(tenantId, side) {
  const until = typingState[tenantId]?.[side === "tenant" ? "tenantSideUntil" : "landlordSideUntil"];
  return !!until && until > Date.now();
}

function attachmentTypeFor(mimetype) {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
}

// ---- helpers to read/write our "database" (just a JSON file) ----
function readData() {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const data = JSON.parse(raw);
  // Fill in any new sections that didn't exist in an older data.json file,
  // so upgrading the app never wipes or crashes on your existing data.
  if (!data.users) data.users = [];
  data.users.forEach((u) => {
    if (u.googleId === undefined) u.googleId = null;
    if (u.resetToken === undefined) u.resetToken = null;
    if (u.resetTokenExpiry === undefined) u.resetTokenExpiry = null;
    if (u.autoRemindersEnabled === undefined) u.autoRemindersEnabled = true;
    if (u.phone === undefined) u.phone = "";
    // Accounts created before this feature existed are grandfathered in as verified.
    if (u.verified === undefined) u.verified = true;
    if (u.verificationCodeHash === undefined) u.verificationCodeHash = null;
    if (u.verificationCodeExpiry === undefined) u.verificationCodeExpiry = null;
  });
  if (!data.properties) data.properties = [];
  if (!data.tenants) data.tenants = [];
  if (!data.maintenanceRequests) data.maintenanceRequests = [];
  if (!data.agreements) data.agreements = [];
  if (!data.agents) data.agents = [];
  if (!data.collections) data.collections = [];
  if (!data.payments) data.payments = [];
  if (!data.notifications) data.notifications = [];
  if (!data.managers) data.managers = [];
  if (!data.messages) data.messages = [];
  if (!data.activityLog) data.activityLog = [];

  data.agreements.forEach((a) => {
    if (a.expiryDate === undefined) a.expiryDate = null;
  });

  data.managers.forEach((m) => {
    if (m.userId === undefined) m.userId = null;
  });
  data.payments.forEach((p) => {
    if (p.receiptNumber === undefined) p.receiptNumber = "RC-" + p.id.slice(-8).toUpperCase();
    if (p.balanceAfter === undefined) p.balanceAfter = 0;
    if (p.completedCycle === undefined) p.completedCycle = true;
  });
  data.tenants.forEach((t) => {
    if (t.lastReminderSentDate === undefined) t.lastReminderSentDate = null;
    if (t.createdAt === undefined) t.createdAt = null;
  });
  data.messages.forEach((m) => {
    if (m.pinnedUntil === undefined) m.pinnedUntil = null;
    if (m.attachmentUrl === undefined) m.attachmentUrl = null;
    if (m.attachmentType === undefined) m.attachmentType = null;
    if (m.attachmentName === undefined) m.attachmentName = null;
    if (m.replyToId === undefined) m.replyToId = null;
    if (m.reactions === undefined) m.reactions = {};
    if (m.deletedFor === undefined) m.deletedFor = [];
    if (m.edited === undefined) m.edited = false;
    if (m.editHistory === undefined) m.editHistory = [];
    if (m.cardType === undefined) m.cardType = null;
    if (m.cardData === undefined) m.cardData = null;
    if (m.senderId === undefined) m.senderId = null;
  });

  data.properties.forEach((p) => {
    if (p.landlordId === undefined) p.landlordId = null;
    if (p.imagePath === undefined) p.imagePath = null;
    if (p.images === undefined) p.images = [];
  });
  data.agents.forEach((a) => {
    if (a.landlordId === undefined) a.landlordId = null;
  });
  data.maintenanceRequests.forEach((m) => {
    if (m.imagePath === undefined) m.imagePath = null;
  });
  data.tenants.forEach((t) => {
    if (!t.rentFrequency) t.rentFrequency = "monthly";
    if (t.agentId === undefined) t.agentId = null;
    if (t.landlordId === undefined) t.landlordId = null;
    if (t.email === undefined) t.email = "";
    if (t.depositAmount === undefined) t.depositAmount = 0;
    if (!t.depositDeductions) t.depositDeductions = [];
    if (t.depositRefundedAmount === undefined) t.depositRefundedAmount = null;
    if (t.depositRefundedDate === undefined) t.depositRefundedDate = null;
    // Links this tenant record to a Tenant-role user account, so that person
    // can log into their own portal and see their own tenancy. Set
    // automatically the first time a tenant user's email matches this record.
    if (t.userId === undefined) t.userId = null;
    if (t.pendingPaymentClaim === undefined) t.pendingPaymentClaim = null;
    if (t.pendingPaymentClaim && t.pendingPaymentClaim.amount === undefined) {
      t.pendingPaymentClaim.amount = t.rentAmount;
    }
    if (t.amountPaidTowardCycle === undefined) t.amountPaidTowardCycle = 0;
    if (!t.screening) {
      t.screening = {
        employer: "",
        statedIncome: "",
        guarantorName: "",
        guarantorPhone: "",
        refName: "",
        refPhone: "",
        notes: "",
        decision: "pending",
      };
    }
  });
  return data;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function newId() {
  return Date.now().toString() + Math.random().toString(16).slice(2, 6);
}

// Logs a discrete event (not a dynamic status like "overdue") so the landlord
// has a running feed of things that actually happened — a signed agreement,
// a new maintenance request, an agent remitting money, etc.
function addNotification(data, landlordId, message) {
  data.notifications.push({
    id: newId(),
    landlordId,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

// A per-tenant history — separate from the notification bell above, which is
// a landlord-wide, dismissible alert feed. This is the opposite: a permanent
// record of what happened with *this* tenant specifically (payments logged,
// maintenance raised, agreements signed), for the activity timeline.
function logActivity(data, tenantId, landlordId, type, description) {
  data.activityLog.push({
    id: newId(),
    tenantId,
    landlordId,
    type,
    description,
    createdAt: new Date().toISOString(),
  });
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function advanceDueDate(dateStr, rentFrequency) {
  const monthsToAdd = rentFrequency === "yearly" ? 12 : 1;
  return addMonths(dateStr, monthsToAdd);
}

function statusFor(dueDate, rentFrequency) {
  const today = new Date().toISOString().slice(0, 10);
  const warningDays = rentFrequency === "yearly" ? 30 : 7;
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + warningDays);
  const warningDateStr = warningDate.toISOString().slice(0, 10);

  if (dueDate < today) return "overdue";
  if (dueDate <= warningDateStr) return "due_soon";
  return "ok";
}

// How much is still owed toward the tenant's CURRENT rent cycle. Tenants can
// pay in installments (see recordTenantPayment) — this is what's left before
// the cycle counts as fully paid and the due date rolls forward.
function remainingBalance(tenant) {
  return Math.max(tenant.rentAmount - (tenant.amountPaidTowardCycle || 0), 0);
}

function depositSummary(tenant) {
  const deductionsTotal = tenant.depositDeductions.reduce((sum, d) => sum + d.amount, 0);
  const netRefundable = tenant.depositAmount - deductionsTotal;
  let status = "none";
  if (tenant.depositAmount > 0) {
    status = tenant.depositRefundedAmount !== null ? "refunded" : "held";
  }
  return { deductionsTotal, netRefundable, status, refundedAmount: tenant.depositRefundedAmount };
}

// ======================= AUTH =======================

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please log in first" });
  next();
}

// Only Landlord and Tenant accounts have working portals right now —
// Property Manager accounts can register and log in, but the portal built
// for them doesn't exist yet. Saying that honestly beats pretending it does.
function requireLandlord(req, res, next) {
  if (req.session.role !== "landlord") {
    return res.status(403).json({ error: "This account type doesn't have this feature yet" });
  }
  next();
}

function requireTenant(req, res, next) {
  if (req.session.role !== "tenant") {
    return res.status(403).json({ error: "This account type doesn't have this feature yet" });
  }
  next();
}

// A tenant record (added by a landlord, with just a name/phone/email) isn't
// automatically connected to a Tenant login account — they're created
// separately. This connects them the first time it can: if the logged-in
// tenant user's email matches an unclaimed tenant record, that record
// becomes "theirs" from then on. Safe to call on every request; it's a
// no-op once a match has already been made.
function linkTenantAccount(data, user) {
  if (user.role !== "tenant") return null;
  let tenant = data.tenants.find((t) => t.userId === user.id);
  if (tenant) return tenant;

  tenant = data.tenants.find(
    (t) => !t.userId && t.email && t.email.toLowerCase() === user.email.toLowerCase()
  );
  if (tenant) {
    tenant.userId = user.id;
    writeData(data);
  }
  return tenant || null;
}

function findTenantForUser(data, userId) {
  return data.tenants.find((t) => t.userId === userId) || null;
}

// Same idea as linkTenantAccount, but for Property Manager accounts: a
// landlord invites a manager by email (creating an unlinked record), and the
// first time that person logs in as a property_manager with a matching
// email, the invite becomes "theirs".
function linkManagerAccount(data, user) {
  if (user.role !== "property_manager") return null;
  let manager = data.managers.find((m) => m.userId === user.id);
  if (manager) return manager;

  manager = data.managers.find(
    (m) => !m.userId && m.email.toLowerCase() === user.email.toLowerCase()
  );
  if (manager) {
    manager.userId = user.id;
    writeData(data);
  }
  return manager || null;
}

// Property Managers don't own an account's data — they act on behalf of the
// landlord who invited them. This resolves which landlord's workspace a
// manager should see, the same way requireLandlord scopes a landlord to
// their own data.
function requireManager(req, res, next) {
  if (req.session.role !== "property_manager") {
    return res.status(403).json({ error: "This account type doesn't have this feature" });
  }
  const data = readData();
  const manager = linkManagerAccount(data, { id: req.session.userId, role: "property_manager", email: req.session.email });
  if (!manager) {
    return res.status(403).json({ error: "You haven't been added as a manager by a landlord yet. Ask them to invite you by the email you signed up with." });
  }
  req.managerRecord = manager;
  req.workspaceLandlordId = manager.landlordId;
  next();
}

// The core of recording a rent payment — used by the landlord's own
// "record payment" action and a Property Manager doing the same thing on
// the landlord's behalf. Tenants often pay in installments rather than one
// lump sum, so `amount` can be less than the full rent — in that case the
// due date doesn't move yet, it just chips away at the balance for the
// current cycle. If `amount` is omitted, it defaults to whatever's left on
// the current cycle (i.e. "mark fully paid" — the old one-click behaviour).
function recordTenantPayment(data, tenant, landlordId, amount) {
  const paidDate = new Date().toISOString().slice(0, 10);
  const owed = remainingBalance(tenant);
  const payAmount = amount != null && amount !== "" ? Number(amount) : (owed > 0 ? owed : tenant.rentAmount);

  tenant.lastPaidDate = paidDate;
  tenant.pendingPaymentClaim = null;
  tenant.amountPaidTowardCycle = (tenant.amountPaidTowardCycle || 0) + payAmount;

  let completedCycle = false;
  while (tenant.amountPaidTowardCycle >= tenant.rentAmount && tenant.rentAmount > 0) {
    tenant.amountPaidTowardCycle -= tenant.rentAmount;
    tenant.dueDate = advanceDueDate(tenant.dueDate, tenant.rentFrequency);
    completedCycle = true;
  }

  const payment = {
    id: newId(),
    tenantId: tenant.id,
    landlordId,
    amount: payAmount,
    date: paidDate,
    balanceAfter: remainingBalance(tenant),
    completedCycle,
  };
  payment.receiptNumber = "RC-" + payment.id.slice(-8).toUpperCase();
  data.payments.push(payment);
  logActivity(data, tenant.id, landlordId, "payment", `Payment of ₦${payAmount.toLocaleString()} recorded (Receipt ${payment.receiptNumber})`);

  if (tenant.agentId) {
    data.collections.push({
      id: newId(),
      agentId: tenant.agentId,
      tenantId: tenant.id,
      amount: payAmount,
      dateCollected: paidDate,
      remitted: false,
      remittedDate: null,
    });
  }
  return payment;
}

// If this is the very first landlord account ever created, any existing
// properties/tenants/agents that predate accounts (from before this update)
// automatically become theirs, instead of becoming invisible/orphaned.
function claimOrphanedDataIfFirstLandlord(data, user) {
  if (user.role !== "landlord") return;
  const landlordCount = data.users.filter((u) => u.role === "landlord").length;
  if (landlordCount !== 1) return;
  data.properties.forEach((p) => { if (!p.landlordId) p.landlordId = user.id; });
  data.tenants.forEach((t) => { if (!t.landlordId) t.landlordId = user.id; });
  data.agents.forEach((a) => { if (!a.landlordId) a.landlordId = user.id; });
}

app.get("/api/config", (req, res) => {
  // Client IDs aren't secret (unlike the Client Secret), so it's safe to
  // expose this to the frontend so it knows whether to show the Google button.
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// Generates a fresh 6-digit code for the given user, saves its hash + a
// 10-minute expiry, and sends it over whichever channels are available:
// always by email, and by WhatsApp too if the account has a phone number
// on file and Twilio is configured.
async function issueVerificationCode(data, user) {
  const code = generateOtp();
  user.verificationCodeHash = crypto.createHash("sha256").update(code).digest("hex");
  user.verificationCodeExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  writeData(data);

  const text = `Your TenancyHub verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`;
  await sendEmail(user.email, "Your TenancyHub verification code", text);
  if (user.phone) await sendWhatsApp(user.phone, text);
}

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }
  const validRoles = ["landlord", "tenant", "property_manager"];
  const finalRole = validRoles.includes(role) ? role : "landlord";

  const data = readData();
  const existing = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(400).json({ error: "An account with this email already exists" });

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = {
    id: newId(),
    name,
    email,
    phone: phone ? phone.trim() : "",
    passwordHash,
    role: finalRole,
    googleId: null,
    resetToken: null,
    resetTokenExpiry: null,
    verified: false,
    verificationCodeHash: null,
    verificationCodeExpiry: null,
  };
  data.users.push(user);
  claimOrphanedDataIfFirstLandlord(data, user);
  writeData(data);

  await issueVerificationCode(data, user);

  // Don't log them in yet — they need to enter the code first.
  res.json({ needsVerification: true, email: user.email });
});

app.post("/api/auth/verify-code", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Email and code are required" });

  const data = readData();
  const user = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(400).json({ error: "Account not found" });

  const hashedCode = crypto.createHash("sha256").update(code.trim()).digest("hex");
  if (
    !user.verificationCodeHash ||
    user.verificationCodeHash !== hashedCode ||
    !user.verificationCodeExpiry ||
    user.verificationCodeExpiry < Date.now()
  ) {
    return res.status(400).json({ error: "That code is incorrect or has expired. Request a new one." });
  }

  user.verified = true;
  user.verificationCodeHash = null;
  user.verificationCodeExpiry = null;
  writeData(data);

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.email = user.email;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post("/api/auth/resend-code", async (req, res) => {
  const { email } = req.body;
  const data = readData();
  const user = data.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());
  // Same non-committal response either way, to avoid confirming which emails exist.
  if (user && !user.verified) await issueVerificationCode(data, user);
  res.json({ ok: true });
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { email, password } = req.body;
  const data = readData();
  const user = data.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());

  if (!user) return res.status(401).json({ error: "Incorrect email or password" });

  if (!user.passwordHash) {
    return res.status(401).json({ error: "This account was created with Google Sign-In. Use the Google button instead." });
  }

  if (!bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  if (!user.verified) {
    return res.status(403).json({ error: "Please verify your account first.", needsVerification: true, email: user.email });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.email = user.email;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// A generic response either way — never confirm or deny whether an email
// address has an account. That's a small but real privacy/security habit.
app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  const data = readData();
  const user = data.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());

  if (user && user.passwordHash) {
    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = crypto.createHash("sha256").update(token).digest("hex");
    user.resetTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    writeData(data);

    const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}&email=${encodeURIComponent(user.email)}`;
    await sendEmail(
      user.email,
      "Reset your TenancyHub password",
      `Click this link to reset your password (expires in 1 hour):\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`
    );
  }

  res.json({ ok: true, message: "If that email has an account, a reset link has been sent." });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const data = readData();
  const user = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  if (!user || user.resetToken !== hashedToken || !user.resetTokenExpiry || user.resetTokenExpiry < Date.now()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.resetToken = null;
  user.resetTokenExpiry = null;
  writeData(data);
  res.json({ ok: true });
});

app.post("/api/auth/google", async (req, res) => {
  if (!googleClient) {
    return res.status(400).json({ error: "Google Sign-In isn't set up on this server yet." });
  }
  const { credential } = req.body;

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }

  const data = readData();
  let user = data.users.find((u) => u.email.toLowerCase() === payload.email.toLowerCase());

  if (!user) {
    // First time seeing this Google account — create a landlord account for
    // them (the only role with a working dashboard so far).
    user = {
      id: newId(),
      name: payload.name || payload.email,
      email: payload.email,
      phone: "",
      passwordHash: null,
      role: "landlord",
      googleId: payload.sub,
      resetToken: null,
      resetTokenExpiry: null,
      // Google has already verified this email address, so there's no need
      // to send our own verification code.
      verified: true,
      verificationCodeHash: null,
      verificationCodeExpiry: null,
    };
    data.users.push(user);
    claimOrphanedDataIfFirstLandlord(data, user);
    writeData(data);
  } else if (!user.googleId) {
    user.googleId = payload.sub;
    writeData(data);
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.email = user.email;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const data = readData();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "Not logged in" });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// ======================= PROPERTIES =======================

app.get("/api/properties", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const mine = data.properties.filter((p) => p.landlordId === req.session.userId);
  const withCounts = mine.map((p) => ({
    ...p,
    tenantCount: data.tenants.filter((t) => t.propertyId === p.id).length,
  }));
  res.json(withCounts);
});

app.post("/api/properties", requireAuth, requireLandlord, upload.single("image"), (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ error: "Property name is required" });

  const data = readData();
  const property = {
    id: newId(),
    name,
    address: address || "",
    landlordId: req.session.userId,
    imagePath: req.file ? "/uploads/" + req.file.filename : null,
    images: [],
  };
  data.properties.push(property);
  writeData(data);
  res.json(property);
});

app.post("/api/properties/:id/edit", requireAuth, requireLandlord, upload.single("image"), (req, res) => {
  const { name, address } = req.body;
  const data = readData();
  const property = data.properties.find((p) => p.id === req.params.id && p.landlordId === req.session.userId);
  if (!property) return res.status(404).json({ error: "Property not found" });

  if (name) property.name = name;
  if (address !== undefined) property.address = address;
  if (req.file) property.imagePath = "/uploads/" + req.file.filename; // otherwise keep the existing photo

  writeData(data);
  res.json(property);
});

// Property photo gallery — several photos per property, separate from the
// single "cover" imagePath shown on the property card.
app.post("/api/properties/:id/photos", requireAuth, requireLandlord, galleryUpload.array("photos", 10), (req, res) => {
  const data = readData();
  const property = data.properties.find((p) => p.id === req.params.id && p.landlordId === req.session.userId);
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No photos were received" });

  const added = req.files.map((f) => ({ id: newId(), path: "/uploads/" + f.filename }));
  property.images = [...(property.images || []), ...added];
  writeData(data);
  res.json(property);
});

app.delete("/api/properties/:id/photos/:photoId", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const property = data.properties.find((p) => p.id === req.params.id && p.landlordId === req.session.userId);
  if (!property) return res.status(404).json({ error: "Property not found" });

  property.images = (property.images || []).filter((img) => img.id !== req.params.photoId);
  writeData(data);
  res.json(property);
});

// ======================= TENANTS =======================

app.get("/api/tenants", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const tenants = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => {
      const property = data.properties.find((p) => p.id === t.propertyId);
      const agent = data.agents.find((a) => a.id === t.agentId);
      return {
        ...t,
        status: statusFor(t.dueDate, t.rentFrequency),
        balanceDue: remainingBalance(t),
        propertyName: property ? property.name : "No property set",
        agentName: agent ? agent.name : null,
        deposit: depositSummary(t),
      };
    });
  res.json(tenants);
});

app.post("/api/tenants", requireAuth, requireLandlord, (req, res) => {
  const { name, phone, email, propertyId, unit, rentAmount, rentFrequency, dueDate, agentId, depositAmount } = req.body;

  if (!name || !phone || !rentAmount || !dueDate) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const data = readData();
  const newTenant = {
    id: newId(),
    landlordId: req.session.userId,
    createdAt: new Date().toISOString(),
    name,
    phone,
    email: email || "",
    propertyId: propertyId || null,
    unit: unit || "",
    rentAmount: Number(rentAmount),
    rentFrequency: rentFrequency === "monthly" ? "monthly" : "yearly",
    dueDate,
    lastPaidDate: null,
    agentId: agentId || null,
    depositAmount: depositAmount ? Number(depositAmount) : 0,
    depositDeductions: [],
    depositRefundedAmount: null,
    depositRefundedDate: null,
    screening: {
      employer: "",
      statedIncome: "",
      guarantorName: "",
      guarantorPhone: "",
      refName: "",
      refPhone: "",
      notes: "",
      decision: "pending",
    },
  };
  data.tenants.push(newTenant);
  logActivity(data, newTenant.id, req.session.userId, "tenant_added", `${name} was added as a tenant`);
  writeData(data);
  res.json(newTenant);
});

app.post("/api/tenants/:id/edit", requireAuth, requireLandlord, (req, res) => {
  const { name, phone, email, propertyId, unit, rentAmount, rentFrequency, dueDate, agentId } = req.body;

  const data = readData();
  const tenant = data.tenants.find((t) => t.id === req.params.id && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  if (name) tenant.name = name;
  if (phone) tenant.phone = phone;
  if (email !== undefined) tenant.email = email;
  if (propertyId !== undefined) tenant.propertyId = propertyId || null;
  if (unit !== undefined) tenant.unit = unit;
  if (rentAmount) tenant.rentAmount = Number(rentAmount);
  if (rentFrequency) tenant.rentFrequency = rentFrequency === "monthly" ? "monthly" : "yearly";
  if (dueDate) tenant.dueDate = dueDate;
  if (agentId !== undefined) tenant.agentId = agentId || null;

  writeData(data);
  res.json(tenant);
});

app.post("/api/tenants/:id/pay", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const tenant = data.tenants.find((t) => t.id === req.params.id && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { amount } = req.body || {};
  if (amount !== undefined && amount !== null && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "Enter a payment amount greater than ₦0" });
    }
  }

  const payment = recordTenantPayment(data, tenant, req.session.userId, amount);
  writeData(data);
  res.json({ ...tenant, lastPaymentId: payment.id });
});

// Sends the same reminder message as the WhatsApp button, but by email —
// only works if the tenant has an email on file and EMAIL_USER/EMAIL_APP_PASSWORD
// are configured in .env.
app.post("/api/tenants/:id/remind-email", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const tenant = data.tenants.find((t) => t.id === req.params.id && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  if (!tenant.email) return res.status(400).json({ error: "This tenant has no email on file" });

  const property = data.properties.find((p) => p.id === tenant.propertyId);
  sendEmail(tenant.email, "Rent payment reminder", rentReminderMessage(tenant, property));
  res.json({ ok: true });
});

// Reminder Center — send an email reminder to several tenants in one go.
// If tenantIds is omitted, targets every overdue/due-soon tenant of this
// landlord. Tenants without an email on file are reported back as skipped
// rather than causing the whole batch to fail.
app.post("/api/reminders/bulk-email", requireAuth, requireLandlord, async (req, res) => {
  const data = readData();
  const { tenantIds } = req.body || {};

  let targets = data.tenants.filter((t) => t.landlordId === req.session.userId);
  if (Array.isArray(tenantIds) && tenantIds.length > 0) {
    targets = targets.filter((t) => tenantIds.includes(t.id));
  } else {
    targets = targets.filter((t) => {
      const s = statusFor(t.dueDate, t.rentFrequency);
      return s === "overdue" || s === "due_soon";
    });
  }

  const sent = [];
  const skipped = [];
  for (const tenant of targets) {
    if (!tenant.email) {
      skipped.push({ id: tenant.id, name: tenant.name, reason: "No email on file" });
      continue;
    }
    const property = data.properties.find((p) => p.id === tenant.propertyId);
    const ok = await sendEmail(tenant.email, "Rent payment reminder", rentReminderMessage(tenant, property));
    if (ok) {
      tenant.lastReminderSentDate = new Date().toISOString().slice(0, 10);
      sent.push({ id: tenant.id, name: tenant.name });
    } else {
      skipped.push({ id: tenant.id, name: tenant.name, reason: "Email couldn't be sent" });
    }
  }

  writeData(data);
  res.json({ sent, skipped });
});

app.delete("/api/tenants/:id", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  data.tenants = data.tenants.filter(
    (t) => !(t.id === req.params.id && t.landlordId === req.session.userId)
  );
  writeData(data);
  res.json({ ok: true });
});

// ======================= MAINTENANCE REQUESTS =======================

app.get("/api/maintenance", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => t.id);

  const requests = data.maintenanceRequests
    .filter((r) => myTenantIds.includes(r.tenantId))
    .map((r) => {
      const tenant = data.tenants.find((t) => t.id === r.tenantId);
      return { ...r, tenantName: tenant ? tenant.name : "Unknown tenant" };
    });
  res.json(requests);
});

app.post("/api/maintenance", requireAuth, requireLandlord, upload.single("image"), (req, res) => {
  const { tenantId, description } = req.body;
  if (!tenantId || !description) {
    return res.status(400).json({ error: "Tenant and description are required" });
  }

  const data = readData();
  const tenant = data.tenants.find((t) => t.id === tenantId && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const request = {
    id: newId(),
    tenantId,
    description,
    status: "open",
    dateCreated: new Date().toISOString().slice(0, 10),
    imagePath: req.file ? "/uploads/" + req.file.filename : null,
  };
  data.maintenanceRequests.push(request);
  addNotification(data, req.session.userId, `New maintenance request from ${tenant.name}: ${description}`);
  logActivity(data, tenant.id, req.session.userId, "maintenance", `Maintenance request logged: ${description}`);
  writeData(data);

  const landlord = data.users.find((u) => u.id === req.session.userId);
  if (landlord) {
    sendEmail(
      landlord.email,
      "New maintenance request — TenancyHub",
      `${tenant.name} reported: ${description}\n\nLog in to TenancyHub to track its status.`
    );
  }

  res.json(request);
});

app.post("/api/maintenance/:id/status", requireAuth, requireLandlord, (req, res) => {
  const { status } = req.body;
  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => t.id);

  const request = data.maintenanceRequests.find(
    (r) => r.id === req.params.id && myTenantIds.includes(r.tenantId)
  );
  if (!request) return res.status(404).json({ error: "Request not found" });

  const statusLabel = { open: "Open", in_progress: "In progress", done: "Done" };
  request.status = status;
  logActivity(data, request.tenantId, req.session.userId, "maintenance", `Maintenance status changed to ${statusLabel[status] || status}: ${request.description}`);
  writeData(data);
  res.json(request);
});

// ======================= LEASE AGREEMENTS =======================

app.get("/api/agreements", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => t.id);

  const agreements = data.agreements
    .filter((a) => myTenantIds.includes(a.tenantId))
    .map((a) => {
      const tenant = data.tenants.find((t) => t.id === a.tenantId);
      return { ...a, tenantName: tenant ? tenant.name : "Unknown tenant" };
    });
  res.json(agreements);
});

app.post("/api/agreements", requireAuth, requireLandlord, (req, res) => {
  const { tenantId, title, text, expiryDate } = req.body;
  if (!tenantId || !title || !text) {
    return res.status(400).json({ error: "Tenant, title, and agreement text are required" });
  }

  const data = readData();
  const tenant = data.tenants.find((t) => t.id === tenantId && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const agreement = {
    id: newId(),
    tenantId,
    title,
    text,
    status: "unsigned",
    signedByName: null,
    signedAt: null,
    createdAt: new Date().toISOString(),
    expiryDate: expiryDate || null,
  };
  data.agreements.push(agreement);
  logActivity(data, tenant.id, req.session.userId, "agreement", `Agreement created: ${title}`);
  writeData(data);
  res.json(agreement);
});

app.post("/api/agreements/:id/sign", requireAuth, requireLandlord, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Signer name is required" });

  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => t.id);
  const agreement = data.agreements.find(
    (a) => a.id === req.params.id && myTenantIds.includes(a.tenantId)
  );
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  agreement.status = "signed";
  agreement.signedByName = name;
  agreement.signedAt = new Date().toISOString();
  addNotification(data, req.session.userId, `${name} signed the agreement "${agreement.title}"`);
  logActivity(data, agreement.tenantId, req.session.userId, "agreement", `Agreement signed by ${name}: ${agreement.title}`);
  writeData(data);
  res.json(agreement);
});

// ======================= AGENTS & COLLECTIONS =======================

app.get("/api/agents", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const agents = data.agents
    .filter((a) => a.landlordId === req.session.userId)
    .map((a) => {
      const agentCollections = data.collections.filter((c) => c.agentId === a.id);
      const totalCollected = agentCollections.reduce((sum, c) => sum + c.amount, 0);
      const totalRemitted = agentCollections
        .filter((c) => c.remitted)
        .reduce((sum, c) => sum + c.amount, 0);
      return { ...a, totalCollected, totalRemitted, outstanding: totalCollected - totalRemitted };
    });
  res.json(agents);
});

app.post("/api/agents", requireAuth, requireLandlord, (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: "Agent name is required" });

  const data = readData();
  const agent = { id: newId(), name, phone: phone || "", landlordId: req.session.userId };
  data.agents.push(agent);
  writeData(data);
  res.json(agent);
});

app.get("/api/collections", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myAgentIds = data.agents
    .filter((a) => a.landlordId === req.session.userId)
    .map((a) => a.id);

  const collections = data.collections
    .filter((c) => myAgentIds.includes(c.agentId))
    .map((c) => {
      const agent = data.agents.find((a) => a.id === c.agentId);
      const tenant = data.tenants.find((t) => t.id === c.tenantId);
      return {
        ...c,
        agentName: agent ? agent.name : "Unknown agent",
        tenantName: tenant ? tenant.name : "Unknown tenant",
      };
    });
  res.json(collections);
});

app.post("/api/collections/:id/remit", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myAgentIds = data.agents
    .filter((a) => a.landlordId === req.session.userId)
    .map((a) => a.id);
  const collection = data.collections.find(
    (c) => c.id === req.params.id && myAgentIds.includes(c.agentId)
  );
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  collection.remitted = true;
  collection.remittedDate = new Date().toISOString().slice(0, 10);
  const agent = data.agents.find((a) => a.id === collection.agentId);
  addNotification(data, req.session.userId, `${agent ? agent.name : "An agent"} remitted ${collection.amount.toLocaleString()}`);
  writeData(data);
  res.json(collection);
});

// ======================= TENANT PORTAL =======================
// Everything here is scoped to the tenant record linked to the logged-in
// Tenant user (see linkTenantAccount above) — a tenant can only ever see
// and act on their own tenancy, never anyone else's.

app.get("/api/tenant/me", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = linkTenantAccount(data, { id: req.session.userId, role: "tenant", email: req.session.email });
  if (!tenant) return res.json({ linked: false });

  const property = data.properties.find((p) => p.id === tenant.propertyId);
  const agent = data.agents.find((a) => a.id === tenant.agentId);
  res.json({
    linked: true,
    ...tenant,
    status: statusFor(tenant.dueDate, tenant.rentFrequency),
    balanceDue: remainingBalance(tenant),
    propertyName: property ? property.name : "No property set",
    propertyAddress: property ? property.address : "",
    agentName: agent ? agent.name : null,
    deposit: depositSummary(tenant),
  });
});

app.get("/api/tenant/payments", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json([]);
  const payments = data.payments
    .filter((p) => p.tenantId === tenant.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(payments);
});

// The tenant can't actually move money through the app — this just tells
// the landlord "I believe I've paid, please check and confirm", the same
// low-tech way a WhatsApp message would. The landlord still marks it paid
// themselves (via the existing /api/tenants/:id/pay route) once they've
// verified it hit their account.
app.post("/api/tenant/payments/notify", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const { amount } = req.body || {};
  const owed = remainingBalance(tenant);
  let claimAmount = owed > 0 ? owed : tenant.rentAmount;
  if (amount !== undefined && amount !== null && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "Enter a payment amount greater than ₦0" });
    }
    claimAmount = n;
  }

  tenant.pendingPaymentClaim = { date: new Date().toISOString(), amount: claimAmount };
  addNotification(
    data,
    tenant.landlordId,
    `${tenant.name} says they've paid ₦${claimAmount.toLocaleString()} rent — please confirm`
  );
  writeData(data);
  res.json({ ok: true, tenant });
});

app.get("/api/tenant/agreements", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json([]);
  const agreements = data.agreements.filter((a) => a.tenantId === tenant.id);
  res.json(agreements);
});

app.post("/api/tenant/agreements/:id/sign", requireAuth, requireTenant, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Your name is required to sign" });

  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const agreement = data.agreements.find((a) => a.id === req.params.id && a.tenantId === tenant.id);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (agreement.status === "signed") return res.status(400).json({ error: "This agreement is already signed" });

  agreement.status = "signed";
  agreement.signedByName = name;
  agreement.signedAt = new Date().toISOString();
  addNotification(data, tenant.landlordId, `${name} signed the agreement "${agreement.title}"`);
  logActivity(data, tenant.id, tenant.landlordId, "agreement", `Agreement signed by ${name}: ${agreement.title}`);
  writeData(data);
  res.json(agreement);
});

app.get("/api/tenant/maintenance", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json([]);
  const requests = data.maintenanceRequests
    .filter((r) => r.tenantId === tenant.id)
    .sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));
  res.json(requests);
});

app.post("/api/tenant/maintenance", requireAuth, requireTenant, upload.single("image"), (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: "Please describe the problem" });

  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const request = {
    id: newId(),
    tenantId: tenant.id,
    description,
    status: "open",
    dateCreated: new Date().toISOString().slice(0, 10),
    imagePath: req.file ? "/uploads/" + req.file.filename : null,
  };
  data.maintenanceRequests.push(request);
  addNotification(data, tenant.landlordId, `New maintenance request from ${tenant.name}: ${description}`);
  logActivity(data, tenant.id, tenant.landlordId, "maintenance", `Maintenance request logged: ${description}`);
  writeData(data);

  const landlord = data.users.find((u) => u.id === tenant.landlordId);
  if (landlord) {
    sendEmail(
      landlord.email,
      "New maintenance request — TenancyHub",
      `${tenant.name} reported: ${description}\n\nLog in to TenancyHub to track its status.`
    );
  }
  res.json(request);
});

// Used by the new shared features (messaging, receipts) where either the
// landlord themselves or a manager acting for them should have access.
function requireLandlordOrManager(req, res, next) {
  if (req.session.role === "landlord") {
    req.workspaceLandlordId = req.session.userId;
    req.actorName = null; // filled in per-route from the user record when needed
    return next();
  }
  if (req.session.role === "property_manager") {
    return requireManager(req, res, next);
  }
  return res.status(403).json({ error: "This account type doesn't have this feature" });
}

function rentReminderMessage(tenant, property) {
  const rentWord = tenant.rentFrequency === "monthly" ? "monthly rent" : "annual rent";
  return (
    `Hello ${tenant.name}, this is a friendly reminder that your ${rentWord} of ₦${tenant.rentAmount.toLocaleString()} ` +
    `for ${property ? property.name : "your unit"} was due on ${tenant.dueDate}. ` +
    `Kindly let us know when we can expect payment. Thank you!`
  );
}

// ======================= DEPOSITS =======================

function findOwnedTenant(data, tenantId, landlordId) {
  return data.tenants.find((t) => t.id === tenantId && t.landlordId === landlordId);
}

app.post("/api/tenants/:id/deposit/set", requireAuth, requireLandlord, (req, res) => {
  const { depositAmount } = req.body;
  const data = readData();
  const tenant = findOwnedTenant(data, req.params.id, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  tenant.depositAmount = Number(depositAmount) || 0;
  writeData(data);
  res.json({ tenant, deposit: depositSummary(tenant) });
});

app.post("/api/tenants/:id/deposit/deduction", requireAuth, requireLandlord, (req, res) => {
  const { description, amount } = req.body;
  if (!description || !amount) {
    return res.status(400).json({ error: "Description and amount are required" });
  }

  const data = readData();
  const tenant = findOwnedTenant(data, req.params.id, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  tenant.depositDeductions.push({ id: newId(), description, amount: Number(amount) });
  logActivity(data, tenant.id, req.session.userId, "deposit", `Deposit deduction: ₦${Number(amount).toLocaleString()} — ${description}`);
  writeData(data);
  res.json({ tenant, deposit: depositSummary(tenant) });
});

app.post("/api/tenants/:id/deposit/refund", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const tenant = findOwnedTenant(data, req.params.id, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const summary = depositSummary(tenant);
  tenant.depositRefundedAmount = summary.netRefundable;
  tenant.depositRefundedDate = new Date().toISOString().slice(0, 10);
  addNotification(data, req.session.userId, `Deposit refunded to ${tenant.name}: ₦${summary.netRefundable.toLocaleString()}`);
  logActivity(data, tenant.id, req.session.userId, "deposit", `Deposit refunded: ₦${summary.netRefundable.toLocaleString()}`);
  writeData(data);
  res.json({ tenant, deposit: depositSummary(tenant) });
});

// ======================= TENANT SCREENING (basic, no ID verification) =======================

app.post("/api/tenants/:id/screening", requireAuth, requireLandlord, (req, res) => {
  const { employer, statedIncome, guarantorName, guarantorPhone, refName, refPhone, notes, decision } = req.body;

  const data = readData();
  const tenant = findOwnedTenant(data, req.params.id, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  tenant.screening = {
    employer: employer || "",
    statedIncome: statedIncome || "",
    guarantorName: guarantorName || "",
    guarantorPhone: guarantorPhone || "",
    refName: refName || "",
    refPhone: refPhone || "",
    notes: notes || "",
    decision: decision || "pending",
  };
  writeData(data);
  res.json(tenant);
});

// ======================= REPORTS =======================

app.get("/api/reports/summary", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myProperties = data.properties.filter((p) => p.landlordId === req.session.userId);
  const myTenants = data.tenants.filter((t) => t.landlordId === req.session.userId);
  const myTenantIds = myTenants.map((t) => t.id);
  const myAgents = data.agents.filter((a) => a.landlordId === req.session.userId);
  const myPayments = data.payments.filter((p) => p.landlordId === req.session.userId);
  const myMaintenance = data.maintenanceRequests.filter((r) => myTenantIds.includes(r.tenantId));

  // Different tenants pay on different schedules (yearly vs monthly), so to
  // compare them fairly, "expected annual income" puts everyone on the same
  // yearly basis.
  const totalExpectedAnnual = myTenants.reduce((sum, t) => {
    return sum + (t.rentFrequency === "monthly" ? t.rentAmount * 12 : t.rentAmount);
  }, 0);

  const currentYear = new Date().getFullYear();
  const totalCollectedThisYear = myPayments
    .filter((p) => new Date(p.date).getFullYear() === currentYear)
    .reduce((sum, p) => sum + p.amount, 0);

  const depositsHeldTotal = myTenants.reduce((sum, t) => {
    const summary = depositSummary(t);
    return sum + (summary.status === "held" ? summary.netRefundable : 0);
  }, 0);

  const agentsOutstandingTotal = myAgents.reduce((sum, a) => {
    const agentCollections = data.collections.filter((c) => c.agentId === a.id);
    const collected = agentCollections.reduce((s, c) => s + c.amount, 0);
    const remitted = agentCollections.filter((c) => c.remitted).reduce((s, c) => s + c.amount, 0);
    return sum + (collected - remitted);
  }, 0);

  // Trailing 6 months of income, oldest first, for the dashboard chart.
  const now = new Date();
  const monthlyIncome = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    monthlyIncome.push({
      label: monthDate.toLocaleDateString("en-NG", { month: "short", year: "2-digit" }),
      total: myPayments.filter((p) => p.date && p.date.slice(0, 7) === monthKey).reduce((sum, p) => sum + p.amount, 0),
    });
  }

  // Occupancy: a property counts as occupied if any of your tenants is assigned to it.
  const occupiedPropertyIds = new Set(myTenants.filter((t) => t.propertyId).map((t) => t.propertyId));
  const occupiedProperties = myProperties.filter((p) => occupiedPropertyIds.has(p.id)).length;
  const occupancyRate = myProperties.length > 0 ? Math.round((occupiedProperties / myProperties.length) * 100) : 0;

  // Tenants added before this field existed have createdAt: null and are
  // correctly excluded here, rather than guessed at.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newTenantsThisMonth = myTenants.filter((t) => t.createdAt && new Date(t.createdAt) >= monthStart).length;

  // Lease renewals: agreements with an expiry date within the next 60 days,
  // or expired within the last 7 (so a landlord doesn't miss one that just
  // lapsed). Only agreements created with an expiry date show up here —
  // older agreements without one are correctly excluded, not guessed at.
  const myTenantIdsForAgreements = myTenants.map((t) => t.id);
  const leaseRenewals = data.agreements
    .filter((a) => a.expiryDate && myTenantIdsForAgreements.includes(a.tenantId))
    .map((a) => {
      const tenant = myTenants.find((t) => t.id === a.tenantId);
      const daysUntil = Math.round((new Date(a.expiryDate) - now) / (24 * 60 * 60 * 1000));
      return { agreementId: a.id, tenantId: a.tenantId, tenantName: tenant ? tenant.name : "Unknown tenant", title: a.title, expiryDate: a.expiryDate, daysUntil };
    })
    .filter((a) => a.daysUntil <= 60 && a.daysUntil >= -7)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  res.json({
    propertiesCount: myProperties.length,
    tenantsCount: myTenants.length,
    totalExpectedAnnual,
    totalCollectedThisYear,
    overdueCount: myTenants.filter((t) => statusFor(t.dueDate, t.rentFrequency) === "overdue").length,
    maintenanceOpenCount: myMaintenance.filter((r) => r.status !== "done").length,
    maintenanceDoneCount: myMaintenance.filter((r) => r.status === "done").length,
    agentsOutstandingTotal,
    depositsHeldTotal,
    monthlyIncome,
    occupiedProperties,
    vacantProperties: myProperties.length - occupiedProperties,
    occupancyRate,
    newTenantsThisMonth,
    leaseRenewals,
  });
});

// ======================= NOTIFICATIONS =======================

app.get("/api/notifications", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const mine = data.notifications
    .filter((n) => n.landlordId === req.session.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(mine);
});

app.post("/api/notifications/:id/read", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const note = data.notifications.find((n) => n.id === req.params.id && n.landlordId === req.session.userId);
  if (!note) return res.status(404).json({ error: "Notification not found" });
  note.read = true;
  writeData(data);
  res.json(note);
});

app.post("/api/notifications/read-all", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  data.notifications.forEach((n) => {
    if (n.landlordId === req.session.userId) n.read = true;
  });
  writeData(data);
  res.json({ ok: true });
});

// ======================= MESSAGING (landlord/manager <-> tenant) =======================

function findTenantInWorkspace(data, tenantId, landlordId) {
  return data.tenants.find((t) => t.id === tenantId && t.landlordId === landlordId);
}

// Clears out any pins whose time has run out. Called every time a thread is
// loaded, so pinned messages disappear on their own after 7 or 30 days.
function clearExpiredPins(data, tenantId) {
  const now = Date.now();
  let changed = false;
  data.messages.forEach((m) => {
    if (m.tenantId === tenantId && m.pinnedUntil && new Date(m.pinnedUntil).getTime() < now) {
      m.pinnedUntil = null;
      changed = true;
    }
  });
  return changed;
}

// Resolves which landlord's workspace this request belongs to, for either
// a landlord themselves or a property manager acting for one. Returns null
// if the session's role is neither (e.g. tenant), without rejecting the
// request — the caller decides what that means.
function resolveWorkspaceLandlordId(req, data) {
  if (req.session.role === "landlord") return req.session.userId;
  if (req.session.role === "property_manager") {
    const manager = linkManagerAccount(data, { id: req.session.userId, role: "property_manager", email: req.session.email });
    return manager ? manager.landlordId : null;
  }
  return null;
}

// Shared check used by every action that touches an existing message (pin,
// react, delete-for-me): does this session belong to either side of the
// conversation that message lives in?
function canAccessThread(req, data, tenant) {
  const isLandlordSide = resolveWorkspaceLandlordId(req, data) === tenant.landlordId;
  const isTenantSide = req.session.role === "tenant" && findTenantForUser(data, req.session.userId)?.id === tenant.id;
  return isLandlordSide || isTenantSide;
}

// A stable "who is this" key for reactions/delete-for-me, since a message's
// audience includes tenants, landlords, and any property managers acting for
// that landlord — not just the two accounts that started the thread.
function currentActorId(req) {
  return req.session.userId;
}

// Trims a message down to what the *requesting* user should see: hidden if
// they deleted it for themselves, otherwise as-is.
function visibleThread(messages, userId) {
  return messages.filter((m) => !(m.deletedFor || []).includes(userId)).map((m) => serializeMessage(m, userId));
}

// A long-running thread shouldn't ship its entire history on every load —
// return the most recent page, or (given ?before=<ISO date>) the page just
// before that, so the client can load older messages on demand.
const MESSAGE_PAGE_SIZE = 40;
function paginateThread(thread, beforeIso) {
  const pool = beforeIso ? thread.filter((m) => new Date(m.createdAt) < new Date(beforeIso)) : thread;
  const hasMore = pool.length > MESSAGE_PAGE_SIZE;
  const page = pool.slice(Math.max(0, pool.length - MESSAGE_PAGE_SIZE));
  return { page, hasMore };
}

// Turns the raw {emoji: [userId, ...]} reaction storage into a display-ready
// {emoji: {count, mine}} shape, so the browser never needs to know its own
// user id just to render a reaction pill.
// Editing is only allowed by the exact account that sent the message, and
// only for a short window afterward — long enough to fix a typo, not long
// enough to quietly rewrite something someone already relied on.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function serializeMessage(m, viewerId) {
  const reactions = {};
  Object.entries(m.reactions || {}).forEach(([emoji, userIds]) => {
    if (userIds.length === 0) return;
    reactions[emoji] = { count: userIds.length, mine: userIds.includes(viewerId) };
  });
  const canEdit = m.senderId === viewerId && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
  return { ...m, reactions, canEdit };
}

// NOTE: every literal-path route below (unread-counts, search, broadcast)
// must be registered BEFORE the "/api/messages/:tenantId" wildcard route,
// or Express will match ":tenantId" first and treat e.g. "search" as a
// tenant id — this previously broke unread-counts silently (it 404'd, and
// the dashboard read the error body as if it were a counts map).

// Landlord or manager: unread message count per tenant, so the tenant list can badge it.
app.get("/api/messages/unread-counts", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.workspaceLandlordId)
    .map((t) => t.id);
  const counts = {};
  data.messages
    .filter((m) => myTenantIds.includes(m.tenantId) && m.senderRole === "tenant" && !m.readByLandlord)
    .forEach((m) => { counts[m.tenantId] = (counts[m.tenantId] || 0) + 1; });
  res.json(counts);
});

// Landlord or manager: search message text across every tenant conversation.
app.get("/api/messages/search", requireAuth, requireLandlordOrManager, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);

  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.workspaceLandlordId)
    .map((t) => t.id);
  const userId = currentActorId(req);

  const results = data.messages
    .filter(
      (m) =>
        myTenantIds.includes(m.tenantId) &&
        m.text &&
        m.text.toLowerCase().includes(q) &&
        !(m.deletedFor || []).includes(userId)
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30)
    .map((m) => {
      const tenant = data.tenants.find((t) => t.id === m.tenantId);
      return {
        id: m.id,
        tenantId: m.tenantId,
        tenantName: tenant ? tenant.name : "Unknown tenant",
        senderName: m.senderName,
        text: m.text,
        createdAt: m.createdAt,
      };
    });
  res.json(results);
});

// Landlord or manager: send one announcement to every tenant at once
// (e.g. "water will be off Saturday") — a real, frequent need that isn't
// an AI feature, just fan-out of the same message to every thread.
app.post("/api/messages/broadcast", requireAuth, requireLandlordOrManager, chatMessageLimiter, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Message can't be empty" });

  const data = readData();
  const myTenants = data.tenants.filter((t) => t.landlordId === req.workspaceLandlordId);
  if (myTenants.length === 0) return res.status(400).json({ error: "No tenants to send to yet" });

  const sender = data.users.find((u) => u.id === req.session.userId);
  const senderName = req.session.role === "property_manager"
    ? `${sender ? sender.name : "Property manager"} (manager)`
    : (sender ? sender.name : "Landlord");
  const createdAt = new Date().toISOString();

  myTenants.forEach((tenant) => {
    data.messages.push({
      id: newId(),
      landlordId: req.workspaceLandlordId,
      tenantId: tenant.id,
      senderRole: req.session.role === "property_manager" ? "manager" : "landlord",
      senderId: req.session.userId,
      senderName,
      text: text.trim(),
      createdAt,
      readByLandlord: true,
      readByTenant: false,
      pinnedUntil: null,
      attachmentUrl: null,
      attachmentType: null,
      attachmentName: null,
      replyToId: null,
      reactions: {},
      deletedFor: [],
      edited: false,
      editHistory: [],
      cardType: "broadcast",
      cardData: null,
    });
  });
  writeData(data);
  res.json({ ok: true, recipientCount: myTenants.length });
});

// Landlord or manager: view a thread with one tenant.
app.get("/api/messages/:tenantId", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  clearExpiredPins(data, tenant.id);
  const thread = data.messages
    .filter((m) => m.tenantId === tenant.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Capture which message was the first unread one *before* we mark
  // everything read below, so the client can draw an "unread" divider there.
  const firstUnread = thread.find((m) => m.senderRole === "tenant" && !m.readByLandlord);
  const firstUnreadId = firstUnread ? firstUnread.id : null;

  thread.forEach((m) => { if (m.senderRole === "tenant") m.readByLandlord = true; });
  writeData(data);
  const { page, hasMore } = paginateThread(thread, req.query.before);
  res.json({ messages: visibleThread(page, currentActorId(req)), firstUnreadId, hasMore });
});

// Landlord or manager: send a message to a tenant.
app.post("/api/messages/:tenantId", requireAuth, requireLandlordOrManager, chatMessageLimiter, (req, res) => {
  const { text, replyToId } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Message can't be empty" });

  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const sender = data.users.find((u) => u.id === req.session.userId);
  const senderName = req.session.role === "property_manager"
    ? `${sender ? sender.name : "Property manager"} (manager)`
    : (sender ? sender.name : "Landlord");

  const message = {
    id: newId(),
    landlordId: req.workspaceLandlordId,
    tenantId: tenant.id,
    senderRole: req.session.role === "property_manager" ? "manager" : "landlord",
    senderName,
    senderId: req.session.userId,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    readByLandlord: true,
    readByTenant: false,
    pinnedUntil: null,
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    replyToId: replyToId && data.messages.some((m) => m.id === replyToId && m.tenantId === tenant.id) ? replyToId : null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: null,
    cardData: null,
  };
  data.messages.push(message);
  writeData(data);
  res.json(message);
});

// Landlord or manager: send an image, video, or PDF to a tenant (with an optional caption).
app.post("/api/messages/:tenantId/upload", requireAuth, requireLandlordOrManager, chatUploadLimiter, chatUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was received" });

  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const sender = data.users.find((u) => u.id === req.session.userId);
  const senderName = req.session.role === "property_manager"
    ? `${sender ? sender.name : "Property manager"} (manager)`
    : (sender ? sender.name : "Landlord");

  const replyToId = req.body.replyToId;
  const message = {
    id: newId(),
    landlordId: req.workspaceLandlordId,
    tenantId: tenant.id,
    senderRole: req.session.role === "property_manager" ? "manager" : "landlord",
    senderName,
    senderId: req.session.userId,
    text: (req.body.text || "").trim(),
    createdAt: new Date().toISOString(),
    readByLandlord: true,
    readByTenant: false,
    pinnedUntil: null,
    attachmentUrl: "/uploads/" + req.file.filename,
    attachmentType: attachmentTypeFor(req.file.mimetype),
    attachmentName: req.file.originalname,
    replyToId: replyToId && data.messages.some((m) => m.id === replyToId && m.tenantId === tenant.id) ? replyToId : null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: null,
    cardData: null,
  };
  data.messages.push(message);
  writeData(data);
  res.json(message);
});

// "Typing…" indicator — pinged while the landlord/manager is composing, and
// polled by the tenant side. Not persisted (see typingState above).
app.post("/api/messages/:tenantId/typing", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  setTyping(tenant.id, "landlord");
  res.json({ ok: true });
});

app.get("/api/messages/:tenantId/typing-status", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  res.json({ typing: isTyping(tenant.id, "tenant") });
});

// Pin or unpin a message for 7 or 30 days. Works for either side of the
// conversation — access is checked against the tenant thread the message
// belongs to, not against who originally sent it.
app.post("/api/messages/:id/pin", requireAuth, (req, res) => {
  const { duration } = req.body; // "7d" or "30d"
  const days = duration === "30d" ? 30 : 7;

  const data = readData();
  const message = data.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const tenant = data.tenants.find((t) => t.id === message.tenantId);
  if (!tenant) return res.status(404).json({ error: "Conversation not found" });
  if (!canAccessThread(req, data, tenant)) return res.status(403).json({ error: "Not allowed" });

  message.pinnedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  writeData(data);
  res.json(message);
});

app.post("/api/messages/:id/unpin", requireAuth, (req, res) => {
  const data = readData();
  const message = data.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const tenant = data.tenants.find((t) => t.id === message.tenantId);
  if (!tenant) return res.status(404).json({ error: "Conversation not found" });
  if (!canAccessThread(req, data, tenant)) return res.status(403).json({ error: "Not allowed" });

  message.pinnedUntil = null;
  writeData(data);
  res.json(message);
});

// React to a message with one of a small fixed set of emoji. Sending the
// same emoji again removes it (toggle); sending a different emoji swaps it —
// one reaction per person per message, the same model WhatsApp uses.
const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "😢"];
app.post("/api/messages/:id/react", requireAuth, (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED_REACTIONS.includes(emoji)) return res.status(400).json({ error: "Unsupported reaction" });

  const data = readData();
  const message = data.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const tenant = data.tenants.find((t) => t.id === message.tenantId);
  if (!tenant) return res.status(404).json({ error: "Conversation not found" });
  if (!canAccessThread(req, data, tenant)) return res.status(403).json({ error: "Not allowed" });

  const userId = currentActorId(req);
  message.reactions = message.reactions || {};
  const alreadyReactedWithThis = (message.reactions[emoji] || []).includes(userId);

  // Remove this user from every emoji first (one reaction per person), then
  // re-add them to the one they picked, unless that's the toggle-off case.
  Object.keys(message.reactions).forEach((key) => {
    message.reactions[key] = message.reactions[key].filter((id) => id !== userId);
    if (message.reactions[key].length === 0) delete message.reactions[key];
  });
  if (!alreadyReactedWithThis) {
    message.reactions[emoji] = [...(message.reactions[emoji] || []), userId];
  }

  writeData(data);
  res.json(serializeMessage(message, userId));
});

// Delete for me: hides a message for the requesting user only. The message
// stays intact for everyone else and on the server, unlike a true delete —
// keeping the record is deliberate given rent/maintenance messages can
// matter later (see conversation history).
app.post("/api/messages/:id/delete-for-me", requireAuth, (req, res) => {
  const data = readData();
  const message = data.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const tenant = data.tenants.find((t) => t.id === message.tenantId);
  if (!tenant) return res.status(404).json({ error: "Conversation not found" });
  if (!canAccessThread(req, data, tenant)) return res.status(403).json({ error: "Not allowed" });

  const userId = currentActorId(req);
  message.deletedFor = message.deletedFor || [];
  if (!message.deletedFor.includes(userId)) message.deletedFor.push(userId);

  writeData(data);
  res.json({ ok: true });
});

// Edit a message's text. Only the original sender, only within a short
// window, and the previous text is always kept in editHistory — never
// silently overwritten — for the same reason delete-for-everyone is a
// soft-delete: these threads can matter as a record later.
app.post("/api/messages/:id/edit", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Message can't be empty" });

  const data = readData();
  const message = data.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const tenant = data.tenants.find((t) => t.id === message.tenantId);
  if (!tenant) return res.status(404).json({ error: "Conversation not found" });
  if (!canAccessThread(req, data, tenant)) return res.status(403).json({ error: "Not allowed" });

  const userId = currentActorId(req);
  if (message.senderId !== userId) return res.status(403).json({ error: "You can only edit your own messages" });
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
    return res.status(403).json({ error: "This message is too old to edit" });
  }

  message.editHistory = message.editHistory || [];
  message.editHistory.push({ text: message.text, editedAt: new Date().toISOString() });
  message.text = text.trim();
  message.edited = true;

  writeData(data);
  res.json(serializeMessage(message, userId));
});

// Landlord or manager: send a tenant's rent receipt into the chat as a
// structured card (amount, date, receipt number) rather than a raw PDF —
// the chat becomes a view into the actual payment record, not a file drop.
app.post("/api/messages/:tenantId/send-receipt", requireAuth, requireLandlordOrManager, chatMessageLimiter, (req, res) => {
  const { paymentId } = req.body;
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.tenantId, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const payment = data.payments.find((p) => p.id === paymentId && p.tenantId === tenant.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const sender = data.users.find((u) => u.id === req.session.userId);
  const senderName = req.session.role === "property_manager"
    ? `${sender ? sender.name : "Property manager"} (manager)`
    : (sender ? sender.name : "Landlord");

  const message = {
    id: newId(),
    landlordId: req.workspaceLandlordId,
    tenantId: tenant.id,
    senderRole: req.session.role === "property_manager" ? "manager" : "landlord",
    senderId: req.session.userId,
    senderName,
    text: "",
    createdAt: new Date().toISOString(),
    readByLandlord: true,
    readByTenant: false,
    pinnedUntil: null,
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    replyToId: null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: "receipt",
    cardData: {
      paymentId: payment.id,
      amount: payment.amount,
      date: payment.date,
      receiptNumber: payment.receiptNumber,
    },
  };
  data.messages.push(message);
  writeData(data);
  res.json(serializeMessage(message, req.session.userId));
});

// Landlord: post a maintenance request's current status into the chat as a
// card. Landlord-only for now, matching the existing "/api/maintenance"
// routes — property managers don't have maintenance access in this app yet,
// so this deliberately doesn't get ahead of that.
app.post("/api/messages/:tenantId/send-maintenance-update", requireAuth, requireLandlord, chatMessageLimiter, (req, res) => {
  const { maintenanceId } = req.body;
  const data = readData();
  const tenant = data.tenants.find((t) => t.id === req.params.tenantId && t.landlordId === req.session.userId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const request = data.maintenanceRequests.find((r) => r.id === maintenanceId && r.tenantId === tenant.id);
  if (!request) return res.status(404).json({ error: "Maintenance request not found" });

  const sender = data.users.find((u) => u.id === req.session.userId);
  const message = {
    id: newId(),
    landlordId: req.session.userId,
    tenantId: tenant.id,
    senderRole: "landlord",
    senderId: req.session.userId,
    senderName: sender ? sender.name : "Landlord",
    text: "",
    createdAt: new Date().toISOString(),
    readByLandlord: true,
    readByTenant: false,
    pinnedUntil: null,
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    replyToId: null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: "maintenance",
    cardData: {
      maintenanceId: request.id,
      description: request.description,
      status: request.status,
      dateCreated: request.dateCreated,
    },
  };
  data.messages.push(message);
  writeData(data);
  res.json(serializeMessage(message, req.session.userId));
});


app.get("/api/tenant/messages/search", requireAuth, requireTenant, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);

  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json([]);
  const userId = currentActorId(req);

  const results = data.messages
    .filter((m) => m.tenantId === tenant.id && m.text && m.text.toLowerCase().includes(q) && !(m.deletedFor || []).includes(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30)
    .map((m) => ({ id: m.id, senderName: m.senderName, text: m.text, createdAt: m.createdAt }));
  res.json(results);
});

// Tenant: view their own thread with the landlord.
app.get("/api/tenant/messages", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json({ messages: [], firstUnreadId: null });

  clearExpiredPins(data, tenant.id);
  const thread = data.messages
    .filter((m) => m.tenantId === tenant.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const firstUnread = thread.find((m) => m.senderRole !== "tenant" && !m.readByTenant);
  const firstUnreadId = firstUnread ? firstUnread.id : null;

  thread.forEach((m) => { if (m.senderRole !== "tenant") m.readByTenant = true; });
  writeData(data);
  const { page, hasMore } = paginateThread(thread, req.query.before);
  res.json({ messages: visibleThread(page, currentActorId(req)), firstUnreadId, hasMore });
});

app.post("/api/tenant/messages", requireAuth, requireTenant, chatMessageLimiter, (req, res) => {
  const { text, replyToId } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Message can't be empty" });

  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const message = {
    id: newId(),
    landlordId: tenant.landlordId,
    tenantId: tenant.id,
    senderRole: "tenant",
    senderName: tenant.name,
    senderId: req.session.userId,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    readByLandlord: false,
    readByTenant: true,
    pinnedUntil: null,
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    replyToId: replyToId && data.messages.some((m) => m.id === replyToId && m.tenantId === tenant.id) ? replyToId : null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: null,
    cardData: null,
  };
  data.messages.push(message);
  addNotification(data, tenant.landlordId, `New message from ${tenant.name}: "${text.trim().slice(0, 60)}${text.trim().length > 60 ? "…" : ""}"`);
  writeData(data);
  res.json(message);
});

// Tenant: send an image, video, or PDF to the landlord (with an optional caption).
app.post("/api/tenant/messages/upload", requireAuth, requireTenant, chatUploadLimiter, chatUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was received" });

  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const replyToId = req.body.replyToId;
  const message = {
    id: newId(),
    landlordId: tenant.landlordId,
    tenantId: tenant.id,
    senderRole: "tenant",
    senderName: tenant.name,
    senderId: req.session.userId,
    text: (req.body.text || "").trim(),
    createdAt: new Date().toISOString(),
    readByLandlord: false,
    readByTenant: true,
    pinnedUntil: null,
    attachmentUrl: "/uploads/" + req.file.filename,
    attachmentType: attachmentTypeFor(req.file.mimetype),
    attachmentName: req.file.originalname,
    replyToId: replyToId && data.messages.some((m) => m.id === replyToId && m.tenantId === tenant.id) ? replyToId : null,
    reactions: {},
    deletedFor: [],
    edited: false,
    editHistory: [],
    cardType: null,
    cardData: null,
  };
  data.messages.push(message);
  addNotification(data, tenant.landlordId, `${tenant.name} sent an attachment`);
  writeData(data);
  res.json(message);
});

// "Typing…" indicator — pinged while the tenant is composing, and polled by
// the landlord/manager side. Not persisted (see typingState above).
app.post("/api/tenant/messages/typing", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });
  setTyping(tenant.id, "tenant");
  res.json({ ok: true });
});

app.get("/api/tenant/messages/typing-status", requireAuth, requireTenant, (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.json({ typing: false });
  res.json({ typing: isTyping(tenant.id, "landlord") });
});

// ======================= PDF RECEIPTS =======================

async function streamReceiptPDF(req, res, { payment, tenant, property, landlordName }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-${payment.receiptNumber}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text("TenancyHub", { align: "left" });
  doc.fontSize(10).fillColor("#666").text("Rent payment receipt", { align: "left" });
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).text(`Receipt ${payment.receiptNumber}`);
  doc.fontSize(10).fillColor("#666").text(`Issued ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}`);
  doc.moveDown();

  doc.fillColor("#000").fontSize(11);
  doc.text(`Received from: ${tenant.name}`);
  if (tenant.phone) doc.text(`Phone: ${tenant.phone}`);
  if (tenant.email) doc.text(`Email: ${tenant.email}`);
  doc.text(`Property: ${property ? property.name : "N/A"}${tenant.unit ? " · " + tenant.unit : ""}`);
  if (property && property.address) doc.text(`Address: ${property.address}`);
  doc.text(`Landlord: ${landlordName}`);
  doc.moveDown();

  doc.fontSize(16).text(`Amount paid: ₦${payment.amount.toLocaleString()}`);
  doc.fontSize(11).text(`Payment date: ${new Date(payment.date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}`);
  doc.text(`Rent frequency: ${tenant.rentFrequency === "monthly" ? "Monthly" : "Yearly"}`);
  if (payment.balanceAfter > 0) {
    doc.fillColor("#b45309").text(`Partial payment — balance remaining for this cycle: ₦${payment.balanceAfter.toLocaleString()}`);
    doc.fillColor("#000");
  } else {
    doc.text(`Next amount due: ${new Date(tenant.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}`);
  }
  doc.moveDown(2);

  // A scannable link to a public, no-login verification page — lets anyone
  // holding a printed or forwarded receipt confirm it's genuine, without
  // exposing anything beyond what's already printed on the receipt itself.
  if (QRCode) {
    try {
      const verifyUrl = `${req.protocol}://${req.get("host")}/verify-receipt.html?id=${payment.id}`;
      const qrBuffer = await QRCode.toBuffer(verifyUrl, { width: 110, margin: 1 });
      const qrY = doc.y;
      doc.image(qrBuffer, 50, qrY, { width: 90 });
      doc.fontSize(8).fillColor("#666").text("Scan to verify this receipt online", 150, qrY + 32, { width: 200 });
      doc.y = qrY + 100;
    } catch (err) {
      // QR generation failed for some reason — the receipt is still valid
      // and complete without it, so don't let this break the download.
      console.warn("[receipt] QR code generation failed:", err.message);
    }
  }

  doc.fontSize(9).fillColor("#999").text("Generated by TenancyHub. This receipt confirms rent received and is not a legal document.", { align: "left" });

  doc.end();
}

// A rent-roll report: every tenant, their rent, due date, and status, as a
// real downloadable record for accounting/bookkeeping — not just an on-screen
// list. Uses the same statusFor()/remainingBalance() logic as the dashboard,
// so the PDF always agrees with what's shown on screen.
app.get("/api/reports/rent-roll.pdf", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const landlord = data.users.find((u) => u.id === req.session.userId);
  const myTenants = data.tenants
    .filter((t) => t.landlordId === req.session.userId)
    .map((t) => ({
      ...t,
      propertyName: (data.properties.find((p) => p.id === t.propertyId) || {}).name || "—",
      status: statusFor(t.dueDate, t.rentFrequency),
      balanceDue: remainingBalance(t),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const statusLabel = { overdue: "Overdue", due_soon: "Due soon", ok: "Paid up" };
  const statusColor = { overdue: "#c0392b", due_soon: "#b7791f", ok: "#1e5fce" };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="rent-roll-${new Date().toISOString().slice(0, 10)}.pdf"`);

  const doc = new PDFDocument({ margin: 45, size: "A4" });
  doc.pipe(res);

  doc.fontSize(20).fillColor("#000").text("TenancyHub", { align: "left" });
  doc.fontSize(10).fillColor("#666").text("Rent roll — all tenants", { align: "left" });
  doc.fontSize(9).text(`${landlord ? landlord.name : "Landlord"} · generated ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}`);
  doc.moveDown(1.2);

  const totalExpected = myTenants.reduce((sum, t) => sum + t.rentAmount, 0);
  const totalOwed = myTenants.reduce((sum, t) => sum + Math.max(0, t.balanceDue), 0);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Tenants: ${myTenants.length}    Total expected per cycle: ₦${totalExpected.toLocaleString()}    Currently owed: ₦${totalOwed.toLocaleString()}`);
  doc.moveDown(1);

  // Column layout
  const colX = { name: 45, property: 175, rent: 300, due: 370, status: 450 };
  const rowTop = () => doc.y;

  function drawHeader() {
    doc.fontSize(9).fillColor("#666");
    doc.text("Tenant", colX.name, doc.y, { continued: false });
    doc.text("Property", colX.property, rowTop());
    doc.text("Rent", colX.rent, rowTop());
    doc.text("Due date", colX.due, rowTop());
    doc.text("Status", colX.status, rowTop());
    doc.moveDown(0.3);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor("#dfe4ea").stroke();
    doc.moveDown(0.4);
  }

  drawHeader();

  myTenants.forEach((t) => {
    if (doc.y > 760) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.fontSize(9.5).fillColor("#000");
    doc.text(t.name, colX.name, y, { width: 125 });
    doc.text(t.propertyName, colX.property, y, { width: 120 });
    doc.text(`₦${t.rentAmount.toLocaleString()}`, colX.rent, y, { width: 65 });
    doc.text(new Date(t.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short" }), colX.due, y, { width: 75 });
    doc.fillColor(statusColor[t.status] || "#000").text(statusLabel[t.status] || t.status, colX.status, y);
    doc.moveDown(0.6);
  });

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#999").text("Generated by TenancyHub — a record of rent status at the time of export, not a legal or tax document.");

  doc.end();
});

app.get("/api/payments/:id/receipt", requireAuth, requireLandlordOrManager, async (req, res) => {
  const data = readData();
  const payment = data.payments.find((p) => p.id === req.params.id && p.landlordId === req.workspaceLandlordId);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const tenant = data.tenants.find((t) => t.id === payment.tenantId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const property = data.properties.find((p) => p.id === tenant.propertyId);
  const landlord = data.users.find((u) => u.id === req.workspaceLandlordId);

  await streamReceiptPDF(req, res, { payment, tenant, property, landlordName: landlord ? landlord.name : "Landlord" });
});

app.get("/api/tenants/:id/payments", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.id, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const payments = data.payments
    .filter((p) => p.tenantId === tenant.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(payments);
});

// A tenant's full history in one feed — every payment, maintenance update,
// agreement, and deposit action, in the order it happened.
app.get("/api/tenants/:id/activity", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.id, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const activity = data.activityLog
    .filter((a) => a.tenantId === tenant.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(activity);
});

// Document vault: every real document tied to this tenant, pulled together
// from wherever it actually lives — signed agreements, payment receipts,
// maintenance photos, and anything shared as a file in chat — instead of
// making someone hunt through four different sections to find one thing.
app.get("/api/tenants/:id/documents", requireAuth, requireLandlordOrManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.id, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const docs = [];

  data.agreements
    .filter((a) => a.tenantId === tenant.id)
    .forEach((a) => {
      docs.push({
        type: "agreement",
        title: a.title,
        subtitle: a.status === "signed" ? `Signed by ${a.signedByName}` : "Not yet signed",
        date: a.signedAt || a.createdAt,
        url: null, // agreements are viewed/signed in-app, not a standalone file
      });
    });

  data.payments
    .filter((p) => p.tenantId === tenant.id)
    .forEach((p) => {
      docs.push({
        type: "receipt",
        title: `Receipt ${p.receiptNumber}`,
        subtitle: `₦${p.amount.toLocaleString()}`,
        date: p.date,
        url: `/api/payments/${p.id}/receipt`,
      });
    });

  data.maintenanceRequests
    .filter((r) => r.tenantId === tenant.id && r.imagePath)
    .forEach((r) => {
      docs.push({
        type: "maintenance_photo",
        title: r.description,
        subtitle: "Maintenance photo",
        date: r.dateCreated,
        url: r.imagePath,
      });
    });

  data.messages
    .filter((m) => m.tenantId === tenant.id && m.attachmentUrl && m.attachmentType !== "audio")
    .forEach((m) => {
      docs.push({
        type: m.attachmentType || "file",
        title: m.attachmentName || "Shared file",
        subtitle: `Shared by ${m.senderName}`,
        date: m.createdAt,
        url: m.attachmentUrl,
      });
    });

  docs.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(docs);
});

// Calendar: rent due dates, lease expiries, and maintenance history for a
// given month. Rent due dates are projected forward/backward from each
// tenant's current due date using their actual rent frequency — a real
// calculation from a known recurrence rule, not a guess, since "monthly"
// rent is due monthly by definition. Bounded to 36 steps so a malformed
// date can never loop the server.
app.get("/api/calendar", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const myTenants = data.tenants.filter((t) => t.landlordId === req.session.userId);
  const myTenantIds = myTenants.map((t) => t.id);

  const now = new Date();
  const monthParam = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = monthParam.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0, 23, 59, 59);

  const events = [];

  myTenants.forEach((t) => {
    if (!t.dueDate) return;
    const step = t.rentFrequency === "monthly" ? 1 : 12;
    let occurrence = t.dueDate;
    let guard = 0;
    // Walk backward until we're before this month (or hit the safety limit).
    while (new Date(occurrence) > monthStart && guard < 36) {
      occurrence = addMonths(occurrence, -step);
      guard++;
    }
    guard = 0;
    // Walk forward, collecting every occurrence that lands inside this month.
    while (new Date(occurrence) <= monthEnd && guard < 36) {
      if (new Date(occurrence) >= monthStart) {
        events.push({ type: "rent_due", date: occurrence, title: `Rent due — ${t.name}`, tenantId: t.id });
      }
      occurrence = addMonths(occurrence, step);
      guard++;
    }
  });

  data.agreements
    .filter((a) => a.expiryDate && myTenantIds.includes(a.tenantId))
    .forEach((a) => {
      const d = new Date(a.expiryDate);
      if (d >= monthStart && d <= monthEnd) {
        const tenant = myTenants.find((t) => t.id === a.tenantId);
        events.push({ type: "lease_expiry", date: a.expiryDate, title: `Lease expires — ${tenant ? tenant.name : "tenant"}`, tenantId: a.tenantId });
      }
    });

  data.maintenanceRequests
    .filter((r) => myTenantIds.includes(r.tenantId))
    .forEach((r) => {
      const d = new Date(r.dateCreated);
      if (d >= monthStart && d <= monthEnd) {
        const tenant = myTenants.find((t) => t.id === r.tenantId);
        events.push({ type: "maintenance", date: r.dateCreated, title: `Maintenance — ${tenant ? tenant.name : "tenant"}: ${r.description}`, tenantId: r.tenantId });
      }
    });

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ month: monthParam, events });
});

// Backup / restore — scoped strictly to the logged-in landlord's own data,
// not the whole data.json file. This app supports multiple independent
// landlords sharing one deployment (every route in this file filters by
// landlordId) — a full-file export would hand one landlord a copy of every
// other landlord's tenants and messages. Scoping it like this is correct
// and safe either way: if you're the only landlord on this deployment, this
// naturally is "everything"; if you're not, it's correctly just yours.
const BACKUP_VERSION = 1;

app.get("/api/backup", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const uid = req.session.userId;
  const myTenantIds = data.tenants.filter((t) => t.landlordId === uid).map((t) => t.id);

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    landlordId: uid,
    data: {
      properties: data.properties.filter((p) => p.landlordId === uid),
      tenants: data.tenants.filter((t) => t.landlordId === uid),
      maintenanceRequests: data.maintenanceRequests.filter((r) => myTenantIds.includes(r.tenantId)),
      agreements: data.agreements.filter((a) => myTenantIds.includes(a.tenantId)),
      payments: data.payments.filter((p) => myTenantIds.includes(p.tenantId)),
      messages: data.messages.filter((m) => myTenantIds.includes(m.tenantId)),
      notifications: data.notifications.filter((n) => n.landlordId === uid),
      activityLog: data.activityLog.filter((a) => a.landlordId === uid),
      agents: data.agents.filter((a) => a.landlordId === uid),
      collections: data.collections.filter((c) => myTenantIds.includes(c.tenantId) || data.agents.some((a) => a.id === c.agentId && a.landlordId === uid)),
    },
  };

  res.setHeader("Content-Disposition", `attachment; filename="tenancyhub-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
});

app.post("/api/restore", requireAuth, requireLandlord, express.json({ limit: "15mb" }), (req, res) => {
  const backup = req.body;
  if (!backup || typeof backup !== "object" || !backup.data) {
    return res.status(400).json({ error: "This doesn't look like a TenancyHub backup file." });
  }
  if (backup.version !== BACKUP_VERSION) {
    return res.status(400).json({ error: "This backup is from a different, incompatible version of TenancyHub." });
  }
  // A backup can only be restored into the same account it came from — this
  // isn't a way to import someone else's data, or move data between accounts.
  if (backup.landlordId !== req.session.userId) {
    return res.status(403).json({ error: "This backup belongs to a different account and can't be restored here." });
  }

  const expectedKeys = ["properties", "tenants", "maintenanceRequests", "agreements", "payments", "messages", "notifications", "activityLog", "agents", "collections"];
  for (const key of expectedKeys) {
    if (!Array.isArray(backup.data[key])) {
      return res.status(400).json({ error: `Backup file is missing or has an invalid "${key}" section.` });
    }
  }

  const data = readData();
  const uid = req.session.userId;
  const myTenantIdsBefore = data.tenants.filter((t) => t.landlordId === uid).map((t) => t.id);

  // Replace only this landlord's own slice of each collection — everything
  // belonging to other landlords on this deployment is left untouched.
  data.properties = data.properties.filter((p) => p.landlordId !== uid).concat(backup.data.properties);
  data.tenants = data.tenants.filter((t) => t.landlordId !== uid).concat(backup.data.tenants);
  data.maintenanceRequests = data.maintenanceRequests.filter((r) => !myTenantIdsBefore.includes(r.tenantId)).concat(backup.data.maintenanceRequests);
  data.agreements = data.agreements.filter((a) => !myTenantIdsBefore.includes(a.tenantId)).concat(backup.data.agreements);
  data.payments = data.payments.filter((p) => !myTenantIdsBefore.includes(p.tenantId)).concat(backup.data.payments);
  data.messages = data.messages.filter((m) => !myTenantIdsBefore.includes(m.tenantId)).concat(backup.data.messages);
  data.notifications = data.notifications.filter((n) => n.landlordId !== uid).concat(backup.data.notifications);
  data.activityLog = data.activityLog.filter((a) => a.landlordId !== uid).concat(backup.data.activityLog);
  data.agents = data.agents.filter((a) => a.landlordId !== uid).concat(backup.data.agents);
  const myAgentIdsBefore = data.agents.filter((a) => a.landlordId === uid).map((a) => a.id).concat(backup.data.agents.map((a) => a.id));
  data.collections = data.collections
    .filter((c) => !myTenantIdsBefore.includes(c.tenantId) && !myAgentIdsBefore.includes(c.agentId))
    .concat(backup.data.collections);

  writeData(data);
  res.json({
    ok: true,
    restored: {
      properties: backup.data.properties.length,
      tenants: backup.data.tenants.length,
      payments: backup.data.payments.length,
    },
  });
});

// Public receipt verification — no login required, since the whole point is
// that anyone holding a printed or forwarded receipt (a bank, a new agent,
// anyone) can confirm it's genuine by scanning the QR code on it. Deliberately
// exposes only what's already printed on the receipt itself — no phone,
// email, or anything not already visible to whoever has the paper in hand.
app.get("/api/receipt-verify/:id", (req, res) => {
  const data = readData();
  const payment = data.payments.find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ valid: false });

  const tenant = data.tenants.find((t) => t.id === payment.tenantId);
  const property = tenant ? data.properties.find((p) => p.id === tenant.propertyId) : null;
  const landlord = tenant ? data.users.find((u) => u.id === tenant.landlordId) : null;

  res.json({
    valid: true,
    receiptNumber: payment.receiptNumber,
    amount: payment.amount,
    date: payment.date,
    propertyName: property ? property.name : null,
    landlordName: landlord ? landlord.name : null,
  });
});

app.get("/api/tenant/payments/:id/receipt", requireAuth, requireTenant, async (req, res) => {
  const data = readData();
  const tenant = findTenantForUser(data, req.session.userId);
  if (!tenant) return res.status(404).json({ error: "No tenancy found for this account" });

  const payment = data.payments.find((p) => p.id === req.params.id && p.tenantId === tenant.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const property = data.properties.find((p) => p.id === tenant.propertyId);
  const landlord = data.users.find((u) => u.id === tenant.landlordId);
  await streamReceiptPDF(req, res, { payment, tenant, property, landlordName: landlord ? landlord.name : "Landlord" });
});

// ======================= PROPERTY MANAGERS =======================
// A landlord invites someone by email; that person can already have (or
// later create) a Property Manager account. Once they log in with the
// matching email, linkManagerAccount() connects the invite to their account
// and they get read/act access to that landlord's tenants and maintenance
// (not to owner-only things like deposits, screening, or agreements).

app.get("/api/managers", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const mine = data.managers
    .filter((m) => m.landlordId === req.session.userId)
    .map((m) => ({ ...m, linked: !!m.userId }));
  res.json(mine);
});

app.post("/api/managers", requireAuth, requireLandlord, (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Name and email are required" });

  const data = readData();
  const existing = data.managers.find(
    (m) => m.landlordId === req.session.userId && m.email.toLowerCase() === email.toLowerCase()
  );
  if (existing) return res.status(400).json({ error: "You've already invited this email" });

  const manager = {
    id: newId(),
    landlordId: req.session.userId,
    name,
    email,
    userId: null,
    createdAt: new Date().toISOString(),
  };
  data.managers.push(manager);
  writeData(data);

  sendEmail(
    email,
    "You've been added as a Property Manager on TenancyHub",
    `Hi ${name},\n\nYou've been added as a Property Manager on TenancyHub. Create an account (or log in) at ` +
    `http://localhost:${PORT}/register.html using this exact email address (${email}) and choose "Property Manager" ` +
    `as your account type — you'll then see the tenants and maintenance requests you've been given access to.`
  );

  res.json(manager);
});

app.delete("/api/managers/:id", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  data.managers = data.managers.filter((m) => !(m.id === req.params.id && m.landlordId === req.session.userId));
  writeData(data);
  res.json({ ok: true });
});

// ---- Manager portal ----

app.get("/api/manager/dashboard", requireAuth, requireManager, (req, res) => {
  const data = readData();
  const landlord = data.users.find((u) => u.id === req.workspaceLandlordId);
  const properties = data.properties.filter((p) => p.landlordId === req.workspaceLandlordId);
  const tenants = data.tenants
    .filter((t) => t.landlordId === req.workspaceLandlordId)
    .map((t) => {
      const property = data.properties.find((p) => p.id === t.propertyId);
      return {
        ...t,
        status: statusFor(t.dueDate, t.rentFrequency),
        balanceDue: remainingBalance(t),
        propertyName: property ? property.name : "No property set",
      };
    });
  const myTenantIds = tenants.map((t) => t.id);
  const maintenance = data.maintenanceRequests
    .filter((r) => myTenantIds.includes(r.tenantId))
    .map((r) => {
      const tenant = tenants.find((t) => t.id === r.tenantId);
      return { ...r, tenantName: tenant ? tenant.name : "Unknown tenant" };
    });

  res.json({
    landlordName: landlord ? landlord.name : "Landlord",
    properties,
    tenants,
    maintenance,
  });
});

app.post("/api/manager/tenants/:id/pay", requireAuth, requireManager, (req, res) => {
  const data = readData();
  const tenant = findTenantInWorkspace(data, req.params.id, req.workspaceLandlordId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { amount } = req.body || {};
  if (amount !== undefined && amount !== null && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "Enter a payment amount greater than ₦0" });
    }
  }

  const payment = recordTenantPayment(data, tenant, req.workspaceLandlordId, amount);
  addNotification(data, req.workspaceLandlordId, `${req.managerRecord.name} (manager) recorded a payment of ₦${payment.amount.toLocaleString()} for ${tenant.name}`);
  writeData(data);
  res.json({ ...tenant, lastPaymentId: payment.id });
});

app.post("/api/manager/maintenance/:id/status", requireAuth, requireManager, (req, res) => {
  const { status } = req.body;
  const data = readData();
  const myTenantIds = data.tenants
    .filter((t) => t.landlordId === req.workspaceLandlordId)
    .map((t) => t.id);
  const request = data.maintenanceRequests.find(
    (r) => r.id === req.params.id && myTenantIds.includes(r.tenantId)
  );
  if (!request) return res.status(404).json({ error: "Request not found" });

  const statusLabel = { open: "Open", in_progress: "In progress", done: "Done" };
  request.status = status;
  logActivity(data, request.tenantId, req.workspaceLandlordId, "maintenance", `Maintenance status changed to ${statusLabel[status] || status}: ${request.description}`);
  writeData(data);
  res.json(request);
});

// ======================= SETTINGS =======================

app.get("/api/settings", requireAuth, requireLandlord, (req, res) => {
  const data = readData();
  const user = data.users.find((u) => u.id === req.session.userId);
  res.json({ autoRemindersEnabled: user.autoRemindersEnabled });
});

app.post("/api/settings", requireAuth, requireLandlord, (req, res) => {
  const { autoRemindersEnabled } = req.body;
  const data = readData();
  const user = data.users.find((u) => u.id === req.session.userId);
  user.autoRemindersEnabled = !!autoRemindersEnabled;
  writeData(data);
  res.json({ autoRemindersEnabled: user.autoRemindersEnabled });
});

// ======================= AUTOMATED RENT REMINDERS =======================
// Runs on its own — no button to click. Once a day, for every landlord who
// hasn't turned this off, it emails every tenant who is overdue or due soon
// (and has an email on file), at most once per tenant per day.

async function runAutoReminders() {
  const data = readData();
  const today = new Date().toISOString().slice(0, 10);
  let sentCount = 0;

  for (const tenant of data.tenants) {
    if (!tenant.email && !tenant.phone) continue;
    if (tenant.lastReminderSentDate === today) continue;
    const status = statusFor(tenant.dueDate, tenant.rentFrequency);
    if (status !== "overdue" && status !== "due_soon") continue;

    const landlord = data.users.find((u) => u.id === tenant.landlordId);
    if (!landlord || !landlord.autoRemindersEnabled) continue;

    const property = data.properties.find((p) => p.id === tenant.propertyId);
    const text = rentReminderMessage(tenant, property);

    const channelsSent = [];
    if (tenant.email) {
      const ok = await sendEmail(tenant.email, "Rent payment reminder", text);
      if (ok) channelsSent.push("email");
    }
    if (tenant.phone) {
      const ok = await sendWhatsApp(tenant.phone, text);
      if (ok) channelsSent.push("WhatsApp");
    }

    if (channelsSent.length > 0) {
      tenant.lastReminderSentDate = today;
      addNotification(data, tenant.landlordId, `Auto-reminder sent to ${tenant.name} (${channelsSent.join(" + ")})`);
      sentCount++;
    }
  }

  if (sentCount > 0) {
    writeData(data);
    console.log(`[Auto-reminders] Sent ${sentCount} reminder(s) on ${today}.`);
  }
}

// Check every hour; runAutoReminders() itself skips anyone already messaged
// today, so this stays safe to call repeatedly.
setInterval(runAutoReminders, 60 * 60 * 1000);
setTimeout(runAutoReminders, 10 * 1000); // also run shortly after startup

// Turns multer's upload errors (file too big, wrong file type) into a
// normal JSON error response instead of a raw server crash/HTML page.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "That file is too large (max 25MB for chat attachments)." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message && err.message.includes("Only images, videos, and PDF")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

server.listen(PORT, () => {
  console.log(`TenancyHub is running! Open http://localhost:${PORT} in your browser.`);
});
