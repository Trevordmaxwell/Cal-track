import {
  addEntry,
  deleteEntry,
  getRecentEntries,
  getEntriesByDay,
  getEntriesBetweenDays,
  getAllEntries,
  getAllSettings,
  putSetting,
  getSetting,
  wipeAll
} from "./db.js";

import {
  dayStringFromTs,
  prettyDate,
  prettyTime,
  minutesAgoLabel,
  uid,
  safeNum,
  round1,
  downloadText,
  downloadBlob,
  copyToClipboard
} from "./utils.js";

import { drawSparkline } from "./charts.js";

/** -----------------------------
 *  Defaults + quick actions
 *  ----------------------------- */

const DEFAULT_GOALS = {
  calories: 1800,
  protein: 110,
  fiber: 25,
  water: 2000,
  exercise: 30,
  weightUnit: "lb"
};

// Inspired by common tracker patterns: quick add, favorites, photo log, water, macros. citeturn0search0turn0search4turn0search10turn0search15
const DEFAULT_QUICK_ACTIONS = [
  { id:"bf", emoji:"🍳", label:"Breakfast\n+300", type:"food", payload:{ name:"Breakfast (quick)", calories:300 }, theme:1 },
  { id:"ln", emoji:"🥗", label:"Lunch\n+500", type:"food", payload:{ name:"Lunch (quick)", calories:500 }, theme:1 },
  { id:"dn", emoji:"🍲", label:"Dinner\n+600", type:"food", payload:{ name:"Dinner (quick)", calories:600 }, theme:1 },
  { id:"sn", emoji:"🍎", label:"Snack\n+150", type:"food", payload:{ name:"Snack (quick)", calories:150 }, theme:4 },

  { id:"w1", emoji:"💧", label:"Water\n+250ml", type:"food", payload:{ name:"Water", calories:0, water_ml:250 }, theme:2 },
  { id:"cof", emoji:"☕️", label:"Coffee\n+20", type:"food", payload:{ name:"Coffee", calories:20 }, theme:2 },
  { id:"pro", emoji:"🥤", label:"Protein\n+25g", type:"food", payload:{ name:"Protein shake (quick)", calories:160, protein_g:25 }, theme:3 },
  { id:"fib", emoji:"🌾", label:"Fiber\n+5g", type:"food", payload:{ name:"Fiber boost", calories:0, fiber_g:5 }, theme:3 },

  { id:"wk", emoji:"🚶", label:"Walk\n20m", type:"exercise", payload:{ name:"Walk", intensity:"moderate", duration_min:20, calories_burned:80 }, theme:2 },
  { id:"st", emoji:"🏋️", label:"Strength\n30m", type:"exercise", payload:{ name:"Strength", intensity:"vigorous", duration_min:30, calories_burned:180 }, theme:4 },
  { id:"yo", emoji:"🧘", label:"Yoga\n20m", type:"exercise", payload:{ name:"Yoga", intensity:"light", duration_min:20, calories_burned:60 }, theme:3 },
  { id:"cam", emoji:"📸", label:"Photo\nLog", type:"open", payload:{ targetType:"photo" }, theme:1 },
];

const DEFAULT_PILL_CATALOG = [
  "Morning pill",
  "Evening pill"
];

const DEFAULT_CONTACTS_TRACKER = {
  pairDurationDays: 14,
  activePairStartTs: null,
};

const PRAISE = {
  food: [
    "Logged. Small check-ins add up.",
    "Nice. Awareness beats perfection.",
    "Saved. Future-you will thank you.",
    "Good job showing up for the habit."
  ],
  water: [
    "Hydration win.",
    "A sip counts. Logged.",
    "Nice. Water helps everything."
  ],
  exercise: [
    "Movement logged. Proud of you.",
    "Nice work. Consistency > intensity.",
    "Logged. Your body likes being used."
  ],
  note: [
    "Saved. Brain dump complete.",
    "Logged. That’s enough for now.",
    "Nice. Keep it simple."
  ],
  weight: [
    "Recorded. Data is neutral.",
    "Logged. Thank you for checking in.",
    "Saved. One step at a time."
  ],
  photo: [
    "Saved. You can label it later.",
    "Photo stored for later.",
    "Nice. Capture now, refine later."
  ]
};

const state = {
  view: "today",
  recentLimit: 10,
  timeOffsetMin: 0,
  goals: { ...DEFAULT_GOALS },
  quickActions: [...DEFAULT_QUICK_ACTIONS],
  pillCatalog: [...DEFAULT_PILL_CATALOG],
  pillTakenByDay: {},
  todoItems: [],
  contactsTracker: { ...DEFAULT_CONTACTS_TRACKER },
  lastAiPromptSourceNoteIds: [],
};

/** -----------------------------
 *  DOM helpers
 *  ----------------------------- */

const $ = (sel) => document.querySelector(sel);

function setText(id, text){
  const el = $(id);
  if(el) el.textContent = text;
}

function htmlEscape(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function showToast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>t.classList.remove("is-on"), 2200);
}

/** -----------------------------
 *  Date windows
 *  ----------------------------- */

function todayDay(){
  return dayStringFromTs(Date.now());
}

function normalizeContactsTracker(raw){
  const duration = Math.round(safeNum(raw?.pairDurationDays));
  const pairDurationDays = duration >= 1 && duration <= 365
    ? duration
    : DEFAULT_CONTACTS_TRACKER.pairDurationDays;

  const startTs = Number(raw?.activePairStartTs);
  const activePairStartTs = Number.isFinite(startTs) && startTs > 0
    ? Math.round(startTs)
    : null;

  return { pairDurationDays, activePairStartTs };
}

function contactsTimerSnapshot(){
  const dayMs = 24 * 60 * 60 * 1000;
  const duration = state.contactsTracker.pairDurationDays;
  const startTs = state.contactsTracker.activePairStartTs;

  if(!startTs){
    return {
      status: "No active pair",
      meta: `Pair length: ${duration} days. Tap Start new pair when you open one.`,
    };
  }

  const elapsedDays = Math.max(0, Math.floor((Date.now() - startTs) / dayMs));
  const daysLeft = duration - elapsedDays;
  const startedLabel = prettyDate(dayStringFromTs(startTs));
  const replaceLabel = prettyDate(dayStringFromTs(startTs + (duration * dayMs)));

  let status = "";
  if(daysLeft > 1) status = `${daysLeft} days left`;
  else if(daysLeft === 1) status = "1 day left";
  else if(daysLeft === 0) status = "Last day";
  else if(daysLeft === -1) status = "1 day overdue";
  else status = `${Math.abs(daysLeft)} days overdue`;

  return {
    status,
    meta: `Length ${duration}d • Started ${startedLabel} • Replace ${replaceLabel}`,
  };
}

function lastNDays(n){
  const days = [];
  const now = new Date();
  for(let i=n-1; i>=0; i--){
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(dayStringFromTs(d.getTime()));
  }
  return days;
}

/** -----------------------------
 *  Totals + formatting
 *  ----------------------------- */

function computeTotals(entries){
  const totals = {
    caloriesIn: 0,
    caloriesOut: 0,
    waterMl: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    exerciseMin: 0,
    weight: null,
    lastTs: null,
  };

  const sorted = [...entries].sort((a,b)=>a.ts-b.ts);

  for(const e of sorted){
    totals.lastTs = e.ts;

    if(e.type === "food"){
      totals.caloriesIn += safeNum(e.calories);
      totals.waterMl += safeNum(e.water_ml);
      totals.proteinG += safeNum(e.protein_g);
      totals.carbsG += safeNum(e.carbs_g);
      totals.fatG += safeNum(e.fat_g);
      totals.fiberG += safeNum(e.fiber_g);
    }

    if(e.type === "exercise"){
      totals.caloriesOut += safeNum(e.calories_burned);
      totals.exerciseMin += safeNum(e.duration_min);
    }

    if(e.type === "weight"){
      totals.weight = { value: safeNum(e.value), unit: e.unit || state.goals.weightUnit || "lb", ts: e.ts };
    }
  }

  totals.net = totals.caloriesIn - totals.caloriesOut;
  return totals;
}

function fmtKcal(n){
  const v = Math.round(safeNum(n));
  return `${v}`;
}

function fmtG(n){
  const v = round1(safeNum(n));
  return `${v}`;
}

function fmtMl(n){
  const v = Math.round(safeNum(n));
  return `${v}`;
}

function fmtMin(n){
  const v = Math.round(safeNum(n));
  return `${v}`;
}

function statCard(label, value, sub=""){
  return `
    <div class="stat">
      <div class="stat__label">${htmlEscape(label)}</div>
      <div class="stat__value">${htmlEscape(value)}</div>
      <div class="stat__sub">${htmlEscape(sub)}</div>
    </div>
  `;
}

function pickPraise(kind){
  const arr = PRAISE[kind] || PRAISE.food;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** -----------------------------
 *  Entry formatting
 *  ----------------------------- */

function entryTitle(e){
  if(e.type === "food"){
    const name = e.name || "Food";
    const kcal = safeNum(e.calories) ? `${fmtKcal(e.calories)} kcal` : (safeNum(e.water_ml) ? `${fmtMl(e.water_ml)} ml` : "");
    const bits = [name, kcal].filter(Boolean);
    return bits.join(" • ");
  }
  if(e.type === "exercise"){
    const name = e.name || "Exercise";
    const dur = safeNum(e.duration_min) ? `${fmtMin(e.duration_min)} min` : "";
    const bits = [name, dur].filter(Boolean);
    return bits.join(" • ");
  }
  if(e.type === "note"){
    return "Note";
  }
  if(e.type === "weight"){
    return `Weight • ${round1(e.value)} ${e.unit || state.goals.weightUnit}`;
  }
  if(e.type === "photo"){
    return "Photo log";
  }
  return e.type;
}

function entryDetails(e){
  const parts = [];

  if(e.type === "food"){
    const rows = [];
    if(safeNum(e.calories)) rows.push(`Calories: ${fmtKcal(e.calories)} kcal`);
    if(safeNum(e.protein_g)) rows.push(`Protein: ${fmtG(e.protein_g)} g`);
    if(safeNum(e.carbs_g)) rows.push(`Carbs: ${fmtG(e.carbs_g)} g`);
    if(safeNum(e.fat_g)) rows.push(`Fat: ${fmtG(e.fat_g)} g`);
    if(safeNum(e.fiber_g)) rows.push(`Fiber: ${fmtG(e.fiber_g)} g`);
    if(safeNum(e.water_ml)) rows.push(`Fluids: ${fmtMl(e.water_ml)} ml`);
    if(e.meal) rows.push(`Meal: ${e.meal}`);
    if(e.note) rows.push(`Note: ${e.note}`);
    if(rows.length) parts.push(rows.join(" · "));
  }

  if(e.type === "exercise"){
    const rows = [];
    if(e.intensity) rows.push(`Intensity: ${e.intensity}`);
    if(safeNum(e.duration_min)) rows.push(`Duration: ${fmtMin(e.duration_min)} min`);
    if(safeNum(e.calories_burned)) rows.push(`Estimated burn: ${fmtKcal(e.calories_burned)} kcal`);
    if(e.note) rows.push(`Note: ${e.note}`);
    if(rows.length) parts.push(rows.join(" · "));
  }

  if(e.type === "note"){
    if(e.text) parts.push(e.text);
  }

  if(e.type === "weight"){
    const when = prettyTime(e.ts);
    parts.push(`Recorded at ${when}.`);
  }

  if(e.type === "photo"){
    if(e.caption) parts.push(`Caption: ${e.caption}`);
    if(e.thumbDataUrl){
      parts.push(`<img alt="Photo thumbnail" src="${e.thumbDataUrl}" style="margin-top:10px; width: 100%; border-radius: 16px; border: 1px solid rgba(30,33,44,0.10);" />`);
    }else{
      parts.push("Photo stored (thumbnail unavailable).");
    }
  }

  return parts.join("<br/>");
}

/** -----------------------------
 *  Rendering
 *  ----------------------------- */

async function renderToday(){
  const day = todayDay();
  setText("#todayDateLabel", prettyDate(day));

  const entries = await getEntriesByDay(day);
  const totals = computeTotals(entries);

  // Stats with gentle goal context
  const g = state.goals;
  const lastLabel = totals.lastTs ? prettyTime(totals.lastTs) : "—";
  const kcalSub = g.calories ? `${fmtKcal(totals.caloriesIn)} / ${fmtKcal(g.calories)} kcal` : `${fmtKcal(totals.caloriesIn)} kcal`;
  const proteinSub = g.protein ? `${fmtG(totals.proteinG)} / ${fmtG(g.protein)} g` : `${fmtG(totals.proteinG)} g`;
  const fiberSub = g.fiber ? `${fmtG(totals.fiberG)} / ${fmtG(g.fiber)} g` : `${fmtG(totals.fiberG)} g`;
  const waterSub = g.water ? `${fmtMl(totals.waterMl)} / ${fmtMl(g.water)} ml` : `${fmtMl(totals.waterMl)} ml`;
  const exSub = g.exercise ? `${fmtMin(totals.exerciseMin)} / ${fmtMin(g.exercise)} min` : `${fmtMin(totals.exerciseMin)} min`;

  const netSign = totals.net >= 0 ? "" : "−";
  const netVal = Math.abs(Math.round(totals.net));

  const stats = [
    statCard("Calories in", fmtKcal(totals.caloriesIn), kcalSub),
    statCard("Exercise", `${fmtMin(totals.exerciseMin)} min`, exSub),
    statCard("Net", `${netSign}${netVal}`, "kcal (in − out)"),
    statCard("Water", `${fmtMl(totals.waterMl)} ml`, waterSub),
    statCard("Protein", `${fmtG(totals.proteinG)} g`, proteinSub),
    statCard("Fiber", `${fmtG(totals.fiberG)} g`, fiberSub),
  ];

  // Optional weight card if present
  if(totals.weight && totals.weight.value){
    stats.push(statCard("Weight", `${round1(totals.weight.value)} ${totals.weight.unit}`, `Last log: ${prettyTime(totals.weight.ts)}`));
  }else{
    stats.push(statCard("Last log", lastLabel, totals.lastTs ? "Today" : "No logs yet"));
  }

  $("#todayStatGrid").innerHTML = stats.join("");

  // Nudge logic (gentle)
  const nudge = buildNudge(entries, totals);
  $("#nudgePill").textContent = nudge;

  // Recent list (across all days)
  const rec = await getRecentEntries(state.recentLimit);
  renderRecentList(rec);

  renderTrackers(day);
}

function renderTrackers(day){
  const contactsPill = $("#contactsTimerPill");
  const contactsMeta = $("#contactsTimerMeta");
  const durationInput = $("#contactsDurationDaysInput");

  if(contactsPill && contactsMeta){
    const snapshot = contactsTimerSnapshot();
    contactsPill.textContent = snapshot.status;
    contactsMeta.textContent = snapshot.meta;
    if(durationInput && document.activeElement !== durationInput){
      durationInput.value = String(state.contactsTracker.pairDurationDays);
    }
  }

  const pillHost = $("#pillChecklist");
  const todoHost = $("#todoChecklist");
  if(!pillHost || !todoHost) return;

  const takenSet = new Set(state.pillTakenByDay[day] || []);

  if(!state.pillCatalog.length){
    pillHost.innerHTML = `<div class="muted small">No pills added yet.</div>`;
  }else{
    pillHost.innerHTML = state.pillCatalog.map((pill) => {
      const checked = takenSet.has(pill) ? "checked" : "";
      const doneClass = checked ? "is-done" : "";
      return `
        <label class="checkrow">
          <input type="checkbox" data-pill="${htmlEscape(pill)}" ${checked} />
          <span class="checkrow__label ${doneClass}">${htmlEscape(pill)}</span>
          <button class="btn item__btn btn--ghost" type="button" data-delete-pill="${htmlEscape(pill)}">Remove</button>
        </label>
      `;
    }).join("");
  }

  if(!state.todoItems.length){
    todoHost.innerHTML = `<div class="muted small">No to-dos yet.</div>`;
  }else{
    todoHost.innerHTML = state.todoItems.map((todo) => {
      const checked = todo.done ? "checked" : "";
      const doneClass = todo.done ? "is-done" : "";
      return `
        <label class="checkrow">
          <input type="checkbox" data-todo-id="${todo.id}" ${checked} />
          <span class="checkrow__label ${doneClass}">${htmlEscape(todo.text)}</span>
          <button class="btn item__btn btn--ghost" type="button" data-delete-todo="${todo.id}">Remove</button>
        </label>
      `;
    }).join("");
  }

  pillHost.querySelectorAll("input[data-pill]").forEach((input) => {
    input.addEventListener("change", async () => {
      const pill = input.dataset.pill;
      const next = new Set(state.pillTakenByDay[day] || []);
      if(input.checked) next.add(pill);
      else next.delete(pill);
      state.pillTakenByDay[day] = [...next];
      await putSetting("pillTakenByDay", state.pillTakenByDay);
      renderTrackers(day);
    });
  });

  pillHost.querySelectorAll("[data-delete-pill]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pill = btn.dataset.deletePill;
      state.pillCatalog = state.pillCatalog.filter((x) => x !== pill);
      for(const k of Object.keys(state.pillTakenByDay)){
        state.pillTakenByDay[k] = (state.pillTakenByDay[k] || []).filter((x) => x !== pill);
      }
      await putSetting("pillCatalog", state.pillCatalog);
      await putSetting("pillTakenByDay", state.pillTakenByDay);
      renderTrackers(day);
    });
  });

  todoHost.querySelectorAll("input[data-todo-id]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.todoId;
      state.todoItems = state.todoItems.map((t) => t.id === id ? { ...t, done: input.checked } : t);
      await putSetting("todoItems", state.todoItems);
      renderTrackers(day);
    });
  });

  todoHost.querySelectorAll("[data-delete-todo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteTodo;
      state.todoItems = state.todoItems.filter((t) => t.id !== id);
      await putSetting("todoItems", state.todoItems);
      renderTrackers(day);
    });
  });
}


async function renderRepeatChips(){
  const host = $("#repeatChips");
  if(!host) return;

  const recent = await getRecentEntries(80);

  const seen = new Set();
  const picks = [];

  for(const e of recent){
    if(e.type !== "food" && e.type !== "exercise") continue;

    // Store a minimal “re-loggable” shape (exclude ids/timestamps)
    const shape = {
      type: e.type,
      name: e.name || (e.type === "exercise" ? "Exercise" : "Food"),
      calories: e.calories ?? 0,
      protein_g: e.protein_g ?? 0,
      carbs_g: e.carbs_g ?? 0,
      fat_g: e.fat_g ?? 0,
      fiber_g: e.fiber_g ?? 0,
      water_ml: e.water_ml ?? 0,
      meal: e.meal ?? "",
      intensity: e.intensity ?? "",
      duration_min: e.duration_min ?? 0,
      calories_burned: e.calories_burned ?? 0,
      note: ""
    };

    const key = JSON.stringify(shape);
    if(seen.has(key)) continue;
    seen.add(key);

    picks.push(shape);
    if(picks.length >= 10) break;
  }

  if(!picks.length){
    host.innerHTML = `<span class="muted small">Nothing yet — your repeats will show here.</span>`;
    return;
  }

  host.innerHTML = picks.map((p) => {
    let label = p.name;
    if(p.type === "food"){
      const kcal = safeNum(p.calories) ? `${fmtKcal(p.calories)} kcal` : (safeNum(p.water_ml) ? `${fmtMl(p.water_ml)} ml` : "");
      if(kcal) label = `${label} · ${kcal}`;
    }else if(p.type === "exercise"){
      const dur = safeNum(p.duration_min) ? `${fmtMin(p.duration_min)}m` : "";
      if(dur) label = `${label} · ${dur}`;
    }
    return `<button class="chip" type="button" data-payload='${JSON.stringify(p)}'>${htmlEscape(label)}</button>`;
  }).join("");

  host.querySelectorAll("button.chip").forEach(btn => {
    btn.addEventListener("click", async () => {
      const payload = JSON.parse(btn.dataset.payload);
      await logEntry(payload);
    });
  });
}


function buildNudge(entries, totals){
  const now = new Date();
  const hour = now.getHours();

  const g = state.goals;

  // hydration check if it's daytime and water is low
  if(hour >= 9 && hour <= 20){
    const lastWater = [...entries].reverse().find(e => e.type==="food" && safeNum(e.water_ml) > 0);
    const waterSoFar = totals.waterMl;
    const target = safeNum(g.water);

    if(target && waterSoFar < target*0.35){
      return "Hydration check: a small glass of water could be a nice win.";
    }

    if(lastWater){
      const mins = Math.round((Date.now() - lastWater.ts) / 60000);
      if(mins >= 180){
        return "It’s been a bit — consider a quick water top-up.";
      }
    }
  }

  // fiber check
  if(hour >= 14 && hour <= 21){
    const target = safeNum(g.fiber);
    if(target && totals.fiberG < target*0.45){
      return "Fiber nudge: fruit/veg/beans or a quick +5g button can help.";
    }
  }

  // exercise check
  if(hour >= 17 && hour <= 21){
    const target = safeNum(g.exercise);
    if(target && totals.exerciseMin < target*0.35){
      return "Tiny movement counts. A 10–20 minute walk is a solid reset.";
    }
  }

  return "All caught up.";
}

function renderRecentList(entries){
  const list = $("#recentList");
  if(!entries.length){
    list.innerHTML = `<div class="muted">No activity yet.</div>`;
    return;
  }

  list.innerHTML = entries.map(e => {
    const time = prettyTime(e.ts);
    const title = entryTitle(e);
    const details = entryDetails(e);

    return `
      <div class="item" data-id="${e.id}">
        <div>
          <div class="item__title">${htmlEscape(title)}</div>
          <div class="item__meta">${htmlEscape(time)} · ${htmlEscape(e.day || "")}</div>
        </div>
        <div class="item__actions">
          <button class="btn item__btn btn--ghost" data-action="toggle">Details</button>
          <button class="btn item__btn btn--danger" data-action="delete">Delete</button>
        </div>
        <div class="item__details">${details}</div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".item").forEach(el => {
    el.addEventListener("click", async (evt) => {
      const actionBtn = evt.target.closest("[data-action]");
      const action = actionBtn?.dataset?.action;
      const id = el.dataset.id;

      if(action === "delete"){
        evt.preventDefault();
        evt.stopPropagation();
        const ok = confirm("Delete this entry? This cannot be undone.");
        if(!ok) return;
        await deleteEntry(id);
        showToast("Deleted.");
        await refreshAll();
        return;
      }

      // Default: toggle details when tapping anywhere on the card
      el.classList.toggle("is-open");
    });
  });
}

async function renderInsights(){
  const days = lastNDays(7);
  const dayStart = days[0];
  const dayEnd = days[days.length-1];

  const entries = await getEntriesBetweenDays(dayStart, dayEnd);

  const byDay = new Map();
  for(const d of days) byDay.set(d, []);
  for(const e of entries){
    if(byDay.has(e.day)) byDay.get(e.day).push(e);
  }

  const daily = days.map(d => computeTotals(byDay.get(d)));

  const totalsWeek = {
    caloriesIn: daily.reduce((a,x)=>a + x.caloriesIn, 0),
    caloriesOut: daily.reduce((a,x)=>a + x.caloriesOut, 0),
    exerciseMin: daily.reduce((a,x)=>a + x.exerciseMin, 0),
    waterMl: daily.reduce((a,x)=>a + x.waterMl, 0),
    proteinG: daily.reduce((a,x)=>a + x.proteinG, 0),
    fiberG: daily.reduce((a,x)=>a + x.fiberG, 0),
  };

  const caloriesSeries = daily.map(x=>Math.round(x.caloriesIn));
  const exerciseSeries = daily.map(x=>Math.round(x.exerciseMin));
  const netSeries = daily.map(x=>Math.round(x.net));
  const waterSeries = daily.map(x=>Math.round(x.waterMl));
  const proteinSeries = daily.map(x=>Math.round(x.proteinG));
  const fiberSeries = daily.map(x=>Math.round(x.fiberG));

  const cards = [
    insightCard("Calories", `7d total ${fmtKcal(totalsWeek.caloriesIn)} • avg/day ${fmtKcal(totalsWeek.caloriesIn/7)}`, fmtKcal(daily[daily.length-1].caloriesIn), "kcal", caloriesSeries),
    insightCard("Exercise", `7d total ${fmtMin(totalsWeek.exerciseMin)} min • avg/day ${fmtMin(totalsWeek.exerciseMin/7)} min`, fmtMin(daily[daily.length-1].exerciseMin), "min", exerciseSeries),
    insightCard("Net", `Avg/day ${fmtKcal(netSeries.reduce((a,x)=>a+x,0)/7)} kcal`, `${netSeries[netSeries.length-1]}`, "kcal", netSeries),
    insightCard("Water", `7d total ${fmtMl(totalsWeek.waterMl)} ml • avg/day ${fmtMl(totalsWeek.waterMl/7)} ml`, fmtMl(daily[daily.length-1].waterMl), "ml", waterSeries),
    insightCard("Protein", `7d total ${fmtG(totalsWeek.proteinG)} g • avg/day ${fmtG(totalsWeek.proteinG/7)} g`, fmtG(daily[daily.length-1].proteinG), "g", proteinSeries),
    insightCard("Fiber", `7d total ${fmtG(totalsWeek.fiberG)} g • avg/day ${fmtG(totalsWeek.fiberG/7)} g`, fmtG(daily[daily.length-1].fiberG), "g", fiberSeries),
  ];

  $("#insightsGrid").innerHTML = cards.join("");

  // draw sparklines
  document.querySelectorAll("canvas.spark").forEach(c => {
    const values = JSON.parse(c.dataset.values || "[]");
    // set pixel ratio crispness
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.floor(120 * ratio);
    c.height = Math.floor(34 * ratio);
    c.style.width = "120px";
    c.style.height = "34px";
    drawSparkline(c, values);
  });

  // stash for copy button
  renderInsights._daily = daily;
  renderInsights._days = days;
}

function insightCard(title, meta, rightValue, rightUnit, series){
  const safe = (s) => htmlEscape(s);
  return `
    <div class="insight">
      <div>
        <div class="insight__title">${safe(title)} <span class="muted small">${safe(rightValue)} ${safe(rightUnit)}</span></div>
        <div class="insight__meta">${safe(meta)}</div>
      </div>
      <canvas class="spark" data-values='${JSON.stringify(series)}'></canvas>
    </div>
  `;
}

/** -----------------------------
 *  Manual entry UI
 *  ----------------------------- */

function renderManualFields(type){
  const host = $("#manualFields");

  if(type === "food"){
    host.innerHTML = `
      <div class="label">
        <span>What was it?</span>
        <input id="m_name" class="input" placeholder="e.g., Chicken salad" />
      </div>

      <div class="inline">
        <label class="label">
          <span>Calories</span>
          <input id="m_cal" class="input" inputmode="numeric" placeholder="e.g., 420" />
        </label>
        <label class="label">
          <span>Protein (g)</span>
          <input id="m_pro" class="input" inputmode="numeric" placeholder="e.g., 35" />
        </label>
        <label class="label">
          <span>Carbs (g)</span>
          <input id="m_carb" class="input" inputmode="numeric" placeholder="e.g., 30" />
        </label>
        <label class="label">
          <span>Fat (g)</span>
          <input id="m_fat" class="input" inputmode="numeric" placeholder="e.g., 18" />
        </label>
        <label class="label">
          <span>Fiber (g)</span>
          <input id="m_fib" class="input" inputmode="numeric" placeholder="e.g., 6" />
        </label>
        <label class="label">
          <span>Fluids (ml)</span>
          <input id="m_water" class="input" inputmode="numeric" placeholder="e.g., 250" />
        </label>
      </div>

      <label class="label">
        <span>Meal</span>
        <select id="m_meal" class="input">
          <option value="">(optional)</option>
          <option value="breakfast">Breakfast</option>
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
          <option value="snack">Snack</option>
        </select>
      </label>

      <label class="label">
        <span>Note (optional)</span>
        <input id="m_note" class="input" placeholder="e.g., ‘Felt satisfied’" />
      </label>
    `;
    return;
  }

  if(type === "exercise"){
    host.innerHTML = `
      <label class="label">
        <span>Activity</span>
        <input id="x_name" class="input" placeholder="e.g., Bike ride" />
      </label>

      <div class="inline">
        <label class="label">
          <span>Intensity</span>
          <select id="x_int" class="input">
            <option value="light">Light</option>
            <option value="moderate" selected>Moderate</option>
            <option value="vigorous">Vigorous</option>
          </select>
        </label>
        <label class="label">
          <span>Duration (min)</span>
          <input id="x_dur" class="input" inputmode="numeric" placeholder="e.g., 30" />
        </label>
        <label class="label">
          <span>Calories burned (optional)</span>
          <input id="x_cal" class="input" inputmode="numeric" placeholder="e.g., 220" />
        </label>
        <label class="label">
          <span>Note (optional)</span>
          <input id="x_note" class="input" placeholder="e.g., ‘Felt great’" />
        </label>
      </div>

      <div class="muted small">If you leave calories blank, we’ll do a tiny estimate based on intensity + duration.</div>
    `;
    return;
  }

  if(type === "weight"){
    host.innerHTML = `
      <div class="inline">
        <label class="label">
          <span>Weight</span>
          <input id="w_value" class="input" inputmode="decimal" placeholder="e.g., 165.4" />
        </label>
        <label class="label">
          <span>Unit</span>
          <select id="w_unit" class="input">
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>

      <div class="muted small">Tip: you don’t have to weigh daily — weekly works too.</div>
    `;
    // set current preference
    setTimeout(() => {
      const sel = $("#w_unit");
      if(sel) sel.value = state.goals.weightUnit || "lb";
    }, 0);
    return;
  }

  if(type === "photo"){
    host.innerHTML = `
      <label class="label">
        <span>Photo</span>
        <input id="p_file" class="input" type="file" accept="image/*" />
      </label>
      <label class="label">
        <span>Caption (optional)</span>
        <input id="p_caption" class="input" placeholder="e.g., ‘Restaurant lunch’" />
      </label>
      <div class="muted small">We resize photos before saving (keeps storage small). Export JSON includes thumbnails.</div>
    `;
    return;
  }

  host.innerHTML = "";
}

function estimateBurn(intensity, durationMin){
  const m = safeNum(durationMin);
  if(!m) return 0;
  const mult = intensity === "vigorous" ? 7 : intensity === "light" ? 3 : 5;
  // simple “good enough” estimate: 3–7 kcal/min
  return Math.round(mult * m);
}

/** -----------------------------
 *  Photo resize helper
 *  ----------------------------- */

async function fileToResizedJpeg(file, maxSide=1200, quality=0.82){
  // Returns { blob, thumbDataUrl }
  const img = await loadImageFromFile(file);
  const { w, h } = fitContain(img.naturalWidth, img.naturalHeight, maxSide);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  const thumbDataUrl = canvas.toDataURL("image/jpeg", 0.55);

  return { blob, thumbDataUrl };
}

function fitContain(w, h, maxSide){
  if(w <= maxSide && h <= maxSide) return { w, h };
  if(w >= h){
    const nw = maxSide;
    const nh = Math.round((h / w) * maxSide);
    return { w: nw, h: nh };
  }else{
    const nh = maxSide;
    const nw = Math.round((w / h) * maxSide);
    return { w: nw, h: nh };
  }
}

function loadImageFromFile(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** -----------------------------
 *  Logging
 *  ----------------------------- */

async function logEntry(entry){
  const ts = Date.now() + state.timeOffsetMin * 60 * 1000;
  const e = {
    id: uid(),
    ts,
    day: dayStringFromTs(ts),
    ...entry,
  };

  await addEntry(e);

  // Choose praise category
  let kind = e.type;
  if(e.type === "food" && safeNum(e.water_ml) > 0 && safeNum(e.calories) === 0 && !e.name?.toLowerCase().includes("protein")){
    kind = "water";
  }
  showToast(pickPraise(kind));
  await refreshAll();
}

function focusLogView(){
  setView("log");
  $("#quickActionsCard")?.scrollIntoView({ behavior:"smooth", block:"start" });
}

function focusManual(type){
  setView("log");
  $("#manualType").value = type;
  renderManualFields(type);
  $("#manualForm")?.scrollIntoView({ behavior:"smooth", block:"start" });
}

/** -----------------------------
 *  Views
 *  ----------------------------- */

function setView(view){
  state.view = view;
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("is-active", v.dataset.view === view);
  });

  document.querySelectorAll(".tab").forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("is-active", active);
    if(active) btn.setAttribute("aria-current","page");
    else btn.removeAttribute("aria-current");
  });
}

/** -----------------------------
 *  Settings load/save
 *  ----------------------------- */

async function loadGoals(){
  const saved = await getSetting("goals");
  if(saved && typeof saved === "object"){
    state.goals = { ...DEFAULT_GOALS, ...saved };
  }else{
    state.goals = { ...DEFAULT_GOALS };
  }

  // populate UI
  $("#goalCalories").value = state.goals.calories ?? "";
  $("#goalProtein").value = state.goals.protein ?? "";
  $("#goalFiber").value = state.goals.fiber ?? "";
  $("#goalWater").value = state.goals.water ?? "";
  $("#goalExercise").value = state.goals.exercise ?? "";
}

async function saveGoalsFromForm(){
  state.goals.calories = safeNum($("#goalCalories").value) || "";
  state.goals.protein = safeNum($("#goalProtein").value) || "";
  state.goals.fiber = safeNum($("#goalFiber").value) || "";
  state.goals.water = safeNum($("#goalWater").value) || "";
  state.goals.exercise = safeNum($("#goalExercise").value) || "";
  await putSetting("goals", state.goals);
  showToast("Saved goals.");
  await refreshAll();
}


async function loadTrackers(){
  const savedCatalog = await getSetting("pillCatalog");
  state.pillCatalog = Array.isArray(savedCatalog) && savedCatalog.length
    ? savedCatalog.filter(Boolean)
    : [...DEFAULT_PILL_CATALOG];

  const savedTaken = await getSetting("pillTakenByDay");
  state.pillTakenByDay = (savedTaken && typeof savedTaken === "object") ? savedTaken : {};

  const savedTodos = await getSetting("todoItems");
  state.todoItems = Array.isArray(savedTodos) ? savedTodos : [];

  const savedContactsTracker = await getSetting("contactsTracker");
  state.contactsTracker = normalizeContactsTracker(savedContactsTracker);
}

function setupTrackers(){
  $("#pillForm")?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const input = $("#pillInput");
    const name = input.value.trim();
    if(!name){
      showToast("Enter a pill name first.");
      return;
    }
    if(state.pillCatalog.includes(name)){
      showToast("That pill is already listed.");
      return;
    }
    state.pillCatalog.push(name);
    await putSetting("pillCatalog", state.pillCatalog);
    input.value = "";
    renderTrackers(todayDay());
  });

  $("#todoForm")?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const input = $("#todoInput");
    const text = input.value.trim();
    if(!text){
      showToast("Enter a task first.");
      return;
    }
    state.todoItems.unshift({ id: uid(), text, done: false });
    await putSetting("todoItems", state.todoItems);
    input.value = "";
    renderTrackers(todayDay());
  });

  $("#contactsDurationForm")?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const input = $("#contactsDurationDaysInput");
    const days = Math.round(safeNum(input.value));
    if(!days || days < 1 || days > 365){
      showToast("Enter a pair length between 1 and 365 days.");
      return;
    }
    state.contactsTracker = normalizeContactsTracker({
      ...state.contactsTracker,
      pairDurationDays: days,
    });
    await putSetting("contactsTracker", state.contactsTracker);
    showToast("Saved contact pair length.");
    renderTrackers(todayDay());
  });

  $("#startContactsPairBtn")?.addEventListener("click", async () => {
    const hasActivePair = !!state.contactsTracker.activePairStartTs;
    if(hasActivePair){
      const ok = confirm("Start a brand-new pair now? This resets the current timer.");
      if(!ok) return;
    }

    state.contactsTracker = normalizeContactsTracker({
      ...state.contactsTracker,
      activePairStartTs: Date.now(),
    });
    await putSetting("contactsTracker", state.contactsTracker);
    showToast("Started a new contact pair.");
    renderTrackers(todayDay());
  });
}

/** -----------------------------
 *  Export / Import
 *  ----------------------------- */

function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n]/.test(s)){
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}

async function exportJson(){
  const entries = await getAllEntries();
  const settings = await getAllSettings();

  // keep photos small (thumbnail only) in JSON export
  const sanitized = entries.map(e => {
    if(e.type !== "photo") return e;
    return {
      ...e,
      // Remove any big blob fields (if we store them later).
      photoBlob: undefined,
      // Keep the thumb (data URL) since user asked for later AI parsing hooks.
      // This will still make the file larger; for lots of photos, consider fewer thumbs.
      thumbDataUrl: e.thumbDataUrl || null,
    };
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    settings,
    entries: sanitized,
    note: "Photo thumbnails included; original images are stored locally in IndexedDB."
  };

  downloadText(`pocket-balance-backup-${todayDay()}.json`, JSON.stringify(payload, null, 2), "application/json");
  showToast("Exported backup JSON.");
}

async function exportCsv(){
  const entries = await getAllEntries();
  const rows = [];
  rows.push([
    "timestamp",
    "day",
    "type",
    "name",
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "water_ml",
    "duration_min",
    "intensity",
    "calories_burned",
    "note_or_text",
    "unit"
  ]);

  for(const e of entries.sort((a,b)=>a.ts-b.ts)){
    rows.push([
      new Date(e.ts).toISOString(),
      e.day || "",
      e.type,
      e.name || "",
      e.calories ?? "",
      e.protein_g ?? "",
      e.carbs_g ?? "",
      e.fat_g ?? "",
      e.fiber_g ?? "",
      e.water_ml ?? "",
      e.duration_min ?? "",
      e.intensity ?? "",
      e.calories_burned ?? "",
      e.note ?? e.text ?? e.caption ?? "",
      e.unit ?? ""
    ]);
  }

  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  downloadText(`pocket-balance-export-${todayDay()}.csv`, csv, "text/csv");
  showToast("Exported CSV.");
}

async function importJson(file){
  const text = await file.text();
  let data;
  try{
    data = JSON.parse(text);
  }catch(_err){
    alert("Couldn’t read that JSON file. Please check the format and try again.");
    return;
  }

  // Keep this importer strict so backup restore behavior is predictable.
  // AI-shaped JSON should go through the dedicated ChatGPT bridge importer.
  const looksLikeBackup = data
    && typeof data === "object"
    && !Array.isArray(data)
    && Array.isArray(data.entries)
    && data.settings
    && typeof data.settings === "object";

  if(!looksLikeBackup){
    alert("This import is for Pocket Balance backup JSON files only.\n\nFor AI-generated JSON, use Settings > ChatGPT bridge (easy).");
    return;
  }

  // wipe then import
  await wipeAll();

  // restore settings
  const settings = data.settings || {};
  for(const k of Object.keys(settings)){
    await putSetting(k, settings[k]);
  }

  // restore entries
  let importedCount = 0;
  for(const e of data.entries){
    if(!e || typeof e !== "object") continue;
    if(!e.id || !e.ts || !e.type) continue;
    await addEntry(e);
    importedCount += 1;
  }

  await loadGoals();
  await loadTrackers();
  await refreshAll();
  showToast(`Imported backup (${importedCount} entries).`);
}

const AI_IMPORT_TYPES = new Set(["food", "exercise", "note", "weight"]);
const AI_SOURCE_NOTES_LIMIT = 60;

function stripMarkdownJsonFences(text){
  const trimmed = String(text || "").trim();
  if(!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function setOptionalNumber(target, key, value){
  if(value === undefined || value === null || value === "") return;
  target[key] = safeNum(value);
}

function setOptionalText(target, key, value){
  const s = String(value ?? "").trim();
  if(!s) return;
  target[key] = s;
}

function parseAiTs(raw){
  if(raw === undefined || raw === null || raw === ""){
    return Date.now() + state.timeOffsetMin * 60 * 1000;
  }
  if(typeof raw === "number" && Number.isFinite(raw)){
    // Accept either milliseconds or unix seconds.
    return raw > 1e12 ? Math.round(raw) : Math.round(raw * 1000);
  }
  const parsed = Date.parse(String(raw));
  if(Number.isFinite(parsed)) return parsed;
  return Date.now() + state.timeOffsetMin * 60 * 1000;
}

function normalizeAiType(raw){
  const explicit = String(raw?.type || "").trim().toLowerCase();
  if(explicit) return explicit;
  if(raw?.duration_min !== undefined || raw?.calories_burned !== undefined || raw?.intensity){
    return "exercise";
  }
  if(raw?.value !== undefined && (raw?.unit || raw?.weight_unit)){
    return "weight";
  }
  if(raw?.text || raw?.note){
    return "note";
  }
  return "food";
}

function normalizeAiEntry(raw){
  if(!raw || typeof raw !== "object") return null;

  const type = normalizeAiType(raw);
  if(!AI_IMPORT_TYPES.has(type)) return null;

  const ts = parseAiTs(raw.ts ?? raw.timestamp ?? raw.time);
  const base = {
    id: uid(),
    ts,
    day: dayStringFromTs(ts),
    type,
  };

  if(type === "food"){
    const entry = {
      ...base,
      name: String(raw.name ?? raw.item ?? "Food").trim() || "Food",
    };
    setOptionalNumber(entry, "calories", raw.calories ?? raw.kcal);
    setOptionalNumber(entry, "protein_g", raw.protein_g ?? raw.protein);
    setOptionalNumber(entry, "carbs_g", raw.carbs_g ?? raw.carbs);
    setOptionalNumber(entry, "fat_g", raw.fat_g ?? raw.fat);
    setOptionalNumber(entry, "fiber_g", raw.fiber_g ?? raw.fiber);
    setOptionalNumber(entry, "water_ml", raw.water_ml ?? raw.water);
    setOptionalText(entry, "meal", raw.meal);
    setOptionalText(entry, "note", raw.note);
    return entry;
  }

  if(type === "exercise"){
    const entry = {
      ...base,
      name: String(raw.name ?? raw.activity ?? "Exercise").trim() || "Exercise",
    };
    setOptionalText(entry, "intensity", raw.intensity);
    setOptionalNumber(entry, "duration_min", raw.duration_min ?? raw.duration);
    setOptionalNumber(entry, "calories_burned", raw.calories_burned ?? raw.kcal_burned);
    setOptionalText(entry, "note", raw.note);
    return entry;
  }

  if(type === "weight"){
    if(raw.value === undefined || raw.value === null || raw.value === "") return null;
    const entry = {
      ...base,
      value: safeNum(raw.value),
      unit: String(raw.unit ?? raw.weight_unit ?? state.goals.weightUnit ?? "lb"),
    };
    setOptionalText(entry, "note", raw.note);
    return entry;
  }

  const text = String(raw.text ?? raw.note ?? raw.caption ?? "").trim();
  if(!text) return null;
  return {
    ...base,
    text,
  };
}

function parseAiImport(text){
  const cleaned = stripMarkdownJsonFences(text);
  const payload = JSON.parse(cleaned);
  const rawEntries = Array.isArray(payload) ? payload : payload?.entries;
  if(!Array.isArray(rawEntries)){
    throw new Error("AI JSON must be an array or an object with an entries array.");
  }
  const normalized = rawEntries.map(normalizeAiEntry).filter(Boolean);
  if(!normalized.length){
    throw new Error("No usable entries found.");
  }
  return normalized;
}

function isPlainLanguageNoteEntry(e){
  return e && e.type === "note" && String(e.text ?? "").trim().length > 0;
}

async function getPlainLanguageNotes(){
  const entries = await getAllEntries();
  return entries
    .filter(isPlainLanguageNoteEntry)
    .sort((a, b) => safeNum(a.ts) - safeNum(b.ts));
}

function toAiSourceNotePayload(note){
  const ts = safeNum(note.ts) || Date.now();
  return {
    id: note.id || uid(),
    timestamp: new Date(ts).toISOString(),
    day: note.day || dayStringFromTs(ts),
    text: String(note.text || "").trim(),
  };
}

function clipPreviewText(text, maxLen=84){
  const s = String(text || "").trim();
  if(s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
}

function aiPreviewTitle(entry){
  if(entry.type === "food"){
    return `Food: ${entry.name || "Food"}`;
  }
  if(entry.type === "exercise"){
    return `Exercise: ${entry.name || "Exercise"}`;
  }
  if(entry.type === "weight"){
    const unit = entry.unit || state.goals.weightUnit || "lb";
    return `Weight: ${round1(safeNum(entry.value))} ${unit}`;
  }
  return `Note: ${clipPreviewText(entry.text || "", 66) || "Note"}`;
}

function aiPreviewMeta(entry){
  const parts = [];
  if(entry.day) parts.push(entry.day);
  if(entry.ts) parts.push(prettyTime(entry.ts));

  if(entry.type === "food"){
    if(entry.calories !== undefined && entry.calories !== null) parts.push(`${Math.round(safeNum(entry.calories))} kcal`);
    if(entry.protein_g !== undefined && entry.protein_g !== null) parts.push(`${round1(safeNum(entry.protein_g))}g protein`);
    if(entry.meal) parts.push(String(entry.meal));
  }else if(entry.type === "exercise"){
    if(entry.duration_min !== undefined && entry.duration_min !== null) parts.push(`${Math.round(safeNum(entry.duration_min))} min`);
    if(entry.intensity) parts.push(String(entry.intensity));
    if(entry.calories_burned !== undefined && entry.calories_burned !== null){
      parts.push(`${Math.round(safeNum(entry.calories_burned))} kcal burned`);
    }
  }else if(entry.type === "note"){
    const text = clipPreviewText(entry.text || "", 72);
    if(text) parts.push(text);
  }

  return parts.join(" | ");
}

function setAiWizardStatus(text){
  const el = $("#aiWizardStatus");
  if(el) el.textContent = text;
}

function renderAiPreview(entries = []){
  const host = $("#aiPreviewList");
  if(!host) return;

  if(!entries.length){
    host.innerHTML = `<div class="muted small">Preview entries will appear here.</div>`;
    return;
  }

  host.innerHTML = entries.map((entry) => {
    return `
      <div class="item">
        <div>
          <div class="item__title">${htmlEscape(aiPreviewTitle(entry))}</div>
          <div class="item__meta">${htmlEscape(aiPreviewMeta(entry))}</div>
        </div>
        <div class="item__actions"></div>
      </div>
    `;
  }).join("");
}

async function buildAiPromptFromNotes(){
  const allNotes = await getPlainLanguageNotes();
  const notesForPrompt = allNotes.slice(-AI_SOURCE_NOTES_LIMIT);
  state.lastAiPromptSourceNoteIds = notesForPrompt.map((n) => n.id).filter(Boolean);
  const sourcePayload = notesForPrompt.map(toAiSourceNotePayload);
  return {
    prompt: aiPromptTemplate(sourcePayload),
    sourcePayload,
    totalNotes: allNotes.length,
    truncated: allNotes.length > sourcePayload.length,
  };
}

async function resolveAiClearTargets({ fallbackToAll = true } = {}){
  const allNotes = await getPlainLanguageNotes();
  const copiedIds = new Set(state.lastAiPromptSourceNoteIds);
  const copiedNotes = allNotes.filter((n) => copiedIds.has(n.id));
  const targetNotes = copiedNotes.length ? copiedNotes : (fallbackToAll ? allNotes : []);
  const scope = copiedNotes.length
    ? `last copied notes (${targetNotes.length})`
    : `all plain-language notes (${targetNotes.length})`;

  return { allNotes, copiedNotes, targetNotes, scope };
}

async function refreshAiSourceSummary(){
  const summary = $("#aiSourceSummary");
  if(!summary) return;

  const notes = await getPlainLanguageNotes();
  const total = notes.length;
  const noteIds = new Set(notes.map((n) => n.id));
  state.lastAiPromptSourceNoteIds = state.lastAiPromptSourceNoteIds.filter((id) => noteIds.has(id));
  const copied = state.lastAiPromptSourceNoteIds.length;

  if(!total){
    summary.textContent = "No plain-language notes saved yet. Add notes in the Log tab.";
    return;
  }

  if(copied){
    summary.textContent = `${total} notes in inbox. Last copied set: ${copied}.`;
    return;
  }

  summary.textContent = `${total} notes ready for prompt copy.`;
}

function aiPromptTemplate(sourceNotes = []){
  const day = todayDay();
  const sourceJson = JSON.stringify(sourceNotes, null, 2);
  return [
    "Convert my rough health-tracker notes into strict JSON for Pocket Balance.",
    "",
    "Return only valid JSON. No markdown, no extra explanation.",
    "",
    "Use this format:",
    "{",
    '  "entries": [',
    '    { "type": "food", "name": "string", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0, "water_ml": 0, "meal": "breakfast|lunch|dinner|snack", "note": "optional", "timestamp": "ISO-8601" },',
    '    { "type": "exercise", "name": "string", "intensity": "light|moderate|vigorous", "duration_min": 0, "calories_burned": 0, "note": "optional", "timestamp": "ISO-8601" },',
    '    { "type": "note", "text": "string", "timestamp": "ISO-8601" },',
    '    { "type": "weight", "value": 0, "unit": "lb|kg", "note": "optional", "timestamp": "ISO-8601" }',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Include only events clearly stated in the provided notes JSON.",
    "- If a numeric value is unknown, omit that field.",
    `- If date is missing, use ${day}.`,
    "- Keep assumptions short inside note.",
    '- If no usable events exist, return {"entries":[]}.',
    "",
    "Local plain-language notes (JSON):",
    sourceJson,
  ].join("\n");
}

/** -----------------------------
 *  Copy update
 *  ----------------------------- */

async function copyUpdate(){
  const day = todayDay();
  const entries = await getEntriesByDay(day);
  const t = computeTotals(entries);

  const lines = [];
  lines.push(`Today (${prettyDate(day)}):`);
  lines.push(`• Calories in: ${fmtKcal(t.caloriesIn)} kcal`);
  if(t.caloriesOut) lines.push(`• Exercise burn: ${fmtKcal(t.caloriesOut)} kcal (${fmtMin(t.exerciseMin)} min)`);
  else lines.push(`• Exercise: ${fmtMin(t.exerciseMin)} min`);
  lines.push(`• Net: ${Math.round(t.net)} kcal`);
  lines.push(`• Protein: ${fmtG(t.proteinG)} g • Fiber: ${fmtG(t.fiberG)} g`);
  lines.push(`• Water: ${fmtMl(t.waterMl)} ml`);
  if(t.weight?.value) lines.push(`• Weight: ${round1(t.weight.value)} ${t.weight.unit}`);

  lines.push("");
  lines.push("Tiny wins count. Consistency over perfection.");

  await copyToClipboard(lines.join("\n"));
  showToast("Copied.");
}

/** -----------------------------
 *  Initialization
 *  ----------------------------- */

function setupNav(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  $("#quickAddBtn").addEventListener("click", () => focusLogView());
}

function setupRecentLimit(){
  document.querySelectorAll(".seg__btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".seg__btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.recentLimit = Number(btn.dataset.recent || 10);
      await renderToday();
    });
  });
}

function setupTimeChips(){
  document.querySelectorAll("#timeChips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#timeChips .chip").forEach(c => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      state.timeOffsetMin = Number(chip.dataset.min || 0);
      $("#timeChipLabel").textContent = minutesAgoLabel(state.timeOffsetMin);
    });
  });
}

function setupQuickActions(){
  const grid = $("#quickActionsGrid");
  grid.innerHTML = state.quickActions.map((q, idx) => {
    return `
      <button class="qa" data-id="${q.id}" data-theme="${q.theme || ((idx%4)+1)}" type="button">
        <span class="qa__emoji">${q.emoji || ""}</span>
        <span class="qa__text">${htmlEscape(q.label)}</span>
      </button>
    `;
  }).join("");

  grid.querySelectorAll(".qa").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const q = state.quickActions.find(x => x.id === id);
      if(!q) return;

      if(q.type === "open"){
        const t = q.payload?.targetType || "food";
        focusManual(t);
        showToast("Ready.");
        return;
      }

      await logEntry({
        type: q.type,
        ...q.payload
      });
    });
  });

  $("#editQuickBtnsBtn").addEventListener("click", () => {
    alert("Quick action editing is a planned upgrade. For now, tweak DEFAULT_QUICK_ACTIONS in app.js.");
  });
}

function setupNoteBox(){
  $("#saveNoteBtn").addEventListener("click", async () => {
    const text = $("#noteText").value.trim();
    if(!text){
      showToast("Type a note first.");
      return;
    }
    $("#noteText").value = "";
    await logEntry({ type: "note", text });
  });

  $("#clearNoteBtn").addEventListener("click", () => {
    $("#noteText").value = "";
    showToast("Cleared.");
  });
}

function setupManualForm(){
  const typeSel = $("#manualType");
  renderManualFields(typeSel.value);

  typeSel.addEventListener("change", () => renderManualFields(typeSel.value));

  $("#manualForm").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const t = $("#manualType").value;

    if(t === "food"){
      const name = $("#m_name").value.trim() || "Food";
      const calories = safeNum($("#m_cal").value);
      const protein_g = safeNum($("#m_pro").value);
      const carbs_g = safeNum($("#m_carb").value);
      const fat_g = safeNum($("#m_fat").value);
      const fiber_g = safeNum($("#m_fib").value);
      const water_ml = safeNum($("#m_water").value);
      const meal = $("#m_meal").value || "";
      const note = $("#m_note").value.trim() || "";

      await logEntry({ type:"food", name, calories, protein_g, carbs_g, fat_g, fiber_g, water_ml, meal, note });
      $("#manualForm").reset();
      renderManualFields("food");
      return;
    }

    if(t === "exercise"){
      const name = $("#x_name").value.trim() || "Exercise";
      const intensity = $("#x_int").value || "moderate";
      const duration_min = safeNum($("#x_dur").value);
      let calories_burned = safeNum($("#x_cal").value);
      if(!calories_burned) calories_burned = estimateBurn(intensity, duration_min);
      const note = $("#x_note").value.trim() || "";

      await logEntry({ type:"exercise", name, intensity, duration_min, calories_burned, note });
      $("#manualForm").reset();
      renderManualFields("exercise");
      return;
    }

    if(t === "weight"){
      const value = safeNum($("#w_value").value);
      if(!value){
        showToast("Enter a weight value.");
        return;
      }
      const unit = $("#w_unit").value || state.goals.weightUnit || "lb";
      // store preference
      state.goals.weightUnit = unit;
      await putSetting("goals", state.goals);

      await logEntry({ type:"weight", value, unit });
      $("#manualForm").reset();
      renderManualFields("weight");
      return;
    }

    if(t === "photo"){
      const input = $("#p_file");
      const file = input.files && input.files[0];
      if(!file){
        showToast("Choose a photo first.");
        return;
      }

      const caption = $("#p_caption").value.trim() || "";
      const { blob, thumbDataUrl } = await fileToResizedJpeg(file, 1200, 0.82);

      // Store resized blob as base64 for now (simple, portable)
      // Note: storing blob directly also works in IndexedDB; we keep it simple in v1.
      const dataUrl = await blobToDataUrl(blob);

      await logEntry({ type:"photo", caption, thumbDataUrl, photoDataUrl: dataUrl, mime: "image/jpeg" });
      $("#manualForm").reset();
      renderManualFields("photo");
      return;
    }
  });
}

function blobToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function setupSettings(){
  $("#goalsForm").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    await saveGoalsFromForm();
  });

  $("#resetGoalsBtn").addEventListener("click", async () => {
    state.goals = { ...DEFAULT_GOALS };
    await putSetting("goals", state.goals);
    await loadGoals();
    showToast("Reset.");
    await refreshAll();
  });

  $("#exportJsonBtn").addEventListener("click", exportJson);
  $("#exportCsvBtn").addEventListener("click", exportCsv);

  $("#processAiInboxBtn")?.addEventListener("click", async () => {
    try{
      const { prompt, sourcePayload, truncated } = await buildAiPromptFromNotes();
      const ok = await copyToClipboard(prompt);
      await refreshAiSourceSummary();
      renderAiPreview([]);

      if(ok){
        if(sourcePayload.length){
          const countLabel = truncated
            ? `latest ${sourcePayload.length}`
            : `${sourcePayload.length}`;
          setAiWizardStatus(`Step 1 done: prompt copied with ${countLabel} notes. Paste ChatGPT JSON, then tap Preview.`);
          showToast(`Prompt copied with ${countLabel} notes.`);
        }else{
          setAiWizardStatus("Step 1 done: prompt copied, but no notes were found yet.");
          showToast("Prompt copied (no notes found yet).");
        }
        const input = $("#aiJsonInput");
        if(input) input.focus();
      }else{
        setAiWizardStatus("Could not copy prompt. You can still paste the prompt manually.");
        showToast("Could not copy prompt.");
      }
    }catch(e){
      alert(`Could not process note inbox.\n\n${e.message}`);
    }
  });

  $("#copyAiPromptBtn")?.addEventListener("click", async () => {
    try{
      const { prompt, sourcePayload, truncated } = await buildAiPromptFromNotes();
      const ok = await copyToClipboard(prompt);
      await refreshAiSourceSummary();
      if(ok){
        if(sourcePayload.length){
          showToast(truncated
            ? `Prompt copied with latest ${sourcePayload.length} notes.`
            : `Prompt copied with ${sourcePayload.length} notes.`);
        }else{
          showToast("Prompt copied (no notes found yet).");
        }
      }else{
        showToast("Could not copy prompt.");
      }
    }catch(e){
      alert(`Could not build AI prompt.\n\n${e.message}`);
    }
  });

  $("#clearAiSourceNotesBtn")?.addEventListener("click", async () => {
    const { allNotes, targetNotes, scope } = await resolveAiClearTargets({ fallbackToAll: true });
    if(!allNotes.length){
      state.lastAiPromptSourceNoteIds = [];
      await refreshAiSourceSummary();
      showToast("No note entries to clear.");
      setAiWizardStatus("No note entries in inbox.");
      return;
    }

    const ok = confirm(`Clear ${scope}? This only removes note entries, not food/exercise logs.`);
    if(!ok) return;

    for(const note of targetNotes){
      await deleteEntry(note.id);
    }

    state.lastAiPromptSourceNoteIds = [];
    const noteInput = $("#noteText");
    if(noteInput) noteInput.value = "";
    renderAiPreview([]);
    await refreshAll();
    showToast(`Cleared ${targetNotes.length} notes.`);
    setAiWizardStatus(`Cleared ${targetNotes.length} note entries from inbox.`);
  });

  $("#previewAiJsonBtn")?.addEventListener("click", async () => {
    const input = $("#aiJsonInput");
    const raw = input?.value?.trim() || "";
    if(!raw){
      showToast("Paste AI JSON first.");
      setAiWizardStatus("Step 2: paste ChatGPT JSON, then tap Preview.");
      return;
    }

    let entries = [];
    try{
      entries = parseAiImport(raw);
    }catch(e){
      alert(`Could not parse AI JSON.\n\n${e.message}`);
      return;
    }

    renderAiPreview(entries);
    setAiWizardStatus(`Step 2 done: previewing ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`);
    showToast(`Preview ready (${entries.length}).`);
  });

  $("#importAiJsonBtn")?.addEventListener("click", async () => {
    const input = $("#aiJsonInput");
    const raw = input?.value?.trim() || "";
    if(!raw){
      showToast("Paste AI JSON first.");
      setAiWizardStatus("Step 2: paste ChatGPT JSON, preview it, then import.");
      return;
    }

    let entries = [];
    try{
      entries = parseAiImport(raw);
    }catch(e){
      alert(`Could not parse AI JSON.\n\n${e.message}`);
      return;
    }

    renderAiPreview(entries);

    const { targetNotes } = await resolveAiClearTargets({ fallbackToAll: false });
    const clearCount = targetNotes.length;
    const clearLabel = clearCount
      ? ` and clear ${clearCount} copied note entr${clearCount === 1 ? "y" : "ies"}`
      : "";
    const ok = confirm(`Import ${entries.length} AI-generated entr${entries.length === 1 ? "y" : "ies"}${clearLabel}?`);
    if(!ok) return;

    for(const e of entries){
      await addEntry(e);
    }

    for(const note of targetNotes){
      await deleteEntry(note.id);
    }

    const importedCount = entries.length;
    const clearedCount = targetNotes.length;
    input.value = "";
    state.lastAiPromptSourceNoteIds = [];
    renderAiPreview([]);
    await refreshAll();
    if(clearedCount){
      showToast(`Imported ${importedCount} and cleared ${clearedCount} notes.`);
      setAiWizardStatus(`Step 3 done: imported ${importedCount} entries and cleared ${clearedCount} copied notes.`);
    }else{
      showToast(`Imported ${importedCount} entr${importedCount === 1 ? "y" : "ies"}.`);
      setAiWizardStatus(`Step 3 done: imported ${importedCount} entries. No copied notes were cleared.`);
    }
  });

  $("#importJsonInput").addEventListener("change", async (evt) => {
    const file = evt.target.files?.[0];
    if(!file) return;
    const ok = confirm("Import backup will replace all existing data on this device. Continue?");
    if(!ok) return;
    await importJson(file);
    evt.target.value = "";
  });

  $("#wipeBtn").addEventListener("click", async () => {
    const ok = confirm("Clear ALL data on this device? This cannot be undone.");
    if(!ok) return;
    await wipeAll();
    await loadGoals();
    await loadTrackers();
    await refreshAll();
    showToast("Cleared.");
  });

  refreshAiSourceSummary().catch(() => {
    // keep settings usable even if summary lookup fails
  });
  renderAiPreview([]);
  setAiWizardStatus("Wizard: Step 1 copy prompt, Step 2 paste + preview JSON, Step 3 import.");
}

function setupInsights(){
  $("#copyUpdateBtn").addEventListener("click", copyUpdate);
}

function setupOfflinePill(){
  const pill = $("#offlinePill");

  const refresh = () => {
    const online = navigator.onLine;
    pill.textContent = online ? "Online" : "Offline";
    pill.classList.toggle("pill--soft", true);
  };

  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}

/** -----------------------------
 *  Service worker
 *  ----------------------------- */

async function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;

  try{
    const reg = await navigator.serviceWorker.register("./sw.js");
    // keep it calm: update in background
    reg.update?.();
  }catch(e){
    // iOS will fail this on http:// (not https). That's okay.
    console.warn("SW registration failed:", e);
  }
}

/** -----------------------------
 *  Refresh
 *  ----------------------------- */

async function refreshAll(){
  await renderToday();
  await renderRepeatChips();
  await renderInsights();
  await refreshAiSourceSummary();
}

/** -----------------------------
 *  Boot
 *  ----------------------------- */

(async function main(){
  setupNav();
  setupRecentLimit();
  setupTimeChips();
  setupQuickActions();
  setupNoteBox();
  setupManualForm();
  setupSettings();
  setupInsights();
  setupTrackers();
  setupOfflinePill();

  await registerServiceWorker();
  await loadGoals();
  await loadTrackers();
  await refreshAll();
})();
