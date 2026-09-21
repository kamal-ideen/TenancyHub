// Handles the login and register forms. Whichever one exists on the page
// is the one that gets wired up.

function showAuthError(message) {
  const errorBox = document.getElementById("authError");
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function redirectByRole(role) {
  if (role === "landlord") window.location.href = "index.html";
  else if (role === "tenant") window.location.href = "tenant.html";
  else if (role === "property_manager") window.location.href = "manager.html";
  else window.location.href = "login.html";
}

// ---- Show/hide password ----
document.querySelectorAll(".password-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.toggleFor);
    if (!input) return;
    const nowVisible = input.type === "password";
    input.type = nowVisible ? "text" : "password";
    btn.textContent = nowVisible ? "Hide" : "Show";
  });
});

// ---- Google Sign-In (only appears if the server has a Client ID configured) ----
async function initGoogleSignIn() {
  const container = document.getElementById("googleSignInContainer");
  if (!container) return;

  const res = await fetch("/api/config");
  const config = await res.json();

  if (!config.googleClientId) {
    container.innerHTML = '<div class="google-not-configured">Google Sign-In isn\'t set up yet — see .env.example</div>';
    return;
  }

  // google.accounts comes from the Google script tag included in the HTML
  function tryRender() {
    if (typeof google === "undefined" || !google.accounts) {
      setTimeout(tryRender, 100);
      return;
    }
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential,
    });
    google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: 320 });
  }
  tryRender();
}

async function handleGoogleCredential(response) {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: response.credential }),
  });
  const data = await res.json();

  if (!res.ok) {
    showAuthError(data.error || "Google sign-in failed.");
    return;
  }
  redirectByRole(data.role);
}

initGoogleSignIn();

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(loginForm).entries());

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.needsVerification) {
        sessionStorage.setItem("th_pending_verify_email", data.email);
        window.location.href = "verify.html";
        return;
      }
      showAuthError(data.error || "Something went wrong. Please try again.");
      return;
    }
    redirectByRole(data.role);
  });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(registerForm).entries());

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || "Something went wrong. Please try again.");
      return;
    }
    if (data.needsVerification) {
      sessionStorage.setItem("th_pending_verify_email", data.email);
      window.location.href = "verify.html";
      return;
    }
    redirectByRole(data.role);
  });
}
