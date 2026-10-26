import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";

let initializedProvider = null;

function base64Blob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Couldn’t prepare this upload. Please try again."));
    reader.readAsDataURL(blob);
  });
}

// Use the native cookie jar for all API methods, including GETs and uploads.
// Calling the HTTP API directly also avoids WebView filtering of Origin and
// the global fetch patch's different handling of File versus Blob bodies.
window.CLOSER_NATIVE_HTTP = {
  async fetch(url, options = {}) {
    const apiBase = window.CLOSER_API_BASE_URL;
    if (!apiBase) throw new Error("This app build is missing its server settings. Please install an updated build.");
    const target = new URL(url, `${apiBase}/`);
    if (target.protocol !== "https:" || target.origin !== new URL(apiBase).origin || !target.pathname.startsWith("/api/")) {
      throw new Error("This request is outside the app’s configured API.");
    }
    const headers = new Headers(options.headers);
    headers.set("Origin", `${location.protocol}//${location.host}`);
    let data = options.body;
    let dataType = "json";
    if (data instanceof Blob) {
      if (!headers.has("Content-Type")) headers.set("Content-Type", data.type || "application/octet-stream");
      data = await base64Blob(data);
      dataType = "file";
    } else if (typeof data === "string" && headers.get("Content-Type")?.includes("application/json")) {
      data = JSON.parse(data);
    } else if (data !== undefined && typeof data !== "string") {
      throw new Error("This request body is not supported by the mobile API.");
    }
    const response = await CapacitorHttp.request({
      url: target.href,
      method: options.method || "GET",
      headers: Object.fromEntries(headers.entries()),
      ...(data !== undefined ? { data, dataType } : {}),
      responseType: "json",
      connectTimeout: 15_000,
      readTimeout: 60_000,
      disableRedirects: true,
    });
    return new Response(response.status === 204 ? null : JSON.stringify(response.data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};

async function initialize(provider, options) {
  if (initializedProvider === provider) return;
  await SocialLogin.initialize({ [provider]: options });
  initializedProvider = provider;
}

window.CLOSER_NATIVE_AUTH = {
  async googleIdToken(config) {
    await initialize("google", {
      webClientId: config.webClientId,
      ...(Capacitor.getPlatform() === "ios" ? { iOSClientId: config.iOSClientId, iOSServerClientId: config.webClientId } : {}),
      mode: "online",
    });
    const result = await SocialLogin.login({
      provider: "google",
      options: {},
    });
    return {
      idToken: result.result?.idToken,
      accessToken: result.result?.accessToken?.token,
    };
  },
  async appleIdToken(config) {
    // iOS uses AuthenticationServices and the signed app's bundle identifier.
    // Service ID and redirect URL are only for Apple's browser/Android flow.
    await initialize("apple", Capacitor.getPlatform() === "ios" ? {} : { clientId: config.serviceId, redirectUrl: config.redirectUrl });
    const result = await SocialLogin.login({
      provider: "apple",
      options: { scopes: ["email", "name"] },
    });
    return {
      idToken: result.result?.idToken,
      accessToken: result.result?.accessToken?.token,
    };
  },
};
