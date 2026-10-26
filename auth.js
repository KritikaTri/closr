const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const inviteToken = query.get("invite");
let signedInUser = null;
let authSettings = null;

async function request(path, options = {}) {
  const base = window.CLOSER_API_BASE_URL?.trim().replace(/\/+$/, "");
  const url = base ? new URL(path, `${base}/`).toString() : path;
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const native = window.Capacitor?.isNativePlatform?.();
  if (native && !window.CLOSER_NATIVE_HTTP?.fetch) throw new Error("This app build is missing its connection setup. Please install an updated build.");
  const fetcher = native ? window.CLOSER_NATIVE_HTTP.fetch : fetch;
  const response = await fetcher(url, {
    credentials: "include",
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function message(text) { $("auth-message").textContent = text; }
function inviteMessage(text) { $("invite-message").textContent = text; }

async function finishNativeSignIn(provider, result, callback) {
  if (!result.idToken) throw new Error(`${provider === "google" ? "Google" : "Apple"} did not return an identity token. Check the native sign-in configuration.`);
  await request("/api/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider, idToken: { token: result.idToken, ...(provider === "google" && result.accessToken ? { accessToken: result.accessToken } : {}) } }),
  });
  const session = await request("/api/auth/get-session");
  if (!session?.user) throw new Error("Sign-in finished, but this app couldn’t keep your session. Please try again.");
  location.assign(callback.href);
}

async function initialize() {
  try {
    if (inviteToken) {
      $("auth-heading").textContent = "Join your person on Closr.";
      $("auth-description").textContent = "Create your account or sign in with Google, then join your partner’s private space.";
      $("invite-steps").hidden = false;
    }
    authSettings = await request("/api/config");
    const nativePlatform = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.getPlatform() : null;
    $("apple-sign-in").hidden = !authSettings.authConfigured || !authSettings.appleConfigured || (nativePlatform && (nativePlatform !== "ios" || !window.CLOSER_APPLE_CONFIG?.serviceId));
    if (!authSettings.authConfigured) {
      message("Google sign-in is not configured on this server yet.");
      return;
    }
    const session = await request("/api/auth/get-session");
    signedInUser = session?.user || null;
    if (!signedInUser) {
      $("google-sign-in").disabled = false;
      if (inviteToken) message("Your invitation will stay with you through sign-in.");
      return;
    }
    if (!inviteToken) { location.replace("index.html"); return; }
    $("google-sign-in").hidden = true;
    $("apple-sign-in").hidden = true;
    $("auth-message").textContent = "";
    $("auth-heading").textContent = "Your account is ready.";
    $("auth-description").textContent = "One more step to share check-ins, chats, and memories with your person.";
    $("invite-account-step").classList.add("complete");
    $("invite-account-step").classList.remove("active");
    $("invite-account-step").removeAttribute("aria-current");
    $("invite-space-step").classList.add("active");
    $("invite-space-step").setAttribute("aria-current", "step");
    $("auth-account").hidden = false;
    $("signed-in-as").textContent = `Signed in as ${signedInUser.email}`;
    $("pair-panel").hidden = false;
    try {
      const invitation = await request("/api/couple/invites/preview", { method: "POST", body: JSON.stringify({ token: inviteToken }) });
      if (invitation.isInviter) {
        $("pair-title").textContent = "This is your invitation.";
        $("pair-description").textContent = "Send this link to your partner. They’ll need to sign in with their own Google account to join you.";
      } else {
        $("pair-title").textContent = `Join ${invitation.inviterName || "your partner"}’s space`;
        $("accept-invite").disabled = false;
      }
    } catch (error) { inviteMessage(error.message); }
  } catch (error) { message(error.message); }
}

$("google-sign-in").addEventListener("click", async () => {
  const button = $("google-sign-in");
  button.disabled = true;
  message("Opening Google sign-in…");
  const callback = new URL("login.html", location.href);
  if (inviteToken) callback.searchParams.set("invite", inviteToken);
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const config = window.CLOSER_GOOGLE_CONFIG || {};
      if (!config.webClientId || (window.Capacitor.getPlatform() === "ios" && !config.iOSClientId)) {
        throw new Error("This app build is missing its Google sign-in settings. Please install an updated build.");
      }
      if (!window.CLOSER_NATIVE_AUTH?.googleIdToken) throw new Error("Native Google sign-in is missing from this app build. Rebuild and sync the mobile project.");
      const nativeResult = await window.CLOSER_NATIVE_AUTH.googleIdToken(config);
      await finishNativeSignIn("google", nativeResult, callback);
      return;
    }
    const result = await request("/api/auth/sign-in/social", {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL: callback.href }),
    });
    if (!result.url) throw new Error("Google did not return a sign-in link. Check your OAuth configuration.");
    location.assign(result.url);
  } catch (error) { button.disabled = false; message(error.code === "USER_CANCELLED" ? "Sign-in cancelled. You can try again whenever you’re ready." : error.message); }
});

$("apple-sign-in").addEventListener("click", async () => {
  const button = $("apple-sign-in");
  button.disabled = true;
  message("Opening Apple sign-in…");
  const callback = new URL("login.html", location.href);
  if (inviteToken) callback.searchParams.set("invite", inviteToken);
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const config = window.CLOSER_APPLE_CONFIG || {};
      if (!config.serviceId || !config.redirectUrl) throw new Error("Apple sign-in needs the Apple Service ID in this mobile build.");
      if (!window.CLOSER_NATIVE_AUTH?.appleIdToken) throw new Error("Native Apple sign-in is missing from this app build. Rebuild and sync the mobile project.");
      const nativeResult = await window.CLOSER_NATIVE_AUTH.appleIdToken(config);
      await finishNativeSignIn("apple", nativeResult, callback);
      return;
    }
    const result = await request("/api/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "apple", callbackURL: callback.href }) });
    if (!result.url) throw new Error("Apple did not return a sign-in link. Check the Apple developer setup.");
    location.assign(result.url);
  } catch (error) { button.disabled = false; message(error.code === "USER_CANCELLED" ? "Sign-in cancelled. You can try again whenever you’re ready." : error.message); }
});

$("accept-invite").addEventListener("click", async () => {
  $("accept-invite").disabled = true;
  try {
    await request("/api/couple/accept", { method: "POST", body: JSON.stringify({ token: inviteToken }) });
    history.replaceState(null, "", location.pathname);
    location.replace("index.html");
  } catch (error) { inviteMessage(error.message); }
  finally { $("accept-invite").disabled = false; }
});

$("sign-out").addEventListener("click", async () => {
  try { await request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }); location.assign(`login.html${location.search}`); }
  catch (error) { inviteMessage(error.message); }
});

initialize();
