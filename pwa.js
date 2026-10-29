(() => {
  if (window.Capacitor?.isNativePlatform?.() || !["https:", "http:"].includes(location.protocol)) return;
  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }
  const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (!installed()) {
    const footer = document.querySelector(".footer, .auth-footer");
    if (footer) {
      const link = document.createElement("a"); link.href = "install.html"; link.className = "legal-link"; link.textContent = "Add Closr to your phone";
      footer.append(link);
    }
  }
  const install = document.getElementById("install-button");
  const feedback = document.getElementById("install-feedback");
  let prompt = null;
  if (feedback && installed()) feedback.textContent = "You’re already opening Closr as an app.";
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!install || installed()) return;
    event.preventDefault(); prompt = event; install.hidden = false;
  });
  install?.addEventListener("click", async () => {
    if (!prompt) return;
    const request = prompt; prompt = null; install.hidden = true;
    try {
      await request.prompt();
      const choice = await request.userChoice;
      if (feedback) feedback.textContent = choice.outcome === "accepted" ? "Installation requested. Your browser will finish adding Closr." : "You can add Closr whenever you like.";
    } catch { if (feedback) feedback.textContent = "Use your browser’s menu to add Closr to your Home Screen."; }
  });
  window.addEventListener("appinstalled", () => {
    prompt = null; if (install) install.hidden = true;
    if (feedback) feedback.textContent = "Closr has been added to this device.";
  });
})();
