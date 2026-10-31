"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const money = (n) => fmt.format(n || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function hm(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function num(v) {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

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

const state = { hourlyRate: 0, editingId: null, editingRate: null, day: localISO(), range: 30 };

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
  window.scrollTo({ top: 0 });
}
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

/* ---------------- form ---------------- */
const form = $("#jobForm");
const f = (name) => form.elements[name];

function formMinutes() {
  return Math.max(0, Math.round(num(f("hours").value) * 60 + num(f("mins").value)));
}
function setMinutes(total) {
  total = Math.max(0, Math.min(1440, total));
  f("hours").value = total >= 60 ? Math.floor(total / 60) : "";
  f("mins").value = total % 60 || "";
}

function rateForForm() {
  return state.editingId ? state.editingRate : state.hourlyRate;
}

function updateLive() {
  const minutes = formMinutes();
  const labor = Math.round((minutes * rateForForm() / 60) * 100) / 100;
  const cost = ["chem", "gas", "ad_spend", "other"].reduce((s, k) => s + num(f(k).value), 0) + labor;
  $("#liveCost").textContent = money(cost);

  const revenue = num(f("revenue").value);
  $("#liveProfitWrap").classList.toggle("hidden", !revenue);
  const p = $("#liveProfit");
  p.textContent = money(revenue - cost);
  p.className = revenue - cost >= 0 ? "pos" : "neg";

  $(".other-note").classList.toggle("hidden", !num(f("other").value) && !f("other_note").value);

  const rate = rateForForm();
  $("#laborHint").textContent = rate
    ? `Includes ${money(labor)} labor (${hm(minutes)} at ${money(rate)}/hr).`
    : "Tip: set an hourly rate in settings ⚙ to include your time in job cost.";
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
  state.editingId = null;
  state.editingRate = null;
  $("#formTitle").textContent = "Log a job";
  $("#saveBtn").textContent = "Save job";
  $("#cancelEdit").classList.add("hidden");
  form.querySelector("details").open = false;
  updateLive();
}

function validate() {
  let bad = null;
  for (const k of ["chem", "gas", "ad_spend", "other", "revenue"]) {
    const v = f(k).value.trim();
    if (v && (!/^\$?\s*[\d,]*\.?\d*$/.test(v) || num(v) < 0)) { bad = bad || f(k); f(k).setAttribute("aria-invalid", "true"); }
  }
  if (!f("date").value) { bad = bad || f("date"); f("date").setAttribute("aria-invalid", "true"); }
  if (bad) { bad.focus(); return "Check the highlighted field."; }
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
    chem: f("chem").value,
    gas: f("gas").value,
    ad_spend: f("ad_spend").value,
    other: f("other").value,
    other_note: f("other_note").value,
    minutes: formMinutes(),
    revenue: f("revenue").value,
    notes: f("notes").value,
  };
  const btn = $("#saveBtn");
  btn.disabled = true;
  try {
    if (state.editingId) {
      await api(`/api/jobs/${state.editingId}`, { method: "PUT", body });
      toast("Job updated");
      const d = body.date;
      resetForm();
      state.day = d;
      show("day");
    } else {
      const job = await api("/api/jobs", { method: "POST", body });
      toast(`Saved · ${money(job.total_cost)}`);
      resetForm();
      f("name").focus();
      loadTodayStrip();
    }
  } catch (ex) {
    $("#formError").textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});

$("#cancelEdit").addEventListener("click", () => { resetForm(false); loadTodayStrip(); });

function editJob(job) {
  state.editingId = job.id;
  state.editingRate = job.labor_rate;
  for (const k of ["date", "name", "other_note", "notes"]) f(k).value = job[k] || "";
  for (const k of ["chem", "gas", "ad_spend", "other", "revenue"]) f(k).value = job[k] ? job[k].toFixed(2) : "";
  setMinutes(job.minutes);
  form.querySelector("details").open = !!job.notes;
  $("#formTitle").textContent = "Edit job";
  $("#saveBtn").textContent = "Save changes";
  $("#cancelEdit").classList.remove("hidden");
  $("#todayStrip").classList.add("hidden");
  show("log");
  updateLive();
}

/* ---------------- today strip (under the form) ---------------- */
async function loadTodayStrip() {
  const strip = $("#todayStrip");
  if (state.editingId) { strip.classList.add("hidden"); return; }
  const date = f("date").value || localISO();
  try {
    const d = await api(`/api/days/${date}`);
    if (!d.jobs.length) { strip.classList.add("hidden"); return; }
    strip.classList.remove("hidden");
    const label = date === localISO() ? "Today" : prettyDate(date);
    strip.innerHTML = `
      <h3><span>${label} · ${d.totals.jobs} job${d.totals.jobs === 1 ? "" : "s"}</span><span>${money(d.totals.total_cost)}</span></h3>
      ${d.jobs.slice(-5).reverse().map((j) => `
        <div class="mini-row"><span>${esc(j.name || "Untitled job")}</span><span>${money(j.total_cost)}</span></div>`).join("")}`;
  } catch { strip.classList.add("hidden"); }
}
f("date").addEventListener("change", loadTodayStrip);

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
    (t.revenue ? kpi("Revenue", money(t.revenue)) + kpi("Profit", money(t.profit), t.profit >= 0 ? "pos" : "neg") : "");

  const list = $("#dayJobs");
  if (!d.jobs.length) {
    list.innerHTML = `<div class="empty">No jobs logged for ${prettyDate(state.day)}.</div>`;
    return;
  }
  list.innerHTML = d.jobs.map((j) => {
    const parts = [
      j.chem && `Chem ${money(j.chem)}`,
      j.gas && `Gas ${money(j.gas)}`,
      j.ad_spend && `Ads ${money(j.ad_spend)}`,
      j.other && `Other ${money(j.other)}${j.other_note ? ` (${esc(j.other_note)})` : ""}`,
      j.minutes && `${hm(j.minutes)}${j.labor ? ` · ${money(j.labor)}` : ""}`,
      j.revenue && `<span class="${j.profit >= 0 ? "pos" : "neg"}">Profit ${money(j.profit)}</span>`,
    ].filter(Boolean);
    return `
      <article class="job" data-id="${j.id}">
        <div class="job-top">
          <span class="job-name">${esc(j.name || "Untitled job")}</span>
          <span class="job-cost">${money(j.total_cost)}</span>
        </div>
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
    const id = +btn.closest(".job").dataset.id;
    const job = d.jobs.find((j) => j.id === id);
    if (btn.dataset.act === "edit") editJob(job);
    if (btn.dataset.act === "del" && confirm(`Delete "${job.name || "Untitled job"}"?`)) {
      await api(`/api/jobs/${id}`, { method: "DELETE" });
      toast("Job deleted");
      loadDay();
    }
  };
}
$("#prevDay").addEventListener("click", () => { state.day = shiftDay(state.day, -1); loadDay(); });
$("#nextDay").addEventListener("click", () => { state.day = shiftDay(state.day, 1); loadDay(); });
$("#dayPicker").addEventListener("change", (e) => { if (e.target.value) { state.day = e.target.value; loadDay(); } });

/* ---------------- insights ---------------- */
const CATS = [
  ["chem", "Chem", "--c-chem"],
  ["gas", "Gas", "--c-gas"],
  ["labor", "Labor", "--c-labor"],
  ["ad_spend", "Ad spend", "--c-ad"],
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
  $("#breakdown").innerHTML = total
    ? `<div class="stack">${CATS.filter(([k]) => t[k]).map(([k, , c]) =>
        `<i style="width:${(t[k] / total) * 100}%;background:var(${c})"></i>`).join("")}</div>` +
      CATS.map(([k, label, c]) => `
        <div class="legend-row">
          <span class="sw" style="background:var(${c})"></span>
          <span class="nm">${label}</span>
          <span class="pct">${Math.round((t[k] / total) * 100)}%</span>
          <span class="amt">${money(t[k])}</span>
        </div>`).join("")
    : `<div class="empty">No costs in this range yet.</div>`;

  // Daily bar chart: one bar per calendar day in range (zero-cost days included).
  const byDate = Object.fromEntries(s.days.map((d) => [d.date, d]));
  const days = [];
  for (let i = 0; i < state.range; i++) days.push(shiftDay(start, i));
  const max = Math.max(...days.map((d) => byDate[d]?.total_cost || 0));
  const chart = $("#dailyChart");
  if (!max) {
    chart.innerHTML = `<div class="empty" style="width:100%">Nothing to chart yet.</div>`;
    chart.nextElementSibling?.classList?.contains("chart-axis") && chart.nextElementSibling.remove();
    return;
  }
  chart.innerHTML = days.map((d) => {
    const v = byDate[d]?.total_cost || 0;
    const jobs = byDate[d]?.jobs || 0;
    return `<div class="bar-wrap" title="${prettyDate(d)}: ${money(v)} · ${jobs} job${jobs === 1 ? "" : "s"}">
      ${v ? `<div class="bar" style="height:${(v / max) * 100}%"></div>` : ""}</div>`;
  }).join("");
  let axis = chart.nextElementSibling;
  if (!axis || !axis.classList.contains("chart-axis")) {
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

/* ---------------- settings ---------------- */
const dlg = $("#settingsDlg");
$("#settingsBtn").addEventListener("click", () => {
  $("#settingsForm").elements.hourly_rate.value = state.hourlyRate ? state.hourlyRate.toFixed(2) : "";
  dlg.showModal();
});
dlg.addEventListener("close", async () => {
  if (dlg.returnValue !== "save") return;
  try {
    const s = await api("/api/settings", {
      method: "PUT", body: { hourly_rate: $("#settingsForm").elements.hourly_rate.value || 0 },
    });
    state.hourlyRate = s.hourly_rate;
    toast("Settings saved");
    updateLive();
  } catch (ex) { toast(ex.message); }
});

/* ---------------- boot ---------------- */
(async function init() {
  f("date").value = localISO();
  try { state.hourlyRate = (await api("/api/settings")).hourly_rate; } catch {}
  updateLive();
  loadTodayStrip();
})();
