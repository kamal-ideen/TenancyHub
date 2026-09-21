// Wraps the global fetch() once, here, so every existing fetch() call across
// every page automatically carries the CSRF token on state-changing requests
// — without having to find and edit every one of those calls individually.
(function () {
  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  let tokenPromise = null;

  function getToken() {
    if (!tokenPromise) {
      tokenPromise = fetch("/api/csrf-token", { credentials: "same-origin" })
        .then((res) => res.json())
        .then((data) => data.token)
        .catch(() => null);
    }
    return tokenPromise;
  }

  function isSameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input && input.url;

    if (!MUTATING_METHODS.has(method) || !url || !isSameOrigin(url)) {
      return originalFetch(input, init);
    }

    const token = await getToken();
    const nextInit = init ? { ...init } : {};
    const headers = new Headers(nextInit.headers || (input && input.headers) || {});
    if (token) headers.set("X-CSRF-Token", token);
    nextInit.headers = headers;
    return originalFetch(input, nextInit);
  };
})();
