"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const money = (n) => fmt.format(n || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round2 = (n) => Math.round(n * 100) / 100;

function localISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function shiftDay(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
}
function prettyDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function hm(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function num(v) {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const blank = (n, digits = 2) => (n ? String(+n.toFixed(digits)) : "");

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

const state = {
  settings: {},
  types: [],            // active job types
  selected: new Set(),  // type ids picked on the form
  editing: null,        // job being edited
  day: localISO(),
  range: 30,
};

/* ---------------- tabs ---------------- */
function show(view) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".tabbar button").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on);
  });
  if (view === "day") loadDay();
  if (view === "insights") loadInsights();
  if (view === "log") loadTodayStrip();
  if (view === "setup") loadSetup();
  window.scrollTo({ top: 0 });
}
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

/* ---------------- form ---------------- */
const form = $("#jobForm");
const f = (name) => form.elements[name];
const MONEY_INPUTS = ["revenue", "other", "ad_extra", "chem_extra", "gas_extra"];

function formMinutes() {
  return Math.max(0, Math.round(num(f("hours").value) * 60 + num(f("mins").value)));
}
function setMinutes(total) {
  total = Math.max(0, Math.min(1440, total));
  f("hours").value = total >= 60 ? Math.floor(total / 60) : "";
  f("mins").value = total % 60 || "";
}
const rates = () => (state.editing ? state.editing.rates : state.settings);

function renderTypePicker() {
  const picker = $("#typePicker");
  // Also show archived types already on a job being edited, so they aren't silently dropped.
  const extra = (state.editing?.types || []).filter((t) => !state.types.some((a) => a.id === t.id));
  const all = [...state.types, ...extra];
  if (!all.length) {
    picker.innerHTML = `<span class="empty-types">No job types yet. <a href="#" data-goto="setup">Add them in Setup</a></span>`;
    return;
  }
  picker.innerHTML = all.map((t) =>
    `<button type="button" data-id="${t.id}" aria-pressed="${state.selected.has(t.id)}">${esc(t.name)}</button>`).join("");
}
$("#typePicker").addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) { e.preventDefault(); show(go.dataset.goto); return; }
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  const id = +b.dataset.id;
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  b.setAttribute("aria-pressed", state.selected.has(id));
});

function liveCosts() {
  const r = rates();
  const minutes = formMinutes();
  const chemRate = num(f("chem_gallons").value) * (r.chem_price || 0);
  const gasRate = r.mpg ? (num(f("miles").value) / r.mpg) * (r.gas_price || 0) : 0;
  const c = {
    chem: round2(chemRate + num(f("chem_extra").value)),
    gas: round2(gasRate + num(f("gas_extra").value)),
    labor: round2((minutes / 60) * (r.hourly_rate || 0)),
    equipment: round2((minutes / 60) * (r.equip_rate || 0)),
    overhead: r.overhead_per_job || 0,
    ads: num(f("ad_extra").value),
    other: num(f("other").value),
  };
  c.total = round2(Object.values(c).reduce((a, b) => a + b, 0));
  c.chemRate = round2(chemRate);
  c.gasRate = round2(gasRate);
  return c;
}

function updateLive() {
  const r = rates();
  const c = liveCosts();
  $("#liveCost").textContent = money(c.total);

  const revenue = num(f("revenue").value);
  $("#liveProfitWrap").classList.toggle("hidden", !revenue);
  const p = $("#liveProfit");
  p.textContent = money(revenue - c.total);
  p.className = revenue - c.total >= 0 ? "pos" : "neg";

  $("#chemCalc").innerHTML = r.chem_price
    ? (num(f("chem_gallons").value) ? `= <b>${money(c.chemRate)}</b> at ${money(r.chem_price)}/gal` : `${money(r.chem_price)}/gal`)
    : `Set chem $/gal in Setup`;
  $("#gasCalc").innerHTML = r.gas_price && r.mpg
    ? (num(f("miles").value) ? `= <b>${money(c.gasRate)}</b> in gas` : `${money(r.gas_price / r.mpg)}/mile`)
    : `Set gas price &amp; MPG in Setup`;

  const parts = [
    c.labor && `labor ${money(c.labor)}`,
    c.equipment && `equipment ${money(c.equipment)}`,
    c.overhead && `overhead ${money(c.overhead)}`,
  ].filter(Boolean);
  const notes = [];
  if (parts.length) notes.push(`Includes ${parts.join(", ")}.`);
  if (!state.editing && state.settings.ad_per_day) notes.push(`Plus a share of your ${money(state.settings.ad_per_day)} daily ad spend.`);
  if (!r.hourly_rate && formMinutes()) notes.push("Set an hourly rate in Setup to count your time.");
  $("#liveBreakdown").textContent = notes.join(" ");

  $(".other-note").classList.toggle("hidden", !num(f("other").value) && !f("other_note").value);
}
form.addEventListener("input", (e) => {
  e.target.removeAttribute("aria-invalid");
  $("#formError").textContent = "";
  updateLive();
});

$$(".chip").forEach((c) => c.addEventListener("click", () => {
  const add = +c.dataset.add;
  setMinutes(add ? formMinutes() + add : 0);
  updateLive();
}));

function resetForm(keepDate = true) {
  const date = f("date").value;
  form.reset();
  f("date").value = keepDate && date ? date : localISO();
  f("miles").value = blank(state.settings.default_miles, 1);
  state.editing = null;
  state.selected = new Set();
  $("#formTitle").textContent = "Log a job";
  $("#saveBtn").textContent = "Save job";
  $("#cancelEdit").classList.add("hidden");
  $$(".legacy").forEach((l) => l.classList.add("hidden"));
  $("#moreCosts").open = false;
  renderTypePicker();
  updateLive();
}

function validate() {
  let bad = null;
  const mark = (el) => { bad = bad || el; el.setAttribute("aria-invalid", "true"); };
  for (const k of [...MONEY_INPUTS, "chem_gallons", "miles"]) {
    const v = f(k).value.trim();
    if (v && !/^\$?\s*[\d,]*\.?\d*$/.test(v)) mark(f(k));
  }
  if (!f("date").value) mark(f("date"));
  if (bad) {
    if (bad.closest("details")) bad.closest("details").open = true;
    bad.focus();
    return "Check the highlighted field.";
  }
  if (formMinutes() > 1440) return "Time can't be more than 24 hours.";
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = validate();
  if (err) { $("#formError").textContent = err; return; }

  const body = {
    date: f("date").value,
    name: f("name").value,
    type_ids: [...state.selected],
    chem_gallons: f("chem_gallons").value,
    miles: f("miles").value,
    minutes: formMinutes(),
    revenue: f("revenue").value,
    other: f("other").value,
    other_note: f("other_note").value,
    ad_extra: f("ad_extra").value,
    chem_extra: f("chem_extra").value,
    gas_extra: f("gas_extra").value,
    notes: f("notes").value,
  };
  const btn = $("#saveBtn");
  btn.disabled = true;
  try {
    if (state.editing) {
      await api(`/api/jobs/${state.editing.id}`, { method: "PUT", body });
      toast("Job updated");
      resetForm();
      state.day = body.date;
      show("day");
    } else {
      const job = await api("/api/jobs", { method: "POST", body });
      toast(`Saved · ${money(job.total_cost)}`);
      resetForm();
      loadTodayStrip();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  } catch (ex) {
    $("#formError").textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});

$("#cancelEdit").addEventListener("click", () => { resetForm(false); loadTodayStrip(); });

function editJob(job) {
  state.editing = job;
  state.selected = new Set(job.types.map((t) => t.id));
  for (const k of ["date", "name", "other_note", "notes"]) f(k).value = job[k] || "";
  f("revenue").value = blank(job.revenue);
  f("other").value = blank(job.other);
  f("ad_extra").value = blank(job.ad_extra);
  f("chem_extra").value = blank(job.chem_extra);
  f("gas_extra").value = blank(job.gas_extra);
  f("chem_gallons").value = blank(job.chem_gallons);
  f("miles").value = blank(job.miles, 1);
  setMinutes(job.minutes);
  $$(".legacy").forEach((l) => l.classList.toggle("hidden", !num(l.querySelector("input").value)));
  $("#moreCosts").open = !!(job.other || job.ad_extra || job.chem_extra || job.gas_extra || job.notes);
  $("#formTitle").textContent = "Edit job";
  $("#saveBtn").textContent = "Save changes";
  $("#cancelEdit").classList.remove("hidden");
  $("#todayStrip").classList.add("hidden");
  renderTypePicker();
  show("log");
  updateLive();
}

/* ---------------- today strip (under the form) ---------------- */
async function loadTodayStrip() {
  const strip = $("#todayStrip");
  if (state.editing) { strip.classList.add("hidden"); return; }
  const date = f("date").value || localISO();
  try {
    const d = await api(`/api/days/${date}`);
    if (!d.jobs.length) { strip.classList.add("hidden"); return; }
    strip.classList.remove("hidden");
    const label = date === localISO() ? "Today" : prettyDate(date);
    strip.innerHTML = `
      <h3><span>${label} · ${plural(d.totals.jobs, "job")}</span><span>${money(d.totals.total_cost)}</span></h3>
      ${d.jobs.slice(-5).reverse().map((j) => `
        <div class="mini-row"><span>${esc(jobTitle(j))}</span><span>${money(j.total_cost)}</span></div>`).join("")}`;
  } catch { strip.classList.add("hidden"); }
}
f("date").addEventListener("change", loadTodayStrip);

function jobTitle(j) {
  return j.name || j.types.map((t) => t.name).join(" + ") || "Untitled job";
}

/* ---------------- day view ---------------- */
function kpi(label, value, cls = "") {
  return `<div class="kpi"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

async function loadDay() {
  $("#dayPicker").value = state.day;
  const d = await api(`/api/days/${state.day}`);
  const t = d.totals;
  $("#dayKpis").innerHTML =
    kpi("Total cost", money(t.total_cost)) +
    kpi("Jobs", t.jobs) +
    kpi("Avg / job", money(t.jobs ? t.total_cost / t.jobs : 0)) +
    kpi("Time", hm(t.minutes)) +
    (t.revenue ? kpi("Revenue", money(t.revenue)) + kpi("Profit", money(t.profit), t.profit >= 0 ? "pos" : "neg")
               : kpi("Miles", t.miles) + kpi("Chem", `${t.chem_gallons} gal`));

  const adForm = $("#adDayForm");
  adForm.classList.toggle("hidden", !d.jobs.length);
  if (d.jobs.length) {
    const amt = d.ad_per_day || 0;
    adForm.elements.ad_per_day.value = amt ? amt.toFixed(2) : "";
    $("#adDayHint").textContent = amt
      ? `Split across ${plural(d.jobs.length, "job")} (about ${money(amt / d.jobs.length)} each).`
      : "No daily ad spend counted for this day.";
  }

  const list = $("#dayJobs");
  if (!d.jobs.length) {
    list.innerHTML = `<div class="empty">No jobs logged for ${prettyDate(state.day)}.</div>`;
    return;
  }
  list.innerHTML = d.jobs.map((j) => {
    const parts = [
      j.chem && `Chem ${j.chem_gallons ? `${j.chem_gallons} gal · ` : ""}${money(j.chem)}`,
      j.gas && `Gas ${j.miles ? `${j.miles} mi · ` : ""}${money(j.gas)}`,
      !j.gas && j.miles && `${j.miles} mi`,
      j.minutes && `${hm(j.minutes)}${j.labor ? ` · ${money(j.labor)}` : ""}`,
      j.equipment && `Equip ${money(j.equipment)}`,
      j.ad_spend && `Ads ${money(j.ad_spend)}`,
      j.overhead && `Overhead ${money(j.overhead)}`,
      j.other && `Other ${money(j.other)}${j.other_note ? ` (${esc(j.other_note)})` : ""}`,
      j.revenue && `<span class="${j.profit >= 0 ? "pos" : "neg"}">Profit ${money(j.profit)}</span>`,
    ].filter(Boolean);
    return `
      <article class="job" data-id="${j.id}">
        <div class="job-top">
          <span class="job-name">${esc(j.name || "Untitled job")}</span>
          <span class="job-cost">${money(j.total_cost)}</span>
        </div>
        ${j.types.length ? `<div class="job-types">${j.types.map((t) => `<span>${esc(t.name)}</span>`).join("")}</div>` : ""}
        <div class="job-meta">${parts.map((p) => `<span>${p}</span>`).join("") || "<span>No costs entered</span>"}</div>
        ${j.notes ? `<div class="job-meta">${esc(j.notes)}</div>` : ""}
        <div class="job-actions">
          <button data-act="edit">Edit</button>
          <button data-act="del" class="del">Delete</button>
        </div>
      </article>`;
  }).join("");

  list.onclick = async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const job = d.jobs.find((j) => j.id === +btn.closest(".job").dataset.id);
    if (btn.dataset.act === "edit") editJob(job);
    if (btn.dataset.act === "del" && confirm(`Delete "${jobTitle(job)}"?`)) {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      toast("Job deleted");
      loadDay();
    }
  };
}
$("#prevDay").addEventListener("click", () => { state.day = shiftDay(state.day, -1); loadDay(); });
$("#nextDay").addEventListener("click", () => { state.day = shiftDay(state.day, 1); loadDay(); });
$("#dayPicker").addEventListener("change", (e) => { if (e.target.value) { state.day = e.target.value; loadDay(); } });
$("#adDayForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/api/days/${state.day}/ad`, { method: "PUT", body: { ad_per_day: e.target.elements.ad_per_day.value || 0 } });
    toast("Ad spend updated");
    loadDay();
  } catch (ex) { toast(ex.message); }
});

/* ---------------- insights ---------------- */
const CATS = [
  ["chem", "Chem", "--c-chem"],
  ["gas", "Gas", "--c-gas"],
  ["labor", "Labor", "--c-labor"],
  ["equipment", "Equipment", "--c-equip"],
  ["ad_spend", "Ad spend", "--c-ad"],
  ["overhead", "Overhead", "--c-overhead"],
  ["other", "Other", "--c-other"],
];

async function loadInsights() {
  const end = localISO();
  const start = shiftDay(end, -(state.range - 1));
  const s = await api(`/api/summary?start=${start}&end=${end}`);
  const t = s.totals;

  $("#insKpis").innerHTML =
    kpi("Total cost", money(t.total_cost)) +
    kpi("Jobs", t.jobs) +
    kpi("Avg / job", money(t.avg_cost_per_job)) +
    kpi("Avg / work day", money(t.avg_cost_per_day)) +
    kpi("Jobs / day", t.avg_jobs_per_day) +
    (t.revenue ? kpi("Profit", money(t.profit), t.profit >= 0 ? "pos" : "neg") : kpi("Time", hm(t.minutes)));

  const total = t.total_cost;
  const cats = CATS.filter(([k]) => t[k]);
  $("#breakdown").innerHTML = total
    ? `<div class="stack">${cats.map(([k, , c]) =>
        `<i style="width:${(t[k] / total) * 100}%;background:var(${c})"></i>`).join("")}</div>` +
      cats.map(([k, label, c]) => `
        <div class="legend-row">
          <span class="sw" style="background:var(${c})"></span>
          <span class="nm">${label}</span>
          <span class="pct">${Math.round((t[k] / total) * 100)}%</span>
          <span class="amt">${money(t[k])}</span>
        </div>`).join("")
    : `<div class="empty">No costs in this range yet.</div>`;

  const multi = s.by_type.reduce((n, x) => n + x.jobs, 0) > t.jobs;
  $("#byType").innerHTML = s.by_type.length
    ? s.by_type.map((x) => `
        <div class="type-row">
          <span class="nm">${esc(x.name)}</span>
          <span class="amt">${money(x.total_cost)}</span>
          <span class="sub">${plural(x.jobs, "job")} · avg cost ${money(x.avg_cost_per_job)}${
            x.revenue ? ` · avg price ${money(x.avg_revenue_per_job)} · <span class="${x.profit >= 0 ? "pos" : "neg"}">profit ${money(x.profit)}</span>` : ""}</span>
        </div>`).join("") +
      (multi ? `<p class="muted small">Jobs with more than one type count toward each type.</p>` : "")
    : `<div class="empty">No jobs in this range yet.</div>`;

  // Daily bar chart: one bar per calendar day in range (zero-cost days included).
  const byDate = Object.fromEntries(s.days.map((d) => [d.date, d]));
  const days = Array.from({ length: state.range }, (_, i) => shiftDay(start, i));
  const max = Math.max(...days.map((d) => byDate[d]?.total_cost || 0));
  const chart = $("#dailyChart");
  let axis = chart.nextElementSibling;
  if (!max) {
    chart.innerHTML = `<div class="empty" style="width:100%">Nothing to chart yet.</div>`;
    if (axis?.classList.contains("chart-axis")) axis.remove();
    return;
  }
  chart.innerHTML = days.map((d) => {
    const v = byDate[d]?.total_cost || 0;
    const jobs = byDate[d]?.jobs || 0;
    return `<div class="bar-wrap" title="${prettyDate(d)}: ${money(v)} · ${plural(jobs, "job")}">
      ${v ? `<div class="bar" style="height:${(v / max) * 100}%"></div>` : ""}</div>`;
  }).join("");
  if (!axis?.classList.contains("chart-axis")) {
    axis = document.createElement("div");
    axis.className = "chart-axis";
    chart.after(axis);
  }
  axis.innerHTML = `<span>${prettyDate(start)}</span><span>peak ${money(max)}</span><span>${prettyDate(end)}</span>`;
}
$$(".seg button").forEach((b) => b.addEventListener("click", () => {
  $$(".seg button").forEach((x) => x.classList.toggle("on", x === b));
  state.range = +b.dataset.range;
  loadInsights();
}));

/* ---------------- setup ---------------- */
const ratesForm = $("#ratesForm");
const RATE_DIGITS = { mpg: 1, default_miles: 1 };

function renderTypeList() {
  $("#typeList").innerHTML = state.types.length
    ? state.types.map((t) => `<span class="type-tag">${esc(t.name)}<button type="button" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">×</button></span>`).join("")
    : `<span class="muted small">Add the kinds of work you do. You'll tap them on each job.</span>`;
}

function updatePerMile() {
  const g = num(ratesForm.elements.gas_price.value), m = num(ratesForm.elements.mpg.value);
  $("#perMile").textContent = g && m ? `That's about ${money(g / m)} per mile in gas.` : "";
}

function loadSetup() {
  for (const [k, v] of Object.entries(state.settings)) {
    if (!ratesForm.elements[k]) continue;
    ratesForm.elements[k].value = k in RATE_DIGITS ? blank(v, RATE_DIGITS[k]) : (v ? v.toFixed(2) : "");
  }
  $("#ratesError").textContent = "";
  renderTypeList();
  updatePerMile();
}
ratesForm.addEventListener("input", (e) => {
  e.target.removeAttribute("aria-invalid");
  updatePerMile();
});
ratesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  for (const k of Object.keys(state.settings)) {
    const el = ratesForm.elements[k];
    if (!el) continue;
    if (el.value.trim() && !/^\$?\s*[\d,]*\.?\d*$/.test(el.value.trim())) {
      el.setAttribute("aria-invalid", "true");
      el.focus();
      $("#ratesError").textContent = "Check the highlighted field.";
      return;
    }
    body[k] = el.value || 0;
  }
  try {
    state.settings = await api("/api/settings", { method: "PUT", body });
    $("#ratesError").textContent = "";
    toast("Setup saved");
    if (!state.editing) resetForm();
    loadSetup();
  } catch (ex) { $("#ratesError").textContent = ex.message; }
});

$("#addTypeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  try {
    await api("/api/job-types", { method: "POST", body: { name } });
    input.value = "";
    await refreshTypes();
    toast(`Added "${name}"`);
  } catch (ex) { toast(ex.message); }
});
$("#typeList").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  const t = state.types.find((x) => x.id === +b.dataset.id);
  if (!confirm(`Remove "${t.name}" from the list? Past jobs keep it.`)) return;
  await api(`/api/job-types/${t.id}`, { method: "DELETE" });
  state.selected.delete(t.id);
  await refreshTypes();
});

async function refreshTypes() {
  state.types = await api("/api/job-types");
  renderTypeList();
  renderTypePicker();
}

/* ---------------- boot ---------------- */
(async function init() {
  f("date").value = localISO();
  try {
    [state.settings, state.types] = await Promise.all([api("/api/settings"), api("/api/job-types")]);
  } catch (ex) { toast(ex.message); }
  resetForm();
  loadTodayStrip();
})();
