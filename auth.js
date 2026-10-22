const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const inviteToken = query.get("invite");
let signedInUser = null;
let authSettings = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
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

function showPairPanel() {
  $("auth-account").hidden = false;
  $("pair-panel").hidden = false;
  $("signed-in-as").textContent = `Signed in as ${signedInUser.name || signedInUser.email}`;
  $("google-sign-in").hidden = true;
  $("auth-message").textContent = "";
}

async function loadCouple() {
  const couple = await request("/api/couple");
  if (couple.partner) {
    $("pair-title").textContent = "You’re paired ✳";
    $("pair-description").textContent = `This private space is shared with ${couple.partner.name || "your partner"}.`;
    $("create-space").hidden = true;
    $("invite-tools").hidden = true;
    $("paired-actions").hidden = false;
    $("paired-copy").textContent = "Your shared status and partner chat are ready. Open Closer to continue.";
  } else {
    $("pair-title").textContent = "Your space is ready for two";
    $("pair-description").textContent = "Create a one-use link and send it to your partner. Only one person can join, and the link expires after seven days.";
    $("create-space").hidden = true;
    $("invite-tools").hidden = false;
    $("paired-actions").hidden = true;
  }
}

async function acceptInviteIfPresent() {
  if (!inviteToken) return false;
  try {
    const couple = await request("/api/couple/accept", { method: "POST", body: JSON.stringify({ token: inviteToken }) });
    history.replaceState(null, "", location.pathname);
    $("pair-title").textContent = "You’re paired ✳";
    $("pair-description").textContent = `This private space is shared with ${couple.partner?.name || "your partner"}.`;
    $("create-space").hidden = true;
    $("invite-tools").hidden = true;
    $("paired-actions").hidden = false;
    $("paired-copy").textContent = "Your shared status and partner chat are ready. Open Closer to continue.";
    return true;
  } catch (error) {
    history.replaceState(null, "", location.pathname);
    inviteMessage(error.message);
    return false;
  }
}

async function initialize() {
  try {
    authSettings = await request("/api/config");
    if (!authSettings.authConfigured) {
      $("google-sign-in").disabled = true;
      message("Google sign-in is not configured yet. Add the PostgreSQL and Google OAuth values from README.md to .env, then restart the server.");
      return;
    }
    const session = await request("/api/auth/get-session");
    signedInUser = session?.user || null;
    if (!signedInUser) {
      if (inviteToken) message("Sign in with Google to join your partner’s private space.");
      return;
    }
    showPairPanel();
    if (await acceptInviteIfPresent()) return;
    try { await loadCouple(); }
    catch (error) {
      if (error.message.includes("Create a private space") || error.message.includes("join with your partner")) {
        if (inviteToken) inviteMessage(error.message);
        $("create-space").hidden = false;
      } else inviteMessage(error.message);
    }
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

$("create-space").addEventListener("click", async () => {
  $("create-space").disabled = true;
  try { await request("/api/couple", { method: "POST", body: JSON.stringify({}) }); await loadCouple(); }
  catch (error) { inviteMessage(error.message); }
  finally { $("create-space").disabled = false; }
});

$("make-invite").addEventListener("click", async () => {
  $("make-invite").disabled = true;
  try {
    const result = await request("/api/couple/invites", { method: "POST", body: JSON.stringify({}) });
    const link = new URL("login.html", location.href);
    link.searchParams.set("invite", result.token);
    $("invite-link").value = link.href;
    $("invite-link-row").hidden = false;
    inviteMessage("Invite link created. It works once and expires in seven days.");
  } catch (error) { inviteMessage(error.message); }
  finally { $("make-invite").disabled = false; }
});

$("copy-invite").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("invite-link").value); inviteMessage("Copied. Send this link to your partner privately."); }
  catch { $("invite-link").select(); inviteMessage("Copy the selected invite link and send it to your partner privately."); }
});

$("sign-out").addEventListener("click", async () => {
  try { await request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }); location.assign("login.html"); }
  catch (error) { inviteMessage(error.message); }
});

initialize();
