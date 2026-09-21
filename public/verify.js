// Handles the "enter your verification code" page. Expects sessionStorage
// to hold the email this code was sent to (set by auth.js right after
// registering, or after a login attempt that came back "please verify").
// Falls back to a ?email= query param so a refreshed page still works.

const params = new URLSearchParams(window.location.search);
const pendingEmail = sessionStorage.getItem("th_pending_verify_email") || params.get("email");

if (!pendingEmail) {
  // No idea whose code this is — send them back to log in instead.
  window.location.href = "login.html";
}

document.getElementById("verifyHint").textContent =
  `We sent a 6-digit code to ${pendingEmail} (and WhatsApp, if you gave a number). Enter it below to finish setting up your account.`;

const verifyForm = document.getElementById("verifyForm");
verifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = new FormData(verifyForm).get("code");

  const res = await fetch("/api/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: pendingEmail, code }),
  });
  const data = await res.json();

  if (!res.ok) {
    showAuthError(data.error || "Something went wrong. Please try again.");
    return;
  }
  sessionStorage.removeItem("th_pending_verify_email");
  redirectByRole(data.role);
});

const resendBtn = document.getElementById("resendBtn");
resendBtn.addEventListener("click", async () => {
  resendBtn.disabled = true;
  resendBtn.textContent = "Sending...";
  await fetch("/api/auth/resend-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: pendingEmail }),
  });
  resendBtn.textContent = "Code sent — resend again";
  setTimeout(() => { resendBtn.disabled = false; }, 15000);
});
