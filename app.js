const people = [
  { name: "Jamie", initial: "J", partner: "Alex", color: "lilac" },
  { name: "Alex", initial: "A", partner: "Jamie", color: "sage" },
];
const statuses = {
  open: { title: "Open to a chat", subtitle: "I have a little space to talk", symbol: "☀", emojiClass: "emoji-open" },
  quiet: { title: "Unavailable", subtitle: "Not up for talking right now", symbol: "☁", emojiClass: "emoji-quiet" },
  away: { title: "Away for a bit", subtitle: "Doing my own thing", symbol: "☾", emojiClass: "emoji-away" },
};
const relationshipStart = "2026-01-07";
const seedMemories = ["A little space during focused work helps us reconnect with more care."];
const $ = (id) => document.getElementById(id);
function apiFetch(path, options = {}) {
  const base = window.CLOSER_API_BASE_URL?.trim().replace(/\/+$/, "");
  const url = base ? new URL(path, `${base}/`).toString() : path;
  if (window.Capacitor?.isNativePlatform?.()) {
    if (!window.CLOSER_NATIVE_HTTP?.fetch) return Promise.reject(new Error("This app build is missing its connection setup. Please install an updated build."));
    return window.CLOSER_NATIVE_HTTP.fetch(url, options);
  }
  return fetch(url, { credentials: "include", ...options });
}
const page = document.body.dataset.page || "home";
let activePerson = Number(localStorage.getItem("closer-active-person") || 0);
let toastTimer;
let activeScope = new URLSearchParams(location.search).get("scope") === "shared" ? "shared" : "private";
let chatOpen = false;
let pendingVoiceStatus = null;
let activeRecorder = null;
let activeVoiceStream = null;
let voiceAutoStopTimer;
let remoteCouple = null;
let remoteRefreshTimer = null;
let remoteMemoryData = null;
let appSettings = null;
let appLoaded = false;
function isSolo() { return Boolean(remoteCouple && !remoteCouple.partner); }
function readChat(key) {
  try { const value = JSON.parse(sessionStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function writeChat(key, value) { sessionStorage.setItem(key, JSON.stringify(value)); }
function privateChatKey(index) { return remoteCouple ? `closer-private-chat-user-${remoteCouple.self.id}` : `closer-private-chat-${index}`; }
const sharedChatKey = "closer-shared-chat";
const partnerMessagesKey = "closer-partner-messages-v1";

function getPartnerMessages() {
  if (remoteCouple) return remoteCouple.messages.map((message) => ({
    id: message.id, senderIndex: message.senderId === remoteCouple.self.id ? 0 : 1,
    senderId: message.senderId, text: message.text, createdAt: message.createdAt,
  }));
  try {
    const value = JSON.parse(localStorage.getItem(partnerMessagesKey) || "[]");
    return Array.isArray(value) ? value.filter((message) => Number.isInteger(message?.senderIndex) && [0, 1].includes(message.senderIndex) && typeof message.text === "string" && Number.isFinite(message.createdAt)).slice(-500) : [];
  } catch { return []; }
}

function savePartnerMessages(messages) {
  if (remoteCouple) { remoteCouple.messages = messages; return; }
  localStorage.setItem(partnerMessagesKey, JSON.stringify(messages.slice(-500)));
}

function getStatus(personIndex) {
  if (remoteCouple) {
    const member = personIndex === 0 ? remoteCouple.self : remoteCouple.partner;
    const status = member && remoteCouple.statuses.find((item) => item.userId === member.id);
    if (!status || (status.expiresAt && status.expiresAt <= Date.now())) return null;
    return status;
  }
  const saved = localStorage.getItem(`closer-status-${personIndex}`);
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (value.expiresAt && value.expiresAt <= Date.now()) return null;
      return value;
    } catch { /* Ignore a status value from an older preview version. */ }
  }
  return { status: personIndex === 0 ? "quiet" : "open", updatedAt: Date.now(), expiresAt: null };
}

function getMemories() {
  if (remoteCouple) return (remoteMemoryData?.shared || []).filter((item) => item.kind === "shared_note").map((item) => item.body);
  try {
    const saved = JSON.parse(localStorage.getItem("closer-shared-memories") || "null");
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [...seedMemories];
  } catch { return [...seedMemories]; }
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function formatAge(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440) return `Updated ${Math.floor(minutes / 60)} hr${Math.floor(minutes / 60) === 1 ? "" : "s"} ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp)}`;
}

function relationshipDays() {
  const [year, month, day] = relationshipStart.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - start) / 86400000));
}

function renderHome(partner) {
  if (!$("partner-status-title")) return;
  const partnerIndex = activePerson === 0 ? 1 : 0;
  if (isSolo()) { renderPingControls(partnerIndex, "your partner", false); return; }
  const partnerCheckin = getStatus(partnerIndex);
  const partnerAvatar = $("partner-avatar");
  if (partnerAvatar) { partnerAvatar.textContent = partner.initial; partnerAvatar.className = `avatar avatar-${partner.color} hero-avatar`; }
  setText("welcome-partner", partner.name);
  setText("partner-name", partner.name);
  setText("home-together-days", String(relationshipDays()));
  const mood = partnerCheckin && statuses[partnerCheckin.status] ? statuses[partnerCheckin.status] : statuses.quiet;
  const isAvailable = partnerCheckin?.status === "open";
  const isUnavailable = ["quiet", "away"].includes(partnerCheckin?.status);
  const isCustom = partnerCheckin?.status === "custom";
  const icon = $("partner-status-icon");
  if (partnerCheckin) {
    icon.className = `status-emoji ${mood.emojiClass}`;
    icon.textContent = mood.symbol;
    setText("partner-status-title", isCustom ? "Custom message" : mood.title);
    setText("partner-status-subtitle", isCustom ? (partnerCheckin.customMessage || "A note from your person") : mood.subtitle);
    setText("partner-updated", formatAge(partnerCheckin.updatedAt));
    setText("partner-prompt", isAvailable
      ? `${partner.name} has a little space for a conversation. No pressure either way.`
      : isUnavailable ? `${partner.name} isn’t available to talk right now. You can give them space and talk it through with Closr.`
        : `${partner.name} shared a status. You can decide whether now feels like a good time to reach out.`);
  } else {
    icon.className = "status-emoji emoji-quiet"; icon.textContent = "◷";
    setText("partner-status-title", "No current status");
    setText("partner-status-subtitle", "They can share a status whenever they like.");
    setText("partner-updated", "Their last status expired");
    setText("partner-prompt", "A status is a small signal, not a promise to reply.");
  }
  const impactPrompt = $("how-might-land");
  if (impactPrompt) impactPrompt.dataset.thoughtPrompt = `If I say what I’m thinking, how might ${partner.name} receive it? Help me consider a few possibilities.`;
  renderPingControls(partnerIndex, partner.name, isUnavailable);
  renderHomeOwnStatus();
  const unreadPings = getPings(activePerson).filter((ping) => !ping.acknowledgedAt).length;
  const bell = $("bell-button");
  if (bell) { bell.setAttribute("aria-label", unreadPings ? `${unreadPings} gentle ping${unreadPings === 1 ? "" : "s"}` : "Notifications"); bell.classList.toggle("has-notifications", unreadPings > 0); }
}

function renderHomeOwnStatus() {
  if (!$('self-status-card')) return;
  const person = people[activePerson];
  const checkin = getStatus(activePerson);
  const mood = checkin && statuses[checkin.status] ? statuses[checkin.status] : null;
  const avatar = $('self-status-avatar');
  if (avatar) { avatar.textContent = person.initial; avatar.className = `avatar avatar-${person.color} hero-avatar`; }
  setText('self-status-name', person.name);
  setText('self-status-age', checkin ? formatAge(checkin.updatedAt) : 'Your last status expired');
  const icon = $('self-status-icon');
  if (icon) {
    icon.className = `status-emoji ${mood ? mood.emojiClass : checkin?.status === 'custom' ? 'emoji-away' : 'emoji-quiet'}`;
    icon.textContent = mood ? mood.symbol : checkin?.status === 'custom' ? '✎' : '◷';
  }
  setText('self-status-title', checkin?.status === 'custom' ? 'Custom message' : mood ? mood.title : 'No current status');
  setText('self-status-subtitle', checkin?.status === 'custom' ? (checkin.customMessage || 'A note from you') : mood ? mood.subtitle : `Choose a status to let ${people[activePerson === 0 ? 1 : 0].name} know`);
  document.querySelectorAll('[data-inline-status]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.inlineStatus === checkin?.status));
  });
  const editor = $('inline-custom-editor');
  if (editor?.hidden && $('inline-custom-input')) $('inline-custom-input').value = checkin?.status === 'custom' ? checkin.customMessage || '' : '';
}

function pingAge(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"} ago`;
}
function getPings(personIndex) {
  if (remoteCouple) {
    const member = personIndex === 0 ? remoteCouple.self : remoteCouple.partner;
    if (!member) return [];
    return remoteCouple.pings.filter((ping) => ping.recipientId === member.id).map((ping) => ({
      id: ping.id, senderIndex: ping.senderId === remoteCouple.self.id ? 0 : 1,
      senderId: ping.senderId, recipientId: ping.recipientId, createdAt: ping.createdAt, acknowledgedAt: ping.acknowledgedAt,
    }));
  }
  try { const value = JSON.parse(localStorage.getItem(`closer-pings-${personIndex}`) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function savePings(personIndex, pings) { localStorage.setItem(`closer-pings-${personIndex}`, JSON.stringify(pings)); }
function renderPingControls(partnerIndex, partnerName, isUnavailable) {
  const inbox = $("ping-inbox"); const list = $("ping-inbox-list");
  if (inbox && list) {
    const received = getPings(activePerson).filter((ping) => !ping.acknowledgedAt);
    inbox.hidden = received.length === 0; list.replaceChildren();
    received.forEach((ping) => {
      const row = document.createElement("div"); row.className = "ping-notice";
      const message = document.createElement("p");
      message.textContent = `${people[ping.senderIndex]?.name || "Your person"} sent you a gentle ping · ${pingAge(ping.createdAt)}`;
      const acknowledge = document.createElement("button"); acknowledge.type = "button"; acknowledge.dataset.pingAck = ping.id; acknowledge.className = "ping-acknowledge"; acknowledge.textContent = "Got it";
      row.append(message, acknowledge); list.append(row);
    });
  }
  const control = $("ping-control");
  if (control) {
    control.hidden = !isUnavailable;
    if (!isUnavailable) return;
    setText("ping-control-copy", `Let ${partnerName} know you’d like to talk when they have space. This won’t send a message.`);
    const pending = getPings(partnerIndex).find((ping) => ping.senderIndex === activePerson && !ping.acknowledgedAt);
    const button = $("send-ping");
    button.disabled = Boolean(pending);
    const age = pending ? pingAge(pending.createdAt) : "";
    button.textContent = pending ? `♡ Ping sent · ${age}` : "♡ Send a gentle ping";
  }
}

function renderStatusMenu() {
  const status = getStatus(activePerson);
  const menu = $("status-menu");
  const toggle = $("status-menu-toggle");
  const label = status?.status === "open" ? "Open to chat" : status?.status === "custom" ? (status.customMessage || "Custom message") : "Unavailable";
  setText("status-menu-current", isSolo() ? people[0].name : label);
  const menuHeading = menu?.querySelector(".status-menu-heading > span");
  if (menuHeading) menuHeading.textContent = isSolo() ? "YOUR PROFILE" : "YOUR STATUS";
  if (menu && toggle) toggle.setAttribute("aria-expanded", String(!menu.hidden));
}
function renderStatusPage() {
  if (!$("own-status-title")) return;
  const ownCheckin = getStatus(activePerson);
  const mood = ownCheckin && statuses[ownCheckin.status] ? statuses[ownCheckin.status] : null;
  const icon = $("own-status-icon");
  icon.className = `status-emoji ${mood ? mood.emojiClass : "emoji-quiet"}`;
  icon.textContent = mood ? mood.symbol : "◷";
  setText("own-status-title", mood ? mood.title : "No current check-in");
  setText("own-status-age", ownCheckin ? formatAge(ownCheckin.updatedAt) : "Your last check-in expired");
  document.querySelectorAll(".status-option").forEach((button) => {
    button.setAttribute("aria-pressed", String(Boolean(mood && button.dataset.status === ownCheckin.status)));
  });
}

function readEntries(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function writeEntries(key, entries) { localStorage.setItem(key, JSON.stringify(entries)); }
function personalJournalKey() { return `closer-private-journal-${activePerson}`; }
async function refreshRemoteMemories(render = true) {
  if (!remoteCouple) return;
  const response = await apiFetch("/api/couple/memories", { credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Couldn’t load your memories.");
  remoteMemoryData = { shared: Array.isArray(data.shared) ? data.shared : [], personal: Array.isArray(data.personal) ? data.personal : [] };
  if (render) renderMemoryPage();
}
async function saveRemoteMemory(entry) {
  const response = await apiFetch("/api/couple/memories", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Couldn’t save that shared memory.");
  await refreshRemoteMemories(false);
}
async function saveRemotePrivateEntry(entry) {
  const response = await apiFetch("/api/couple/private-journal", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Couldn’t save your private entry.");
  await refreshRemoteMemories(false);
}
function friendlyDate(value) {
  if (!value) return "Date not set";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}
function renderRecords(listId, records, storageKey, options = {}) {
  const list = $(listId);
  if (!list) return;
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p"); empty.className = "memory-empty";
    empty.textContent = options.empty || "Nothing saved here yet. Add the first memory when you’re ready.";
    list.append(empty); return;
  }
  records.forEach((record) => {
    const card = document.createElement("article"); card.className = "memory-record";
    const content = document.createElement("div"); content.className = "memory-record-content";
    const meta = document.createElement("div"); meta.className = "memory-record-meta";
    const date = document.createElement("span"); date.textContent = friendlyDate(record.date); meta.append(date);
    if (record.folder) { const folder = document.createElement("span"); folder.className = "folder-chip"; folder.textContent = record.folder; meta.append(folder); }
    const title = document.createElement("h3"); title.textContent = record.title || record.feeling || "A note to self";
    const body = document.createElement("p"); body.textContent = record.body || "";
    content.append(meta, title, body);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "memory-remove"; remove.setAttribute("aria-label", "Delete this entry"); remove.textContent = "×";
    remove.addEventListener("click", () => {
      if (remoteCouple && options.deleteEndpoint) {
        remove.disabled = true;
        apiFetch(`${options.deleteEndpoint}/${encodeURIComponent(record.id)}`, { method: "DELETE", credentials: "include" })
          .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Couldn’t remove that entry."); await refreshRemoteMemories(); showToast("Entry removed."); })
          .catch((error) => { remove.disabled = false; showToast(error.message); });
        return;
      }
      const latest = readEntries(storageKey).filter((entry) => entry.id !== record.id);
      writeEntries(storageKey, latest); renderMemoryCollections(); showToast("Entry removed from this preview.");
    });
    card.append(content);
    if (record.image) { const image = document.createElement("img"); image.className = "memory-record-image"; image.src = record.image; image.alt = record.imageAlt || `Photo for ${record.title || "this memory"}`; card.append(image); }
    card.append(remove); list.append(card);
  });
}
function renderMemoryCollections() {
  if (remoteCouple) {
    const data = remoteMemoryData || { shared: [], personal: [] };
    renderRecords("date-list", data.shared.filter((entry) => entry.kind === "important_date"), "", { deleteEndpoint: "/api/couple/memories", empty: "Your important dates will live here, with a note if you choose." });
    const journal = data.shared.filter((entry) => entry.kind === "shared_journal");
    const folderFilter = $("journal-filter");
    if (folderFilter) {
      const selected = folderFilter.value || "all";
      const folders = [...new Set(journal.map((entry) => entry.folder).filter(Boolean))].sort((a,b) => a.localeCompare(b));
      folderFilter.replaceChildren(new Option("All folders", "all"), ...folders.map((folder) => new Option(folder, folder)));
      folderFilter.value = folders.includes(selected) ? selected : "all";
    }
    renderRecords("journal-list", journal.filter((entry) => !folderFilter || folderFilter.value === "all" || entry.folder === folderFilter.value), "", { deleteEndpoint: "/api/couple/memories", empty: "Your trips, days out, and little moments will collect here." });
    setText("personal-owner", (remoteCouple.self.name || "YOU").toUpperCase());
    renderRecords("personal-list", data.personal, "", { deleteEndpoint: "/api/couple/private-journal", empty: "Your private reflections will appear here." });
    return;
  }
  const dates = readEntries("closer-important-dates").sort((a,b) => a.date.localeCompare(b.date));
  renderRecords("date-list", dates, "closer-important-dates", { empty: "Your important dates will live here, with a photo or note if you choose." });
  const journal = readEntries("closer-couple-journal");
  const folderFilter = $("journal-filter");
  if (folderFilter) {
    const selected = folderFilter.value || "all";
    const folders = [...new Set(journal.map((entry) => entry.folder).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    folderFilter.replaceChildren(new Option("All folders", "all"), ...folders.map((folder) => new Option(folder, folder)));
    folderFilter.value = folders.includes(selected) ? selected : "all";
  }
  const shownJournal = journal.filter((entry) => !folderFilter || folderFilter.value === "all" || entry.folder === folderFilter.value).sort((a,b) => b.date.localeCompare(a.date));
  renderRecords("journal-list", shownJournal, "closer-couple-journal", { empty: "Your trips, days out, and little moments will collect here." });
  const personalKey = personalJournalKey();
  const personal = readEntries(personalKey).sort((a,b) => b.date.localeCompare(a.date));
  setText("personal-owner", people[activePerson].name.toUpperCase());
  renderRecords("personal-list", personal, personalKey, { empty: "Your private reflections for this profile will appear here." });
}
function renderMemoryPage() {
  setText("together-days", String(relationshipDays()));
  const list = $("memory-list");
  if (list) {
    list.replaceChildren();
    const memories = getMemories();
    if (!memories.length) {
      const empty = document.createElement("p"); empty.className = "memory-empty";
      empty.textContent = "No shared notes yet. Add only what you both want Closr to remember.";
      list.append(empty);
    } else memories.forEach((memory, index) => {
      const row = document.createElement("div"); row.className = "memory-item";
      const marker = document.createElement("span"); marker.className = "memory-marker"; marker.textContent = "♡";
      const text = document.createElement("p"); text.textContent = memory;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "memory-remove"; remove.setAttribute("aria-label", "Remove shared note"); remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (remoteCouple) {
          const entry = remoteMemoryData?.shared.filter((item) => item.kind === "shared_note")[index];
          if (!entry) return;
          remove.disabled = true;
          apiFetch(`/api/couple/memories/${encodeURIComponent(entry.id)}`, { method: "DELETE", credentials: "include" })
            .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Couldn’t remove that note."); await refreshRemoteMemories(); showToast("Shared note removed."); })
            .catch((error) => { remove.disabled = false; showToast(error.message); });
          return;
        }
        const next = getMemories(); next.splice(index, 1); localStorage.setItem("closer-shared-memories", JSON.stringify(next)); renderMemoryPage(); showToast("Shared note removed.");
      });
      row.append(marker, text, remove); list.append(row);
    });
  }
  renderMemoryCollections();
}
async function compressPhoto(input) {
  const file = input?.files?.[0];
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read that image.")); reader.readAsDataURL(file); });
  const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Could not open that image.")); element.src = source; });
  const scale = Math.min(1, 1400 / image.width, 1400 / image.height);
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL("image/jpeg", 0.78);
  if (result.length > 1_200_000) throw new Error("That photo is too large after compression. Try a smaller image.");
  return result;
}
async function uploadRemotePhoto(input, scope) {
  const dataUrl = await compressPhoto(input);
  if (!dataUrl) return null;
  const [metadata, encoded] = dataUrl.split(",", 2);
  const mime = metadata.match(/^data:(image\/[a-z0-9.+-]+);base64$/i)?.[1];
  if (!mime || !encoded) throw new Error("Couldn’t prepare that photo for upload.");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const response = await apiFetch(`/api/couple/media?scope=${encodeURIComponent(scope)}`, {
    method: "POST", headers: { "Content-Type": mime }, body: new Blob([bytes], { type: mime }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Couldn’t upload that photo.");
  return data.mediaId;
}
function setupMemoryTabs() {
  document.querySelectorAll("[data-memory-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const selected = tab.dataset.memoryTab;
    document.querySelectorAll("[data-memory-tab]").forEach((item) => { const active = item === tab; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll("[data-memory-view]").forEach((view) => { const active = view.dataset.memoryView === selected; view.classList.toggle("active", active); view.hidden = !active; });
  }));
}
function setupMemoryEntryForms() {
  const today = new Date(); const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  for (const id of ["date-value", "journal-date", "personal-date"]) if ($(id)) $(id).value = localToday;
  $("journal-filter")?.addEventListener("change", renderMemoryCollections);
  $("date-entry-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const entry = { kind: "important_date", title: $("date-title").value.trim(), date: $("date-value").value, body: $("date-note").value.trim() };
      if (remoteCouple) { entry.mediaId = await uploadRemotePhoto($("date-photo"), "shared"); await saveRemoteMemory(entry); }
      else { const entries = readEntries("closer-important-dates"); entries.push({ id: crypto.randomUUID(), ...entry, image: await compressPhoto($("date-photo")), imageAlt: entry.title }); writeEntries("closer-important-dates", entries); }
      form.reset(); $("date-value").value = localToday; renderMemoryCollections(); showToast("Important date saved.");
    } catch (error) { showToast(error.message); }
  });
  $("journal-entry-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const entry = { kind: "shared_journal", title: $("journal-title").value.trim(), date: $("journal-date").value, folder: $("journal-folder").value.trim() || "Unsorted", body: $("journal-note").value.trim() };
      if (remoteCouple) { entry.mediaId = await uploadRemotePhoto($("journal-photo"), "shared"); await saveRemoteMemory(entry); }
      else { const entries = readEntries("closer-couple-journal"); entries.push({ id: crypto.randomUUID(), ...entry, image: await compressPhoto($("journal-photo")), imageAlt: entry.title }); writeEntries("closer-couple-journal", entries); }
      form.reset(); $("journal-date").value = localToday; $("journal-folder").value = "Trips"; renderMemoryCollections(); showToast("Memory saved to your shared journal.");
    } catch (error) { showToast(error.message); }
  });
  $("personal-entry-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const saveButton = form.querySelector('[type="submit"]');
    saveButton.disabled = true;
    try {
      const entry = { date: $("personal-date").value, feeling: $("personal-feeling").value, body: $("personal-note").value.trim() };
      if (remoteCouple) { entry.mediaId = await uploadRemotePhoto($("personal-photo"), "private"); await saveRemotePrivateEntry(entry); }
      else { const entries = readEntries(personalJournalKey()); entries.push({ id: crypto.randomUUID(), ...entry }); writeEntries(personalJournalKey(), entries); }
      form.reset(); $("personal-date").value = localToday; renderMemoryCollections(); showToast("Private reflection saved to your account.");
    } catch (error) { showToast(error.message); }
    finally { saveButton.disabled = false; }
  });
  $("generate-reflection")?.addEventListener("click", () => {
    const now = new Date(); const period = $("reflection-period").value;
    const entries = (remoteCouple ? (remoteMemoryData?.personal || []) : readEntries(personalJournalKey())).filter((entry) => {
      const [year,month,day] = entry.date.split("-").map(Number); const date = new Date(year,month-1,day);
      if (period === "week") { const start = new Date(now.getFullYear(),now.getMonth(),now.getDate()-6); return date >= start && date <= now; }
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    const prompt = $("reflection-prompt").value.trim(); const result = $("reflection-result");
    if (!entries.length) { result.textContent = `There aren’t any private entries saved for this ${period} yet. Add a few reflections and check back.`; return; }
    const feelings = new Map(); entries.forEach((entry) => feelings.set(entry.feeling, (feelings.get(entry.feeling) || 0) + 1));
    const leading = [...feelings.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([feeling,count]) => `${feeling.toLowerCase()} (${count})`).join(", ");
    const fragments = entries.slice(0,2).map((entry) => entry.body.length > 110 ? `${entry.body.slice(0,107)}…` : entry.body);
    result.textContent = `You wrote ${entries.length} entr${entries.length === 1 ? "y" : "ies"} this ${period}. Feelings you recorded most: ${leading}. ${prompt ? `For “${prompt}”, ` : ""}Your notes include: “${fragments.join("” and “")}”. This is a simple local reflection from your entries, not an AI interpretation.`;
  });
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function openDialog(id) {
  const dialog = $(id);
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
  dialog.setAttribute("aria-modal", "true");
  dialog.classList.add("fallback-open");
  document.body.classList.add("modal-active");
}

function closeDialog(id) {
  const dialog = $(id);
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
    dialog.removeAttribute("aria-modal");
    dialog.classList.remove("fallback-open");
    if (!document.querySelector("dialog.fallback-open")) document.body.classList.remove("modal-active");
  }
  if (id === "chat-dialog") chatOpen = false;
}

function saveStatus(status, duration, customMessage = "") {
  if (isSolo()) { showToast("Connect your partner whenever you’re ready to share check-ins."); return; }
  let expiresAt = null;
  if (duration === "1") expiresAt = Date.now() + 60 * 60 * 1000;
  if (duration === "today") {
    const tonight = new Date();
    tonight.setHours(23, 59, 59, 999);
    expiresAt = tonight.getTime();
  }
  const savedStatus = { status, customMessage: status === "custom" ? customMessage : "", updatedAt: Date.now(), expiresAt };
  if (!remoteCouple) localStorage.setItem(`closer-status-${activePerson}`, JSON.stringify(savedStatus));
  if (remoteCouple) {
    const sharedStatus = { ...savedStatus, userId: remoteCouple.self.id };
    remoteCouple.statuses = remoteCouple.statuses.filter((item) => item.userId !== remoteCouple.self.id).concat(sharedStatus);
    apiFetch("/api/couple/status", {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sharedStatus),
    }).then(async (response) => {
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Couldn’t share your status."); }
    }).catch((error) => { showToast(error.message); refreshRemoteCouple(); });
  }
  if ($("status-menu")) $("status-menu").hidden = true;
  if ($("inline-custom-editor")) $("inline-custom-editor").hidden = true;
  renderCommon();
  showToast("Your check-in is updated.");
}

function switchDemoProfile() {
  if (remoteCouple) return;
  activePerson = activePerson === 0 ? 1 : 0;
  localStorage.setItem("closer-active-person", String(activePerson));
  renderCommon();
  showToast(`Previewing ${people[activePerson].name}'s page.`);
}

function currentChat() {
  if (remoteCouple && activeScope === "shared") return remoteCouple.closerMessages.map((message) => ({
    role: message.role, text: message.text,
    author: message.senderId === remoteCouple.self.id ? people[0].name : people[1].name,
  }));
  return readChat(activeScope === "private" ? privateChatKey(activePerson) : sharedChatKey);
}

function renderChat() {
  const messages = $("chat-messages");
  if (!messages) return;
  messages.replaceChildren();
  if (isSolo()) activeScope = "private";
  const partner = people[activePerson === 0 ? 1 : 0];
  const partnerCheckin = getStatus(activePerson === 0 ? 1 : 0);
  if (activeScope === "private") {
    setText("chat-title", page === "home" ? "A moment with Closr" : "A moment for you");
    $("chat-privacy").innerHTML = "<span>⌑</span> Private to your account. Messages are sent to OpenAI when you use AI chat; they aren’t added to shared conversations.";
    setText("chat-footnote", remoteCouple ? "Private to you · this conversation stays in the current browser tab." : "Preview only · AI replies require an API key; chat stays for this browser tab session.");
  } else {
    setText("chat-title", "Your shared conversation");
    $("chat-privacy").innerHTML = "<span>♡</span> This conversation is shared. Both partners can read it.";
    setText("chat-footnote", remoteCouple ? "Shared between your accounts · either of you can continue this conversation." : "Preview only · AI replies require an API key; chat stays for this browser tab session.");
  }
  const history = currentChat();
  if (!history.length) {
    const intro = document.createElement("div");
    intro.className = "chat-bubble assistant-bubble";
    intro.textContent = isSolo()
      ? "A little room for you. Reflect on your day, sort through a feeling, or think about what you want to say."
      : activeScope === "shared"
      ? "This is a space for both of you and Closr. Anything written here is visible to both partners. What would you like to talk about together?"
      : partnerCheckin && ["quiet", "away"].includes(partnerCheckin.status)
        ? `${partner.name} is unavailable right now, so take your time to tell me what you wanted to say and we’ll think it through together.`
        : partnerCheckin?.status === "open"
          ? `${partner.name} is open to chat, and I can help you find the right words for what you want to say.`
          : `Tell me what you want ${partner.name} to understand, and I can help you find a thoughtful way to say it.`;
    messages.append(intro);
  } else {
    history.forEach((message) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${message.role === "user" ? "user-bubble" : "assistant-bubble"}`;
      if (activeScope === "shared" && message.role === "user") {
        const author = document.createElement("strong");
        author.className = "message-author";
        author.textContent = `${message.author}: `;
        bubble.append(author);
      }
      bubble.append(document.createTextNode(message.text));
      messages.append(bubble);
    });
  }
  messages.scrollTop = messages.scrollHeight;
  if ($("chat-input")) { $("chat-input").placeholder = activeScope === "shared" ? "Write a message you’re both okay sharing…" : "What’s on your mind?"; $("chat-input").setAttribute("aria-label", activeScope === "shared" ? "Write a shared message to Closr" : "Write a private message to Closr"); }
  if (appSettings && !appSettings.aiConfigured) {
    $("chat-input").disabled = true;
    $("chat-send").disabled = true;
    document.querySelectorAll("[data-thought-prompt]").forEach((button) => { button.disabled = true; });
    setText("chat-footnote", "AI chat isn’t connected yet. You can keep a private journal in the meantime.");
  }
}

function renderPartnerChat() {
  const container = $("direct-chat-messages");
  if (!container) return;
  if (isSolo()) {
    setText("direct-partner-name", "Your partner");
    setText("direct-partner-heading", "Chat together");
    setText("direct-partner-status", "Connect whenever you’re ready");
    setText("direct-partner-avatar", "♡");
    container.innerHTML = '<div class="direct-chat-empty"><span class="direct-chat-empty-heart">♡</span><strong>Your shared chat will be here</strong><p>For now, this space is yours to explore. Invite your partner when you’d like to start a conversation together.</p><button type="button" class="connect-button" data-invite-partner>Invite your partner</button></div>';
    return;
  }
  const partnerIndex = activePerson === 0 ? 1 : 0;
  const partner = people[partnerIndex];
  const status = getStatus(partnerIndex);
  const statusCopy = status?.status === "open" ? "Open to a chat"
    : status?.status === "custom" ? (status.customMessage || "Shared a custom status")
      : status?.status === "away" ? "Away for a bit" : "Unavailable";
  setText("direct-partner-name", partner.name);
  setText("direct-partner-heading", partner.name);
  setText("direct-partner-status", statusCopy);
  const avatar = $("direct-partner-avatar");
  if (avatar) { avatar.textContent = partner.initial; avatar.className = `avatar avatar-${partner.color}`; }
  const statusDot = $("direct-status-dot");
  if (statusDot) statusDot.classList.toggle("is-open", status?.status === "open");

  const history = getPartnerMessages();
  container.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "direct-chat-empty";
    const heart = document.createElement("span"); heart.className = "direct-chat-empty-heart"; heart.textContent = "♡";
    const title = document.createElement("strong"); title.textContent = "A little space for the two of you";
    const copy = document.createElement("p"); copy.textContent = "Your conversation starts here. Say what’s on your mind, gently and in your own time.";
    empty.append(heart, title, copy); container.append(empty);
  } else {
    let previousDay = "";
    history.forEach((message) => {
      const date = new Date(message.createdAt);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (dayKey !== previousDay) {
        const divider = document.createElement("div"); divider.className = "direct-chat-day";
        divider.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(date);
        container.append(divider); previousDay = dayKey;
      }
      const mine = remoteCouple ? message.senderId === remoteCouple.self.id : message.senderIndex === activePerson;
      const row = document.createElement("article"); row.className = `direct-message ${mine ? "mine" : "theirs"}`;
      const bubble = document.createElement("div"); bubble.className = "direct-message-bubble"; bubble.textContent = message.text;
      const meta = document.createElement("div"); meta.className = "direct-message-meta";
      const sender = document.createElement("span"); sender.textContent = mine ? "You" : partner.name;
      const time = document.createElement("time"); time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
      meta.append(sender, time); row.append(bubble, meta); container.append(row);
    });
  }
  container.scrollTop = container.scrollHeight;
}

function openChat(scope = "private") {
  if (isSolo() && scope === "shared") { openDialog("partner-invite-dialog"); return; }
  if (page !== "chat") {
    const destination = new URL("chat.html", location.href);
    if (scope === "shared") destination.searchParams.set("scope", "shared");
    location.href = destination.href;
    return;
  }
  activeScope = scope;
  document.querySelectorAll(".chat-tab").forEach((tab) => {
    const selected = tab.dataset.scope === scope;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  renderChat();
}

function interpretVoiceCommand(transcript) {
  const phrase = transcript.toLowerCase();
  let status = null;
  if (/\b(unavailable|not available|quiet|don't want to talk|do not want to talk|not up for talking)\b/.test(phrase) || /बात नहीं|अभी बात नहीं|baat nahi/.test(phrase)) status = "quiet";
  else if (/\b(away|busy|later|not now)\b/.test(phrase) || /अभी नहीं|baad mein/.test(phrase)) status = "away";
  else if (/\b(open|online|available|ready to talk|ready to chat|want to chat|want to talk)\b/.test(phrase) || /बात करनी|baat karni/.test(phrase)) status = "open";
  if (!status) return null;
  let duration = $("home-status-duration")?.value || $("status-duration")?.value || "1";
  if (/\b(until i change|don't expire|no expiry)\b/.test(phrase) || /बदलने तक/.test(phrase)) duration = "forever";
  else if (/\b(today|tonight|this evening)\b/.test(phrase) || /आज|शाम/.test(phrase)) duration = "today";
  else if (/\b(hour|one hour|an hour)\b/.test(phrase) || /घंटा|एक घंटा/.test(phrase)) duration = "1";
  return { status, duration };
}

function handleVoiceTranscript(transcript) {
  const feedback = $("voice-feedback");
  pendingVoiceStatus = interpretVoiceCommand(transcript);
  if (!pendingVoiceStatus) {
    feedback.textContent = `I heard “${transcript}”, but couldn’t match it to a status. Try “set my status online” or choose below.`;
    $("voice-confirm").hidden = true;
    return;
  }
  const durationLabel = pendingVoiceStatus.duration === "1" ? "for 1 hour" : pendingVoiceStatus.duration === "today" ? "until tonight" : "until you change it";
  feedback.textContent = `I heard: “${statuses[pendingVoiceStatus.status].title} ${durationLabel}.” Confirm before I change it.`;
  $("voice-confirm").hidden = false;
}

async function recordVoiceStatus() {
  const feedback = $("voice-feedback");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    feedback.textContent = "Voice input isn’t available in this browser. Choose a status above instead.";
    return;
  }
  try {
    activeVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const formats = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mimeType = formats.find((type) => MediaRecorder.isTypeSupported(type));
    activeRecorder = new MediaRecorder(activeVoiceStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    activeRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    activeRecorder.addEventListener("stop", async () => {
      clearTimeout(voiceAutoStopTimer);
      feedback.textContent = "Transcribing your short status command…";
      $("voice-status-button").disabled = true;
      try {
        const audio = new Blob(chunks, { type: activeRecorder.mimeType || mimeType || "audio/webm" });
        const response = await apiFetch("/api/transcribe", { method: "POST", headers: { "Content-Type": audio.type }, body: audio });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Couldn’t transcribe that recording.");
        if (!result.transcript) throw new Error("I didn’t hear any words. Try again or choose a status above.");
        handleVoiceTranscript(result.transcript);
      } catch (error) {
        feedback.textContent = error.message === "Failed to fetch"
          ? "Voice transcription isn’t connected. Start the local server with an API key, or choose a status above."
          : error.message;
      } finally {
        activeVoiceStream?.getTracks().forEach((track) => track.stop());
        activeVoiceStream = null;
        activeRecorder = null;
        $("voice-status-button").disabled = false;
        $("voice-status-button").innerHTML = "<span>⌕</span> Speak a status";
      }
    }, { once: true });
    activeRecorder.start();
    $("voice-status-button").textContent = "Stop and transcribe";
    feedback.textContent = "Listening for a short status command. Your recording will be sent for transcription when you stop.";
    voiceAutoStopTimer = setTimeout(() => { if (activeRecorder?.state === "recording") activeRecorder.stop(); }, 8000);
  } catch (error) {
    activeVoiceStream?.getTracks().forEach((track) => track.stop());
    activeVoiceStream = null;
    activeRecorder = null;
    feedback.textContent = error.name === "NotAllowedError"
      ? "Microphone access was declined. Choose a status above instead."
      : "Couldn’t start voice input. Choose a status above instead.";
  }
}

function startVoiceStatus() {
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
    return;
  }
  const feedback = $("voice-feedback");
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    recordVoiceStatus();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  feedback.textContent = "Listening. Say “open to a chat”, “taking quiet”, or “away for a bit”.";
  recognition.onresult = (event) => {
    handleVoiceTranscript(event.results[0][0].transcript);
  };
  recognition.onerror = (event) => {
    feedback.textContent = event.error === "not-allowed" ? "Microphone access was declined. Choose a status above instead." : "I couldn’t hear that. Please try again or choose a status above.";
  };
  recognition.onend = () => { $("voice-status-button").disabled = false; };
  $("voice-status-button").disabled = true;
  recognition.start();
}

$("bell-button")?.addEventListener("click", () => {
  const inbox = $("ping-inbox");
  if (inbox && !inbox.hidden) inbox.scrollIntoView({ behavior: "smooth", block: "center" });
  else showToast("No new pings.");
});
$("send-ping")?.addEventListener("click", () => {
  const partnerIndex = activePerson === 0 ? 1 : 0;
  if (remoteCouple) {
    const button = $("send-ping"); button.disabled = true;
    apiFetch("/api/couple/pings", { method: "POST", credentials: "include" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Couldn’t send a gentle ping."); await refreshRemoteCouple(); showToast("Your person will see a gentle ping next time they open Closr."); })
      .catch((error) => { button.disabled = false; showToast(error.message); });
    return;
  }
  const pings = getPings(partnerIndex);
  if (pings.some((ping) => ping.senderIndex === activePerson && !ping.acknowledgedAt)) return;
  pings.push({ id: crypto.randomUUID(), senderIndex: activePerson, createdAt: Date.now(), acknowledgedAt: null });
  savePings(partnerIndex, pings); renderCommon(); showToast(`A gentle ping is saved for ${people[partnerIndex].name}'s next visit.`);
});
$("ping-inbox-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ping-ack]"); if (!button) return;
  if (remoteCouple) {
    button.disabled = true;
    apiFetch(`/api/couple/pings/${encodeURIComponent(button.dataset.pingAck)}`, { method: "PATCH", credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error("Couldn’t mark that ping as seen."); await refreshRemoteCouple(); })
      .catch((error) => { button.disabled = false; showToast(error.message); });
    return;
  }
  const pings = getPings(activePerson).map((ping) => ping.id === button.dataset.pingAck ? { ...ping, acknowledgedAt: Date.now() } : ping);
  savePings(activePerson, pings); renderCommon();
});
$("status-menu-toggle")?.addEventListener("click", () => {
  const menu = $("status-menu"); menu.hidden = !menu.hidden; $("status-menu-toggle").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("[data-self-status]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.selfStatus === "custom") { $("status-menu-custom").hidden = false; $("status-menu-custom-input").focus(); return; }
  saveStatus(button.dataset.selfStatus, "forever");
}));
document.querySelectorAll("[data-inline-status]").forEach((button) => button.addEventListener("click", () => {
  saveStatus(button.dataset.inlineStatus, "forever");
}));
$("inline-custom-toggle")?.addEventListener("click", () => {
  const editor = $("inline-custom-editor");
  editor.hidden = false;
  $("inline-custom-input").focus();
});
$("inline-custom-save")?.addEventListener("click", () => {
  const message = $("inline-custom-input").value.trim();
  if (!message) { showToast("Add a short status first."); return; }
  saveStatus("custom", "forever", message);
});
$("inline-custom-cancel")?.addEventListener("click", () => {
  $("inline-custom-editor").hidden = true;
  renderHomeOwnStatus();
});
$("save-status-menu-custom")?.addEventListener("click", () => {
  const message = $("status-menu-custom-input").value.trim(); if (!message) { showToast("Add a short status first."); return; }
  saveStatus("custom", "forever", message); $("status-menu-custom").hidden = true;
});
document.addEventListener("click", (event) => {
  const control = document.querySelector(".profile-status-control"); const menu = $("status-menu");
  if (control && menu && !control.contains(event.target)) { menu.hidden = true; $("status-menu-toggle")?.setAttribute("aria-expanded", "false"); }
});
document.querySelectorAll("[data-thought-prompt]").forEach((button) => button.addEventListener("click", () => {
  const input = $("chat-input"); if (input) { input.value = button.dataset.thoughtPrompt; input.focus(); }
}));
document.querySelectorAll(".status-option").forEach((button) => button.addEventListener("click", () => {
  saveStatus(button.dataset.status, $("status-duration")?.value || "1");
  if ($("voice-confirm")) $("voice-confirm").hidden = true;
}));
$("person-switcher")?.addEventListener("click", switchDemoProfile);
$("voice-status-button")?.addEventListener("click", startVoiceStatus);
$("voice-confirm-save")?.addEventListener("click", () => {
  if (!pendingVoiceStatus) return;
  saveStatus(pendingVoiceStatus.status, pendingVoiceStatus.duration);
  pendingVoiceStatus = null;
  $("voice-confirm").hidden = true;
  $("voice-feedback").textContent = "Your voice status is saved.";
});
$("voice-confirm-cancel")?.addEventListener("click", () => {
  pendingVoiceStatus = null;
  $("voice-confirm").hidden = true;
  $("voice-feedback").textContent = "No change made. You can try another voice command or choose a status above.";
});

$("open-private-chat")?.addEventListener("click", (event) => { if (page !== "chat") { event.preventDefault(); openChat("private"); } });
document.querySelectorAll(".chat-tab").forEach((tab) => tab.addEventListener("click", () => {
  activeScope = tab.dataset.scope;
  document.querySelectorAll(".chat-tab").forEach((candidate) => {
    const selected = candidate === tab;
    candidate.classList.toggle("active", selected);
    candidate.setAttribute("aria-selected", String(selected));
  });
  renderChat();
}));
$("chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text) return;
  const mode = activeScope;
  if (remoteCouple && mode === "shared") {
    $("chat-input").value = "";
    $("chat-send").disabled = true;
    $("chat-input").disabled = true;
    try {
      const response = await apiFetch("/api/couple/closer-chat", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Closr couldn’t answer just now.");
      remoteCouple.closerMessages = data.messages;
      renderChat();
    } catch (error) {
      $("chat-input").value = text;
      showToast(error.message);
    } finally {
      $("chat-send").disabled = false;
      $("chat-input").disabled = false;
      $("chat-input").focus();
    }
    return;
  }
  const history = currentChat();
  const userMessage = { role: "user", text, author: people[activePerson].name };
  history.push(userMessage);
  writeChat(mode === "private" ? privateChatKey(activePerson) : sharedChatKey, history);
  $("chat-input").value = "";
  $("chat-send").disabled = true;
  $("chat-input").disabled = true;
  renderChat();
  const requestMessages = history.map(({ role, text: content }) => ({ role, content }));
  try {
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: mode,
        messages: requestMessages,
        partnerName: people[activePerson === 0 ? 1 : 0].name,
        partnerStatus: getStatus(activePerson === 0 ? 1 : 0)?.status || "no current check-in",
        partnerCustomMessage: getStatus(activePerson === 0 ? 1 : 0)?.customMessage || "",
        sharedMemories: remoteCouple ? [] : getMemories(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Closr couldn’t answer just now.");
    history.push({ role: "assistant", text: data.reply });
    writeChat(mode === "private" ? privateChatKey(activePerson) : sharedChatKey, history);
  } catch (error) {
    history.push({ role: "assistant", text: error.message === "Failed to fetch"
      ? "The AI service isn’t connected in this preview yet. Start the local server and configure its API key to enable replies."
      : error.message });
    writeChat(mode === "private" ? privateChatKey(activePerson) : sharedChatKey, history);
  } finally {
    $("chat-send").disabled = false;
    $("chat-input").disabled = false;
    renderChat();
    $("chat-input").focus();
  }
});

$("direct-chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("direct-chat-input");
  const text = input?.value.trim();
  if (!text) return;
  const messages = getPartnerMessages();
  if (remoteCouple) {
    const submit = event.currentTarget.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;
    try {
      const response = await apiFetch("/api/couple/messages", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 2000) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t send that message.");
      input.value = "";
      await refreshRemoteCouple();
    } catch (error) { showToast(error.message); }
    finally { if (submit) submit.disabled = false; }
    return;
  }
  messages.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, senderIndex: activePerson, text: text.slice(0, 2000), createdAt: Date.now() });
  try {
    savePartnerMessages(messages);
    input.value = "";
    renderPartnerChat();
  } catch {
    showToast("Couldn’t save that message in this browser. Try a shorter message.");
  }
});
$("direct-chat-input")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("direct-chat-form")?.requestSubmit();
  }
});

$("add-memory")?.addEventListener("click", () => { $("memory-input").value = ""; openDialog("memory-dialog"); $("memory-input").focus(); });
$("memory-close")?.addEventListener("click", () => closeDialog("memory-dialog"));
$("memory-cancel")?.addEventListener("click", () => closeDialog("memory-dialog"));
$("memory-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const memory = $("memory-input").value.trim();
  if (!memory) return;
  if (remoteCouple) {
    const saveButton = $("memory-form").querySelector('[type="submit"]');
    saveButton.disabled = true;
    try {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await saveRemoteMemory({ kind: "shared_note", title: "", date, body: memory });
      closeDialog("memory-dialog"); renderMemoryPage(); showToast("Shared note saved for both of you.");
    } catch (error) { showToast(error.message); }
    finally { saveButton.disabled = false; }
    return;
  }
  const memories = getMemories();
  memories.push(memory);
  localStorage.setItem("closer-shared-memories", JSON.stringify(memories));
  closeDialog("memory-dialog");
  renderMemoryPage();
  showToast("Shared note saved for both of you.");
});
$("how-it-works")?.addEventListener("click", () => openDialog("info-dialog"));
$("info-close")?.addEventListener("click", () => closeDialog("info-dialog"));
$("info-done")?.addEventListener("click", () => closeDialog("info-dialog"));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const openFallback = document.querySelector("dialog.fallback-open");
  if (openFallback) closeDialog(openFallback.id);
});
window.addEventListener("storage", (event) => {
  if (event.key === "closer-active-person") {
    const nextPerson = Number(event.newValue);
    if ([0, 1].includes(nextPerson)) activePerson = nextPerson;
  }
  renderCommon();
});

function renderCommon() {
  renderCommonBase();
}

async function refreshRemoteCouple() {
  if (!remoteCouple) return;
  const response = await apiFetch("/api/couple", { credentials: "include" });
  if (!response.ok) throw new Error("Couldn’t refresh your shared space.");
  const wasSolo = isSolo();
  remoteCouple = await response.json();
  applyMemberNames();
  if (wasSolo && remoteCouple.partner && $("partner-invite-dialog")) closeDialog("partner-invite-dialog");
  if (!document.hidden) renderCommonBase();
}

async function bootstrapAuthenticatedApp() {
  try {
    const configResponse = await apiFetch("/api/config", { credentials: "include" });
    const config = await configResponse.json();
    appSettings = config;
    if (!config.authRequired) { appLoaded = true; renderCommonBase(); return; }
    const sessionResponse = await apiFetch("/api/auth/get-session", { credentials: "include" });
    const session = await sessionResponse.json().catch(() => null);
    if (!session?.user) { location.replace("login.html"); return; }
    const coupleResponse = await apiFetch("/api/couple", { credentials: "include" });
    if (!coupleResponse.ok) { location.replace("login.html"); return; }
    remoteCouple = await coupleResponse.json();
    if (page === "memories") await refreshRemoteMemories(false);
    activePerson = 0;
    applyMemberNames();
    $("person-switcher")?.remove();
    setupPartnerInvitation();
    setupNickname();
    const previewBanner = document.querySelector(".preview-banner");
    if (previewBanner && page === "memories") {
      const photoCopy = config.photoStorageConfigured ? "Photos are stored privately with your entries." : "Photo storage is not configured yet.";
      previewBanner.innerHTML = `<strong>Your entries sync securely.</strong> Shared memories are visible to both of you; private reflections are saved only to your account. ${photoCopy}`;
      if (!config.photoStorageConfigured) document.querySelectorAll(".photo-label").forEach((element) => { element.hidden = true; });
      const privatePrivacy = document.querySelector(".personal-privacy");
      if (privatePrivacy) privatePrivacy.textContent = "Only your signed-in account can read or delete these reflections. They are stored separately from shared entries and never shown to your partner.";
      const reflectionCopy = document.querySelector(".reflection-box > p");
      if (reflectionCopy) reflectionCopy.textContent = "Ask for a weekly or monthly look back. It’s generated on this device from your account-private entries.";
      const journalCopy = document.querySelector(".memory-intro");
      if (journalCopy) journalCopy.textContent = "Trips, ordinary days, and all the things you want to keep. These entries are shared with both accounts.";
    } else if (previewBanner) {
      const previewCopy = page === "chat"
        ? "Your shared Closr conversation syncs between your accounts. Private Closr notes stay in this browser tab."
        : page === "partner-chat"
          ? "Your direct conversation is synced between both accounts."
          : page === "status"
            ? "Your check-in is saved to your account and shared with your partner."
            : "Your accounts are connected. Status, partner conversations, and memories sync between your accounts.";
      previewBanner.innerHTML = `<strong>Account connected.</strong> ${previewCopy}`;
    }
    const howItWorks = $("info-dialog");
    if (howItWorks) {
      const paragraphs = howItWorks.querySelectorAll("p");
      if (paragraphs[2]) paragraphs[2].textContent = "A gentle ping sends no message. It appears as an in-app note the next time your person opens or refreshes Closr. Push notifications are not connected yet.";
    }
    if (howItWorks && page === "partner-chat") {
      const paragraphs = howItWorks.querySelectorAll("p");
      if (paragraphs[0]) paragraphs[0].textContent = "Messages in this thread are saved to your couple space and appear for both signed-in partners.";
      if (paragraphs[1]) paragraphs[1].textContent = "Status changes and messages refresh between your accounts while Closr is open.";
    }
    const account = document.querySelector(".account-row");
    if (account && !$("account-sign-out")) {
      const signOut = document.createElement("button");
      signOut.id = "account-sign-out";
      signOut.className = "account-menu-action";
      signOut.type = "button";
      signOut.textContent = "Sign out";
      signOut.title = "Sign out";
      signOut.setAttribute("aria-label", "Sign out");
      signOut.addEventListener("click", async () => {
        try {
          const response = await apiFetch("/api/auth/sign-out", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!response.ok) throw new Error("Couldn’t sign out. Please try again.");
          location.replace("login.html");
        } catch (error) { showToast(error.message); }
      });
      ($("account-profile-menu") || account).append(signOut);
    }
    if (account && !$("account-delete-button")) {
      const deleteButton = document.createElement("button");
      deleteButton.id = "account-delete-button";
      deleteButton.className = "account-menu-action account-menu-danger";
      deleteButton.type = "button";
      deleteButton.textContent = "Delete account";
      ($("account-profile-menu") || account).append(deleteButton);
      const dialog = document.createElement("dialog");
      dialog.id = "account-delete-dialog";
      dialog.className = "info-dialog";
      dialog.innerHTML = '<button type="button" class="dialog-close" id="account-delete-close" aria-label="Close">×</button><div class="eyebrow">ACCOUNT CONTROL</div><h2>Delete your account?</h2><p>This permanently deletes your private journal and photos, your account, and shared entries/messages you created. Your partner’s account remains active.</p><form id="account-delete-form"><label>Type <strong>DELETE MY CLOSR ACCOUNT</strong> to continue<input id="account-delete-confirmation" autocomplete="off" required></label><p class="auth-message" id="account-delete-message" role="status" aria-live="polite"></p><div class="memory-dialog-actions"><button type="button" class="cancel-button" id="account-delete-cancel">Cancel</button><button type="submit" class="dialog-done">Permanently delete</button></div></form>';
      document.body.append(dialog);
      deleteButton.addEventListener("click", () => { $("account-delete-confirmation").value = ""; $("account-delete-message").textContent = ""; openDialog(dialog.id); $("account-delete-confirmation").focus(); });
      $("account-delete-close").addEventListener("click", () => closeDialog(dialog.id));
      $("account-delete-cancel").addEventListener("click", () => closeDialog(dialog.id));
      $("account-delete-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        $("account-delete-message").textContent = "Deleting your account and stored photos…";
        try {
          const response = await apiFetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: $("account-delete-confirmation").value }) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Couldn’t delete this account.");
          location.replace("login.html");
        } catch (error) { $("account-delete-message").textContent = error.message; }
        finally { submit.disabled = false; }
      });
    }
    appLoaded = true;
    renderCommonBase();
    if (remoteRefreshTimer) clearInterval(remoteRefreshTimer);
    remoteRefreshTimer = setInterval(() => {
      if (!document.hidden) {
        refreshRemoteCouple().catch(() => {});
        if (page === "memories") refreshRemoteMemories().catch(() => {});
      }
    }, 15_000);
  } catch {
    // Keep the local prototype usable when the optional auth backend is not running.
    if (location.protocol === "https:" || window.Capacitor?.isNativePlatform?.()) {
      const loading = document.querySelector(".app-loading");
      if (loading) loading.textContent = "Couldn’t open your space. Please reload to try again.";
    }
    else { appLoaded = true; renderCommonBase(); }
  }
}

function renderCommonBase() {
  renderAccountMode();
  const me = people[activePerson];
  const partner = people[activePerson === 0 ? 1 : 0];
  setText("switch-name", me.name);
  setText("account-name", me.name);
  $("account-profile-toggle")?.setAttribute("aria-label", `Profile: ${me.name}`);
  setText("profile-nickname-label", me.name);
  $("profile-nickname-label")?.setAttribute("title", me.name);
  setText("switch-avatar", me.initial);
  setText("account-avatar", me.initial);
  setText("top-avatar", me.initial);
  const switchAvatar = $("switch-avatar");
  if (switchAvatar) switchAvatar.className = `avatar avatar-${me.color}`;
  const accountAvatar = $("account-avatar");
  if (accountAvatar) accountAvatar.className = `avatar avatar-${me.color} avatar-small`;
  const topAvatar = $("top-avatar");
  if (topAvatar) topAvatar.className = `avatar avatar-${me.color} avatar-small`;
  setText("today-label", new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()));
  renderHome(partner);
  renderStatusMenu();
  renderStatusPage();
  renderMemoryPage();
  if (page === "chat") { document.querySelectorAll(".chat-tab").forEach((tab) => { const selected = tab.dataset.scope === activeScope; tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected)); }); renderChat(); }
  else if (page === "home" && $("chat-messages")) renderChat();
  if (page === "partner-chat") renderPartnerChat();
  if (appLoaded) document.documentElement.dataset.appReady = "true";
}

function nameInitial(name) {
  const value = name.trim();
  if (!value) return "♡";
  const initial = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)[Symbol.iterator]().next().value.segment
    : Array.from(value)[0];
  return initial.toLocaleUpperCase();
}

function applyMemberNames() {
  people[0].name = remoteCouple.self.name || "You";
  people[0].initial = nameInitial(people[0].name);
  people[1].name = remoteCouple.partner?.name || "Your person";
  people[1].initial = nameInitial(people[1].name);
}

function setupNickname() {
  if ($("nickname-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "nickname-dialog";
  dialog.className = "info-dialog nickname-dialog";
  dialog.setAttribute("aria-labelledby", "nickname-title");
  dialog.innerHTML = '<button type="button" class="dialog-close" id="nickname-close" aria-label="Close nickname settings">×</button><div class="nickname-heart" aria-hidden="true">♡</div><div class="eyebrow">YOUR NICKNAME</div><h2 id="nickname-title">What does your partner call you?</h2><form id="nickname-form"><label class="nickname-label" for="nickname-input">Your name in Closr</label><div class="nickname-input-row"><input id="nickname-input" name="nickname" autocomplete="nickname" autocapitalize="words" spellcheck="false" maxlength="80" placeholder="e.g. Sof or Dhrum" aria-describedby="nickname-hint nickname-error"><span id="nickname-count" aria-hidden="true">0/40</span></div><p id="nickname-hint">Your partner will see this name in Closr.</p><div class="nickname-preview" aria-label="Nickname preview"><span class="avatar avatar-lilac" id="nickname-preview-avatar" aria-hidden="true">♡</span><span><strong id="nickname-preview-name">A little more you</strong><small>A name that feels like home.</small></span><span class="nickname-preview-heart" aria-hidden="true">♡</span></div><p class="nickname-error" id="nickname-error" role="status" aria-live="polite"></p><div class="nickname-actions"><button type="button" class="cancel-button" id="nickname-cancel">Cancel</button><button type="submit" class="connect-button" id="nickname-save">Save nickname</button></div><button type="button" class="nickname-reset" id="nickname-reset" hidden>Use my Google name instead</button></form>';
  document.body.append(dialog);
  const input = $("nickname-input");
  let saving = false;
  function normalizedName() { return input.value.normalize("NFC").trim().replace(/\p{Zs}+/gu, " "); }
  function updatePreview() {
    const name = normalizedName();
    const length = Array.from(name).length;
    const valid = length > 0 && length <= 40 && !/[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(name);
    $("nickname-count").textContent = `${length}/40`;
    $("nickname-preview-name").textContent = name || "A little more you";
    $("nickname-preview-avatar").textContent = name ? nameInitial(name) : "♡";
    $("nickname-error").textContent = name && !valid ? "Keep your nickname to 40 characters, without line breaks." : "";
    input.setAttribute("aria-invalid", String(Boolean(name && !valid)));
    $("nickname-save").disabled = saving || !valid;
  }
  function openNickname() {
    if (saving) return;
    if ($("status-menu")) $("status-menu").hidden = true;
    $("status-menu-toggle")?.setAttribute("aria-expanded", "false");
    if ($("account-profile-menu")) $("account-profile-menu").hidden = true;
    $("account-profile-toggle")?.setAttribute("aria-expanded", "false");
    input.value = remoteCouple.self.nickname || "";
    $("nickname-reset").hidden = !remoteCouple.self.nickname;
    updatePreview();
    openDialog(dialog.id);
    input.focus();
  }
  async function saveNickname(nickname) {
    if (saving) return;
    saving = true;
    dialog.setAttribute("aria-busy", "true");
    ["nickname-close", "nickname-cancel", "nickname-reset", "nickname-save", "nickname-input"].forEach((id) => { $(id).disabled = true; });
    $("nickname-error").textContent = "";
    $("nickname-save").textContent = "Saving…";
    try {
      const response = await apiFetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Couldn’t save your nickname. Please try again.");
      if (!result.profile?.id || typeof result.profile.name !== "string") throw new Error("Couldn’t read your updated profile. Please reload and try again.");
      remoteCouple.self = result.profile;
      applyMemberNames();
      renderCommonBase();
      closeDialog(dialog.id);
      showToast(nickname === null ? "Your Google name is back." : `You’re ${result.profile.name} here. ♡`);
    } catch (error) { $("nickname-error").textContent = error.message || "Couldn’t save your nickname. Please try again."; }
    finally {
      saving = false;
      dialog.removeAttribute("aria-busy");
      ["nickname-close", "nickname-cancel", "nickname-reset", "nickname-input"].forEach((id) => { $(id).disabled = false; });
      $("nickname-save").textContent = "Save nickname";
      $("nickname-save").disabled = !normalizedName() || Array.from(normalizedName()).length > 40;
    }
  }
  input.addEventListener("input", updatePreview);
  $("nickname-form").addEventListener("submit", (event) => { event.preventDefault(); if (!$("nickname-save").disabled) saveNickname(normalizedName()); });
  $("nickname-reset").addEventListener("click", () => saveNickname(null));
  $("nickname-close").addEventListener("click", () => closeDialog(dialog.id));
  $("nickname-cancel").addEventListener("click", () => closeDialog(dialog.id));
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  const profileToggle = $("status-menu-toggle");
  if (profileToggle) {
    const label = document.createElement("span");
    label.id = "profile-nickname-label";
    label.className = "profile-nickname-label";
    profileToggle.prepend(label);
  }
  const menu = $("status-menu");
  if (menu) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "nickname-menu-edit";
    edit.textContent = "Edit nickname";
    edit.addEventListener("click", openNickname);
    menu.querySelector(".status-menu-heading")?.after(edit);
  }
  const account = document.querySelector(".account-row");
  const accountCopy = account?.querySelector("span:nth-child(2)");
  if (accountCopy) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "account-profile-toggle";
    toggle.className = "account-profile-toggle";
    toggle.setAttribute("aria-controls", "account-profile-menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.append(accountCopy.querySelector("strong"));
    accountCopy.replaceWith(toggle);
    account.querySelector(".more-button")?.remove();
    const accountMenu = document.createElement("div");
    accountMenu.id = "account-profile-menu";
    accountMenu.className = "account-profile-menu";
    accountMenu.setAttribute("role", "group");
    accountMenu.setAttribute("aria-label", "Profile options");
    accountMenu.hidden = true;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "account-menu-action";
    edit.textContent = "Edit nickname";
    edit.addEventListener("click", openNickname);
    accountMenu.append(edit);
    account.append(accountMenu);
    toggle.addEventListener("click", () => {
      accountMenu.hidden = !accountMenu.hidden;
      toggle.setAttribute("aria-expanded", String(!accountMenu.hidden));
    });
    document.addEventListener("click", (event) => {
      if (!account.contains(event.target)) { accountMenu.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
    });
    account.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !accountMenu.hidden) { accountMenu.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
    });
  }
}

function setupPartnerInvitation() {
  if ($("partner-invite-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "partner-invite-dialog";
  dialog.className = "info-dialog partner-invite-dialog";
  dialog.setAttribute("aria-labelledby", "partner-invite-title");
  dialog.innerHTML = '<button type="button" class="dialog-close" id="partner-invite-close" aria-label="Close invitation">×</button><div class="eyebrow">WHENEVER YOU’RE READY</div><h2 id="partner-invite-title">Invite your partner</h2><p>Share a private link. They’ll sign in with Google and choose whether to join your space. Your private journal stays yours.</p><button type="button" class="connect-button" id="create-partner-link">Create an invite link</button><div class="partner-link-row" id="partner-link-row" hidden><label class="sr-only" for="partner-link">Partner invite link</label><input id="partner-link" readonly><button type="button" class="connect-button" id="copy-partner-link">Copy link</button></div><p id="partner-invite-message" class="invite-feedback" role="status" aria-live="polite"></p><button type="button" class="invite-later" id="partner-invite-later">I’ll do this later</button>';
  document.body.append(dialog);
  const sidebar = document.querySelector(".side-nav");
  const invite = document.createElement("button");
  invite.type = "button";
  invite.id = "sidebar-invite-partner";
  invite.className = "sidebar-invite";
  invite.dataset.invitePartner = "";
  invite.textContent = "♡ Invite your partner";
  sidebar?.after(invite);
  $("partner-invite-close").addEventListener("click", () => closeDialog(dialog.id));
  $("partner-invite-later").addEventListener("click", () => closeDialog(dialog.id));
  $("create-partner-link").addEventListener("click", async () => {
    const button = $("create-partner-link");
    button.disabled = true;
    setText("partner-invite-message", "Creating your private link…");
    try {
      if (!remoteCouple.couple) {
        const response = await apiFetch("/api/couple", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!response.ok && response.status !== 409) throw new Error("Couldn’t prepare your partner invitation. Please try again.");
        await refreshRemoteCouple();
        if (!remoteCouple.couple) throw new Error("Couldn’t prepare your partner invitation. Please try again.");
      }
      const response = await apiFetch("/api/couple/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t create your invite link.");
      const link = new URL("login.html", location.href);
      link.searchParams.set("invite", data.token);
      $("partner-link").value = link.href;
      $("partner-link-row").hidden = false;
      button.textContent = "Create a new link";
      setText("partner-invite-message", "This link works once and expires in seven days. Creating a new link replaces the previous one. Nothing is sent automatically.");
    } catch (error) { setText("partner-invite-message", error.message); }
    finally { button.disabled = false; }
  });
  $("copy-partner-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("partner-link").value);
      setText("partner-invite-message", "Copied. Share this link privately with your partner.");
    } catch {
      $("partner-link").select();
      setText("partner-invite-message", "Copy the selected link and share it privately with your partner.");
    }
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-invite-partner]") && remoteCouple) openDialog("partner-invite-dialog");
});

function renderAccountMode() {
  if (!remoteCouple) return;
  const solo = isSolo();
  document.body.classList.toggle("solo-mode", solo);
  if ($("solo-welcome")) $("solo-welcome").hidden = !solo;
  const pair = document.querySelector(".status-pair");
  if (pair) pair.hidden = solo;
  if ($("sidebar-invite-partner")) $("sidebar-invite-partner").hidden = !solo;
  if (solo) activeScope = "private";
  document.querySelectorAll(".relationship-pill, .relationship-card").forEach((element) => { element.hidden = solo; });
  document.querySelectorAll("[data-self-status], [data-inline-status], [data-status], #voice-status-button, #inline-custom-toggle").forEach((button) => { button.disabled = solo; });
  const profileToggle = $("status-menu-toggle");
  if (profileToggle) { profileToggle.disabled = false; profileToggle.setAttribute("aria-label", `${people[0].name}: status and nickname`); }
  document.querySelectorAll("#status-menu [data-self-status], #status-menu .status-menu-custom, #status-menu .status-menu-voice, #status-menu > small").forEach((element) => {
    if (!element.classList.contains("status-menu-custom") || solo) element.hidden = solo;
  });
  if ($("shared-tab")) { $("shared-tab").disabled = solo; $("shared-tab").title = solo ? "Connect your partner to start a shared conversation" : ""; }
  document.querySelectorAll("[data-memory-tab]").forEach((tab) => { tab.disabled = solo && tab.dataset.memoryTab !== "personal"; });
  if (solo && page === "memories" && !document.querySelector('[data-memory-tab="personal"].active')) document.querySelector('[data-memory-tab="personal"]')?.click();
  if ($("direct-chat-form")) $("direct-chat-form").hidden = solo;
  const directFootnote = document.querySelector(".direct-chat-footnote");
  if (directFootnote) directFootnote.hidden = solo;
  const directNotice = document.querySelector(".direct-chat-notice");
  if (directNotice) directNotice.hidden = solo;
  const privacy = document.querySelector(".privacy-card p");
  if (privacy) privacy.textContent = solo ? "Your journal stays private. Connect a partner whenever you’re ready." : "Share check-ins and moments with your person. Your private journal stays yours.";
  const privacyHeading = document.querySelector(".privacy-card strong");
  if (privacyHeading) privacyHeading.textContent = solo ? "Your private space" : "Just between you";
  const memoryNav = document.querySelector('.side-nav a[href="memories.html"]');
  if (memoryNav) memoryNav.innerHTML = `<span class="nav-icon">♡</span> ${solo ? "My journal" : "Our memories"}`;
  if (page === "home") {
    const heading = document.querySelector(".welcome-row h1");
    if (heading) heading.innerHTML = `${solo ? "Your space" : "Your two-person space"}<span class="wave">✳</span>`;
    const subtitle = document.querySelector(".welcome-subtitle");
    if (subtitle) subtitle.textContent = solo ? "A little room for you, at your own pace." : `A quick, gentle check-in with ${people[1].name}.`;
    const story = document.querySelector(".story-card");
    if (story) {
      story.querySelector(".eyebrow").textContent = solo ? "JUST FOR YOU" : "THE TWO OF YOU";
      story.querySelector("h2").textContent = solo ? "Your private journal" : "Our story";
      story.querySelector("p").textContent = solo ? "Your days, your feelings, and a little space to reflect. Only you can read these entries." : "Little moments, big days, and everything that makes your story yours.";
      story.querySelector("a").innerHTML = `${solo ? "Open my journal" : "Open our memories"} <span>↗</span>`;
    }
  }
  if (page === "memories") {
    document.title = solo ? "My private journal — closr" : "Our memories — closr";
    const breadcrumb = document.querySelector(".breadcrumb strong");
    if (breadcrumb) breadcrumb.textContent = solo ? "My journal" : "Our memories";
    const eyebrow = document.querySelector(".welcome-row .eyebrow");
    if (eyebrow) eyebrow.textContent = solo ? "YOUR THOUGHTS, YOUR SPACE" : "YOUR STORY, TOGETHER";
    const heading = document.querySelector(".welcome-row h1");
    if (heading) heading.textContent = solo ? "My private journal" : "Memories & journal";
    const subtitle = document.querySelector(".welcome-subtitle");
    if (subtitle) subtitle.textContent = solo ? "Your days and feelings, kept just for you." : "Important dates, shared stories, and a journal that’s just for you.";
  }
  const banner = document.querySelector(".preview-banner");
  if (banner) banner.hidden = page === "home";
  if (banner && solo) {
    banner.textContent = page === "memories"
      ? "Your reflections are saved privately to your account. Shared dates and memories open when you connect a partner."
      : "You’re signed in. Explore your space and keep a private journal. Connecting a partner is optional.";
  } else if (banner) {
    banner.textContent = page === "memories" ? "Shared memories are visible to both of you. Private reflections are saved only to your account." : page === "chat" ? "Your shared conversations sync between accounts. Private Closr chat stays in this browser tab." : "Your shared space is connected. Check-ins, messages, and memories sync between your accounts.";
  }
  const info = $("info-dialog");
  if (info && solo) {
    const paragraphs = info.querySelectorAll("p");
    if (paragraphs[0]) paragraphs[0].textContent = "Explore Closr on your own and keep a journal that only your account can read.";
    if (paragraphs[1]) paragraphs[1].textContent = "Invite a partner whenever you’re ready. After they accept, you can share check-ins, messages, and memories together.";
    if (paragraphs[2]) paragraphs[2].textContent = "Inviting someone never shares your private journal or private Closr chat.";
  }
}

setupMemoryTabs();
setupMemoryEntryForms();
bootstrapAuthenticatedApp();
