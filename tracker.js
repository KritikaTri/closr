const $ = (id) => document.getElementById(id);
const STORE = "daybook-wellness-v1";
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
let selectedDate = todayISO();
let data = readStore();
let toastTimer;

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) || "{}");
    if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object") {
      if (!Array.isArray(parsed.schedule)) parsed.schedule = [];
      return parsed;
    }
  } catch { /* recover from invalid local browser data */ }
  return { days: {}, schedule: [], manifest: "", inspiration: "" };
}
function save() { localStorage.setItem(STORE, JSON.stringify(data)); }
function dayRecord(date = selectedDate) {
  if (!data.days[date]) data.days[date] = { meals: [], water: 0, exercises: [], rest: false };
  const day = data.days[date];
  if (!Array.isArray(day.meals)) day.meals = [];
  if (!Array.isArray(day.exercises)) day.exercises = [];
  return day;
}
function showToast(message) {
  const toast = $("toast"); toast.textContent = message; toast.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function humanDate(date) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function resizeImage(file, maxEdge = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("This image could not be opened."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const foods = [
  [["dal", "lentil", "sambar"], { calories: 190, protein: 10, carbs: 27, fat: 5, label: "1 bowl" }],
  [["rice", "chawal", "biryani"], { calories: 240, protein: 5, carbs: 48, fat: 4, label: "1 bowl" }],
  [["roti", "chapati", "phulka", "paratha"], { calories: 170, protein: 5, carbs: 29, fat: 4, label: "2 pieces" }],
  [["paneer", "cottage cheese"], { calories: 330, protein: 19, carbs: 14, fat: 23, label: "1 serving" }],
  [["chicken"], { calories: 280, protein: 30, carbs: 7, fat: 14, label: "1 serving" }],
  [["egg", "omelette", "omelet"], { calories: 180, protein: 13, carbs: 2, fat: 13, label: "2 eggs" }],
  [["dosa"], { calories: 220, protein: 5, carbs: 34, fat: 7, label: "1 medium" }],
  [["idli"], { calories: 150, protein: 5, carbs: 30, fat: 1, label: "2 pieces" }],
  [["poha"], { calories: 260, protein: 6, carbs: 43, fat: 8, label: "1 bowl" }],
  [["upma"], { calories: 280, protein: 7, carbs: 44, fat: 9, label: "1 bowl" }],
  [["salad"], { calories: 160, protein: 5, carbs: 18, fat: 8, label: "1 bowl" }],
  [["curd", "yogurt", "dahi"], { calories: 120, protein: 7, carbs: 9, fat: 6, label: "1 bowl" }],
  [["banana"], { calories: 105, protein: 1, carbs: 27, fat: 0, label: "1 medium" }],
  [["oats", "porridge"], { calories: 250, protein: 9, carbs: 42, fat: 6, label: "1 bowl" }],
  [["sandwich"], { calories: 320, protein: 12, carbs: 40, fat: 12, label: "1 sandwich" }],
  [["burger"], { calories: 480, protein: 20, carbs: 48, fat: 24, label: "1 burger" }],
  [["pizza"], { calories: 285, protein: 12, carbs: 36, fat: 10, label: "1 slice" }],
  [["samosa"], { calories: 260, protein: 5, carbs: 30, fat: 14, label: "1 piece" }],
  [["milk"], { calories: 150, protein: 8, carbs: 12, fat: 8, label: "1 glass" }],
  [["protein shake", "smoothie"], { calories: 230, protein: 20, carbs: 25, fat: 6, label: "1 glass" }],
];
function estimateFood(name, portions = 1) {
  const normalized = name.toLowerCase();
  const found = foods.find(([keywords]) => keywords.some((word) => normalized.includes(word)));
  const base = found?.[1] || { calories: 300, protein: 12, carbs: 38, fat: 11, label: "1 typical serving" };
  return { calories: Math.round(base.calories * portions), protein: Math.round(base.protein * portions), carbs: Math.round(base.carbs * portions), fat: Math.round(base.fat * portions), label: base.label, generic: !found };
}
const timeMinutes = (time) => { const [hours, minutes] = String(time).split(":").map(Number); return hours * 60 + minutes; };
const timeLabel = (time) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time}:00`));
function scheduleMealLogged(slot, day = dayRecord()) { return day.meals.some((meal) => String(meal.type).toLowerCase() === String(slot.mealType).toLowerCase()); }
function getScheduleContext() {
  const slots = [...(data.schedule || [])].sort((a, b) => timeMinutes(a.start) - timeMinutes(b.start));
  const nowDate = todayISO();
  const minuteNow = selectedDate === nowDate ? new Date().getHours() * 60 + new Date().getMinutes() : selectedDate < nowDate ? 1440 : 0;
  const active = slots.find((slot) => timeMinutes(slot.start) <= minuteNow && minuteNow < timeMinutes(slot.end));
  const upcoming = slots.find((slot) => timeMinutes(slot.start) > minuteNow);
  const missed = slots.filter((slot) => slot.kind === "meal" && timeMinutes(slot.end) <= minuteNow && !scheduleMealLogged(slot)).at(-1);
  return { slots, minuteNow, active, upcoming, missed };
}
function slotTitle(slot) { return slot.kind === "meal" ? `${slot.mealType} time` : slot.title; }
function slotSubline(slot) { return slot.kind === "meal" ? (slot.dish ? `Planned: ${slot.dish}` : "A meal in your day") : (slot.note || "Planned time for yourself"); }
function renderSchedulePrompt() {
  const target = $("meal-schedule-prompt");
  delete target.dataset.mealType; delete target.dataset.dish;
  const { slots, active, upcoming, missed } = getScheduleContext();
  if (!slots.length) {
    target.innerHTML = '<div class="schedule-prompt-empty"><span>◷</span><div><b>Make the day feel a little easier</b><small>Add meal times to see what’s planned here. No hourly check-ins needed.</small></div><button type="button" data-open-schedule>Set up</button></div>';
  } else if (active) {
    const logged = active.kind === "meal" && scheduleMealLogged(active);
    const ending = `${timeLabel(active.start)}–${timeLabel(active.end)}`;
    target.innerHTML = `<div class="schedule-prompt-card is-current"><div class="prompt-icon">${active.kind === "meal" ? "◉" : "◷"}</div><div class="prompt-content"><span class="prompt-state">${logged ? "CHECKED IN" : "NOW · " + ending}</span><b>${escapeHTML(slotTitle(active))}${logged ? " · logged" : ""}</b><small>${escapeHTML(slotSubline(active))}</small>${missed && active.kind !== "meal" ? `<em>${escapeHTML(slotTitle(missed))} window ended at ${timeLabel(missed.end)} · no meal logged yet.</em>` : ""}${upcoming ? `<em>Next: ${escapeHTML(slotTitle(upcoming))} at ${timeLabel(upcoming.start)}${upcoming.kind === "meal" && upcoming.dish ? ` · ${escapeHTML(upcoming.dish)}` : ""}</em>` : ""}</div>${active.kind === "meal" && !logged ? '<button type="button" data-log-scheduled-meal>Log meal</button>' : ""}</div>`;
    if (active.kind === "meal") { target.dataset.mealType = active.mealType; target.dataset.dish = active.dish || ""; }
  } else if (missed) {
    target.innerHTML = `<div class="schedule-prompt-card is-gentle"><div class="prompt-icon">◷</div><div class="prompt-content"><span class="prompt-state">A GENTLE LOOK AHEAD</span><b>${escapeHTML(slotTitle(missed))} window ended at ${timeLabel(missed.end)}</b><small>Nothing is logged for this meal slot yet. You can still add it if you ate.</small>${upcoming ? `<em>Next up: ${escapeHTML(slotTitle(upcoming))} at ${timeLabel(upcoming.start)}${upcoming.kind === "meal" && upcoming.dish ? ` · ${escapeHTML(upcoming.dish)}` : ""}</em>` : ""}</div><button type="button" data-log-scheduled-meal>Log meal</button></div>`;
    target.dataset.mealType = missed.mealType;
    target.dataset.dish = missed.dish || "";
  } else if (upcoming) {
    target.innerHTML = `<div class="schedule-prompt-card"><div class="prompt-icon">◷</div><div class="prompt-content"><span class="prompt-state">COMING UP · ${timeLabel(upcoming.start)}</span><b>${escapeHTML(slotTitle(upcoming))}</b><small>${escapeHTML(slotSubline(upcoming))}</small></div></div>`;
  } else {
    const done = slots.filter((slot) => slot.kind !== "meal" || scheduleMealLogged(slot)).length;
    target.innerHTML = `<div class="schedule-prompt-card"><div class="prompt-icon">♡</div><div class="prompt-content"><span class="prompt-state">YOUR DAY AT A GLANCE</span><b>${done === slots.length ? "All set for today" : "That’s your schedule for now"}</b><small>You can update a meal log or change your plan whenever you like.</small></div></div>`;
  }
  const button = target.querySelector("[data-log-scheduled-meal]");
  if (button) button.addEventListener("click", () => openMealDialog(target.dataset.mealType || active?.mealType || missed?.mealType, target.dataset.dish || active?.dish || missed?.dish || ""));
  target.querySelector("[data-open-schedule]")?.addEventListener("click", () => navigateTo("schedule"));
}
function renderSchedule() {
  const { slots, minuteNow, active, upcoming } = getScheduleContext();
  $("schedule-count").textContent = slots.length ? `${slots.length} planned ${slots.length === 1 ? "slot" : "slots"} · repeats daily` : "No slots yet. Add a few that matter to you.";
  const target = $("schedule-list");
  if (!slots.length) target.innerHTML = '<div class="schedule-empty"><span>◷</span><b>Your day has room to take shape.</b><p>Add meal windows or a few flexible plans. You don’t need to schedule every hour.</p></div>';
  else target.innerHTML = slots.map((slot) => {
    const isCurrent = active?.id === slot.id;
    const isNext = !active && upcoming?.id === slot.id;
    const logged = slot.kind === "meal" && scheduleMealLogged(slot);
    const state = isCurrent ? "Now" : isNext ? "Up next" : minuteNow >= timeMinutes(slot.end) ? (logged ? "Logged" : "Passed") : "Planned";
    return `<article class="schedule-slot ${isCurrent ? "is-current" : ""}"><div class="slot-time"><b>${timeLabel(slot.start)}</b><span>${timeLabel(slot.end)}</span></div><div class="slot-mark ${slot.kind === "meal" ? "meal-mark" : "plan-mark"}">${slot.kind === "meal" ? "◉" : "✳"}</div><div class="slot-copy"><span>${escapeHTML(slot.kind === "meal" ? slot.mealType : "PLAN")} · ${state.toUpperCase()}</span><b>${escapeHTML(slotTitle(slot))}</b><small>${escapeHTML(slotSubline(slot))}</small></div><button type="button" data-delete-slot="${slot.id}" aria-label="Remove ${escapeHTML(slotTitle(slot))} from schedule">×</button></article>`;
  }).join("");
  target.querySelectorAll("[data-delete-slot]").forEach((button) => button.addEventListener("click", () => { data.schedule = data.schedule.filter((slot) => String(slot.id) !== button.dataset.deleteSlot); save(); renderDay(); }));
}
function renderMeals() {
  const day = dayRecord();
  const list = $("meal-list");
  if (!day.meals.length) list.innerHTML = '<div class="meal-empty">No meals added yet. Add something when you like.</div>';
  else list.innerHTML = day.meals.map((meal) => `<article class="meal-row"><div class="meal-thumb">${meal.photo ? `<img src="${meal.photo}" alt="Photo of ${escapeHTML(meal.name)}" />` : "◌"}</div><div class="meal-info"><small>${escapeHTML(meal.type)} · ${Number(meal.portions)} portion${Number(meal.portions) === 1 ? "" : "s"}</small><strong>${escapeHTML(meal.name)}</strong><span>${meal.calories} kcal est. · ${meal.protein}g protein · ${meal.carbs}g carbs · ${meal.fat}g fat</span></div><div class="meal-nutrition"><b>${meal.calories} kcal</b><span>approx.</span></div><button class="meal-delete" data-delete-meal="${meal.id}" aria-label="Remove ${escapeHTML(meal.name)}">×</button></article>`).join("");
  const total = day.meals.reduce((out, meal) => ({ calories: out.calories + meal.calories, protein: out.protein + meal.protein, carbs: out.carbs + meal.carbs, fat: out.fat + meal.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  $("total-calories").textContent = total.calories; $("total-protein").textContent = total.protein; $("total-carbs").textContent = total.carbs; $("total-fat").textContent = total.fat;
  list.querySelectorAll("[data-delete-meal]").forEach((button) => button.addEventListener("click", () => { day.meals = day.meals.filter((meal) => String(meal.id) !== button.dataset.deleteMeal); save(); renderMeals(); renderSchedule(); renderSchedulePrompt(); }));
}
function renderCheckin() {
  const day = dayRecord();
  $("weight-input").value = day.weight ?? "";
  $("weight-history").textContent = day.weight ? `Recorded for ${humanDate(selectedDate)} · ${day.weight} kg` : "No weight recorded for this day.";
  $("water-total").textContent = `${day.water || 0} ml`;
  $("water-progress").style.width = `${Math.min(100, (day.water || 0) / 20)}%`;
  const photo = $("daily-photo-preview");
  photo.classList.toggle("visible", Boolean(day.fullPhoto));
  photo.innerHTML = day.fullPhoto ? `<img src="${day.fullPhoto}" alt="Your optional daily photo" />` : "";
  $("movement-today-summary").textContent = day.rest ? "Rest day noted. Taking a break is part of looking after yourself." : day.exercises.length ? `${day.exercises.length} ${day.exercises.length === 1 ? "activity" : "activities"} logged today.` : "No movement logged yet. Rest days count too.";
}
function renderExercises() {
  const day = dayRecord();
  $("movement-date-chip").textContent = humanDate(selectedDate);
  const list = $("exercise-list");
  const restNote = day.rest ? '<p class="rest-note">Rest day noted. Recovery is part of movement, too. 🌿</p>' : "";
  if (!day.exercises.length && !day.rest) list.innerHTML = '<div class="exercise-empty">No activities for this day yet. You can add one or mark a rest day.</div>';
  else list.innerHTML = restNote + day.exercises.map((exercise) => `<div class="exercise-row"><div><strong>${escapeHTML(exercise.name)}</strong><small>${Number(exercise.amount)} ${escapeHTML(exercise.unit)}${exercise.note ? ` · ${escapeHTML(exercise.note)}` : ""}</small></div><b>${exercise.amount} ${escapeHTML(exercise.unit)}</b><button data-delete-exercise="${exercise.id}" aria-label="Remove ${escapeHTML(exercise.name)}">×</button></div>`).join("");
  const bests = {};
  Object.entries(data.days).forEach(([date, record]) => {
    if (date > selectedDate) return;
    (record.exercises || []).forEach((item) => {
      const key = `${item.name.trim().toLowerCase()}|${item.unit}`;
      if (!bests[key] || Number(item.amount) > bests[key].amount) bests[key] = { name: item.name, unit: item.unit, amount: Number(item.amount), date };
    });
  });
  const entries = Object.values(bests);
  $("personal-bests").innerHTML = entries.length ? entries.map((item) => `<div class="best-line"><span>${escapeHTML(item.name)}</span><b>${item.amount} ${escapeHTML(item.unit)} · ${humanDate(item.date)}</b></div>`).join("") : "Add an activity to start your history.";
  list.querySelectorAll("[data-delete-exercise]").forEach((button) => button.addEventListener("click", () => { day.exercises = day.exercises.filter((item) => String(item.id) !== button.dataset.deleteExercise); save(); renderExercises(); renderCheckin(); }));
}
function renderGallery() {
  const photos = Object.entries(data.days).flatMap(([date, day]) => [
    ...(day.fullPhoto ? [{ date, photo: day.fullPhoto, label: "Daily photo" }] : []),
    ...(day.sidePhoto ? [{ date, photo: day.sidePhoto, label: "Side-profile photo" }] : []),
  ]).sort((a, b) => b.date.localeCompare(a.date));
  $("photo-gallery").innerHTML = photos.length ? photos.map((item) => `<article class="gallery-card"><img src="${item.photo}" alt="${item.label} from ${humanDate(item.date)}" /><div><b>${humanDate(item.date)}</b><small>${item.label} · stored locally</small></div></article>`).join("") : '<div class="gallery-empty">Your optional daily photos will appear here. No photos are required.</div>';
  const side = dayRecord().sidePhoto;
  $("side-photo-preview").innerHTML = side ? `<img src="${side}" alt="Optional side-profile photo for ${humanDate(selectedDate)}" />` : "";
}
function renderDay() {
  $("log-date").value = selectedDate;
  $("day-number").textContent = new Date(`${selectedDate}T12:00:00`).getDate();
  renderMeals(); renderCheckin(); renderExercises(); renderGallery(); renderSchedule(); renderSchedulePrompt();
}
function navigateTo(section) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${section}`));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("selected", button.dataset.section === section));
  const label = { today: "Daily log", schedule: "Schedule", movement: "Movement", profile: "Photo journal", skin: "Skin" }[section] || "Daily log";
  $("crumb-section").textContent = label;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function refreshEstimate() {
  const name = $("meal-name").value.trim();
  const portions = Math.max(.25, Number($("meal-portion").value) || 1);
  if (!name) { $("estimate-preview").textContent = "Enter a dish to see a rough estimate."; return; }
  const estimate = estimateFood(name, portions);
  $("estimate-preview").textContent = `Approx. ${estimate.calories} kcal · ${estimate.protein}g protein · ${estimate.carbs}g carbs · ${estimate.fat}g fat${estimate.generic ? " · broad estimate for an unlisted dish" : ` · based on ${estimate.label}`}.`;
  if (!$("meal-calories").dataset.edited) $("meal-calories").value = estimate.calories;
  if (!$("meal-protein").dataset.edited) $("meal-protein").value = estimate.protein;
}

document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.section)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.go)));
$("log-date").addEventListener("change", () => { if ($("log-date").value) { selectedDate = $("log-date").value; renderDay(); } });
$("prev-day").addEventListener("click", () => { const d = new Date(`${selectedDate}T12:00:00`); d.setDate(d.getDate() - 1); selectedDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; renderDay(); });
$("next-day").addEventListener("click", () => { const d = new Date(`${selectedDate}T12:00:00`); d.setDate(d.getDate() + 1); selectedDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; renderDay(); });
$("today-button").addEventListener("click", () => { selectedDate = todayISO(); renderDay(); });
$("weight-form").addEventListener("submit", (event) => { event.preventDefault(); const raw = $("weight-input").value; if (raw && Number(raw) > 0) dayRecord().weight = Number(raw); else delete dayRecord().weight; save(); renderCheckin(); showToast("Morning check-in saved."); });
document.querySelectorAll("[data-water]").forEach((button) => button.addEventListener("click", () => { dayRecord().water = (dayRecord().water || 0) + Number(button.dataset.water); save(); renderCheckin(); }));
$("water-custom-add").addEventListener("click", () => { const amount = Number($("water-custom").value); if (!(amount > 0)) return; dayRecord().water = (dayRecord().water || 0) + amount; $("water-custom").value = ""; save(); renderCheckin(); });

const mealDialog = $("meal-dialog");
function openMealDialog(mealType = "Snack", dish = "") {
  $("meal-form").reset(); $("meal-portion").value = 1; $("meal-type").value = mealType || "Snack"; $("meal-name").value = dish || ""; $("meal-photo-preview").innerHTML = "";
  delete $("meal-calories").dataset.edited; delete $("meal-protein").dataset.edited; refreshEstimate(); mealDialog.showModal();
}
$("add-meal").addEventListener("click", () => openMealDialog());
$("meal-close").addEventListener("click", () => mealDialog.close());
$("meal-name").addEventListener("input", refreshEstimate); $("meal-portion").addEventListener("input", refreshEstimate);
["meal-calories", "meal-protein"].forEach((id) => $(id).addEventListener("input", () => { $(id).dataset.edited = "1"; }));
$("meal-photo").addEventListener("change", async () => { const file = $("meal-photo").files[0]; if (!file) return; try { const image = await resizeImage(file, 720); $("meal-photo-preview").innerHTML = `<img src="${image}" alt="Meal photo preview" />`; } catch (error) { showToast(error.message); } });
$("meal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("meal-name").value.trim(); if (!name) return;
  const portions = Math.max(.25, Number($("meal-portion").value) || 1); const base = estimateFood(name, portions);
  let photo = ""; const file = $("meal-photo").files[0];
  try { if (file) photo = await resizeImage(file, 720); } catch (error) { showToast(error.message); return; }
  const calories = Math.max(0, Number($("meal-calories").value) || base.calories);
  const protein = Math.max(0, Number($("meal-protein").value) || base.protein);
  const macroScale = calories / Math.max(1, base.calories);
  dayRecord().meals.push({ id: Date.now(), name, type: $("meal-type").value, portions, calories, protein, carbs: Math.round(base.carbs * macroScale), fat: Math.round(base.fat * macroScale), photo });
  save(); mealDialog.close(); renderMeals(); renderSchedule(); renderSchedulePrompt(); showToast("Meal added with an approximate estimate.");
});

$("daily-photo").addEventListener("change", async () => {
  const file = $("daily-photo").files[0]; if (!file) return;
  try { dayRecord().fullPhoto = await resizeImage(file); save(); renderCheckin(); renderGallery(); showToast("Optional photo saved on this device."); }
  catch (error) { showToast(error.message); }
  $("daily-photo").value = "";
});
$("side-photo").addEventListener("change", async () => {
  const file = $("side-photo").files[0]; if (!file) return;
  try { dayRecord().sidePhoto = await resizeImage(file); save(); renderGallery(); showToast("Optional photo saved on this device."); }
  catch (error) { showToast(error.message); }
  $("side-photo").value = "";
});
$("manifest-photo").addEventListener("change", async () => {
  const file = $("manifest-photo").files[0]; if (!file) return;
  try { data.manifest = await resizeImage(file); save(); $("manifest-image").innerHTML = `<img src="${data.manifest}" alt="Your inspiration image" />`; }
  catch (error) { showToast(error.message); }
});
$("profile-inspo").addEventListener("change", async () => {
  const file = $("profile-inspo").files[0]; if (!file) return;
  try { data.inspiration = await resizeImage(file); save(); $("profile-inspo-preview").innerHTML = `<img src="${data.inspiration}" alt="Your personal inspiration image" />`; }
  catch (error) { showToast(error.message); }
});

$("exercise-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("exercise-name").value.trim(); const amount = Number($("exercise-reps").value);
  if (!name || !Number.isFinite(amount) || amount < 0) return;
  const day = dayRecord(); day.rest = false;
  day.exercises.push({ id: Date.now(), name, amount, unit: $("exercise-unit").value, note: $("exercise-note").value.trim() });
  save(); $("exercise-form").reset(); renderExercises(); renderCheckin(); showToast("Activity saved.");
});
$("rest-day").addEventListener("click", () => { dayRecord().rest = true; save(); renderExercises(); renderCheckin(); showToast("Rest day noted."); });

$("schedule-kind").addEventListener("change", () => {
  const isMeal = $("schedule-kind").value === "meal";
  $("schedule-meal-fields").hidden = !isMeal; $("schedule-plan-fields").hidden = isMeal;
});
$("schedule-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const start = $("schedule-start").value; const end = $("schedule-end").value;
  if (!start || !end || timeMinutes(end) <= timeMinutes(start)) { showToast("Choose an end time after the start time."); return; }
  if ((data.schedule || []).some((slot) => timeMinutes(start) < timeMinutes(slot.end) && timeMinutes(end) > timeMinutes(slot.start))) { showToast("That time overlaps another slot. Adjust one of the times."); return; }
  const kind = $("schedule-kind").value;
  const slot = { id: Date.now(), kind, start, end };
  if (kind === "meal") { slot.mealType = $("schedule-meal-type").value; slot.dish = $("schedule-dish").value.trim(); }
  else { slot.title = $("schedule-title").value.trim(); if (!slot.title) { $("schedule-title").focus(); return; } }
  data.schedule.push(slot); save(); $("schedule-form").reset(); $("schedule-start").value = "07:00"; $("schedule-end").value = "10:00"; $("schedule-meal-fields").hidden = false; $("schedule-plan-fields").hidden = true;
  renderDay(); showToast("Added to your daily schedule.");
});
$("schedule-clear").addEventListener("click", () => {
  if (!data.schedule.length) return;
  if (!window.confirm("Clear all of your repeating daily schedule slots?")) return;
  data.schedule = []; save(); renderDay();
});

if (data.manifest) $("manifest-image").innerHTML = `<img src="${data.manifest}" alt="Your inspiration image" />`;
if (data.inspiration) $("profile-inspo-preview").innerHTML = `<img src="${data.inspiration}" alt="Your personal inspiration image" />`;
renderDay();
window.setInterval(() => { renderSchedule(); renderSchedulePrompt(); }, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderSchedule(); renderSchedulePrompt(); } });
