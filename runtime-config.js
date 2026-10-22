/* Replaced by scripts/build-web.mjs for packaged mobile builds. */
window.CLOSER_API_BASE_URL = "";

(() => {
  const base = String(window.CLOSER_API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const requestUrl = typeof input === "string" ? input : input.url;
    const parsed = new URL(requestUrl, window.location.href);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/")) {
      return nativeFetch(input, init);
    }
    const target = `${base}${parsed.pathname}${parsed.search}`;
    return nativeFetch(target, { ...init, credentials: init.credentials || "include" });
  };
})();
