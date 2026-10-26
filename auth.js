const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const inviteToken = query.get("invite");
let signedInUser = null;
let authSettings = null;

async function request(path, options = {}) {
  const base = window.CLOSER_API_BASE_URL?.trim().replace(/\/+$/, "");
  const url = base ? new URL(path, `${base}/`).toString() : path;
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function message(text) { $("auth-message").textContent = text; }
function inviteMessage(text) { $("invite-message").textContent = text; }

async function initialize() {
  try {
    authSettings = await request("/api/config");
    $("apple-sign-in").hidden = !authSettings.authConfigured || !authSettings.appleConfigured;
    if (!authSettings.authConfigured) {
      message("Google sign-in is not configured on this server yet.");
      return;
    }
    const session = await request("/api/auth/get-session");
    signedInUser = session?.user || null;
    if (!signedInUser) {
      $("google-sign-in").disabled = false;
      if (inviteToken) message("Sign in with Google, then choose whether to join your partner’s space.");
      return;
    }
    if (!inviteToken) { location.replace("index.html"); return; }
    $("google-sign-in").hidden = true;
    $("apple-sign-in").hidden = true;
    $("auth-message").textContent = "";
    $("auth-heading").textContent = "Connect with your person";
    $("auth-description").textContent = "You’re signed in. Connecting a partner is optional, and you can explore Closer on your own.";
    $("auth-account").hidden = false;
    $("signed-in-as").textContent = `Signed in as ${signedInUser.email}`;
    $("pair-panel").hidden = false;
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
      if (!config.webClientId || !config.iOSClientId) {
        throw new Error("Native Google sign-in needs the Google web and iOS client IDs in the mobile build configuration.");
      }
      if (!window.CLOSER_NATIVE_AUTH?.googleIdToken) throw new Error("Native Google sign-in is missing from this app build. Rebuild and sync the mobile project.");
      const nativeResult = await window.CLOSER_NATIVE_AUTH.googleIdToken(config);
      const idToken = nativeResult.idToken;
      if (!idToken) throw new Error("Google did not return an ID token. Check the native OAuth client setup and try again.");
      await request("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider: "google",
          idToken: { token: idToken, accessToken: nativeResult.accessToken },
          callbackURL: callback.href,
        }),
      });
      location.assign(callback.href);
      return;
    }
    const result = await request("/api/auth/sign-in/social", {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL: callback.href }),
    });
    if (!result.url) throw new Error("Google did not return a sign-in link. Check your OAuth configuration.");
    location.assign(result.url);
  } catch (error) { button.disabled = false; message(error.message); }
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
      if (!nativeResult.idToken) throw new Error("Apple did not return an identity token. Check the Sign in with Apple capability and try again.");
      await request("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({ provider: "apple", idToken: { token: nativeResult.idToken, accessToken: nativeResult.accessToken }, callbackURL: callback.href }),
      });
      location.assign(callback.href);
      return;
    }
    const result = await request("/api/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "apple", callbackURL: callback.href }) });
    if (!result.url) throw new Error("Apple did not return a sign-in link. Check the Apple developer setup.");
    location.assign(result.url);
  } catch (error) { button.disabled = false; message(error.message); }
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
  try { await request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }); location.assign("login.html"); }
  catch (error) { inviteMessage(error.message); }
});

initialize();
