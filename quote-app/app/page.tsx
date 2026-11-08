"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Section = {
  id: string;
  name: string;
  feet: string; // kept as string so the input behaves naturally while typing
  rate: string; // blank = use the default price per foot
};

type Saved = {
  company: string;
  client: string;
  rate: string;
  sections: Section[];
};

const PRESETS = ["Full House", "Half House", "Front of House", "Back of House", "Left Side", "Right Side", "Garage"];
const STORAGE_KEY = "quote-app:v1";

const uid = () => Math.random().toString(36).slice(2, 10);
const num = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
const feetFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Smoothly counts a number up/down to its new value. */
function useAnimatedNumber(target: number, duration = 450) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);
  valueRef.current = value;

  useEffect(() => {
    fromRef.current = valueRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(fromRef.current + (target - fromRef.current) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

export default function Home() {
  const [company, setCompany] = useState("Your Company");
  const [client, setClient] = useState("");
  const [rate, setRate] = useState("12");
  const [sections, setSections] = useState<Section[]>([
    { id: uid(), name: "Front of House", feet: "", rate: "" },
  ]);
  const [presenting, setPresenting] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load / save to this device only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        setCompany(s.company ?? "Your Company");
        setClient(s.client ?? "");
        setRate(s.rate ?? "12");
        if (Array.isArray(s.sections) && s.sections.length) setSections(s.sections);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ company, client, rate, sections } satisfies Saved));
    } catch {}
  }, [company, client, rate, sections, loaded]);

  const defaultRate = num(rate);
  const lines = useMemo(
    () =>
      sections.map((s) => {
        const feet = num(s.feet);
        const r = s.rate.trim() ? num(s.rate) : defaultRate;
        return { ...s, feetN: feet, rateN: r, amount: feet * r };
      }),
    [sections, defaultRate]
  );
  const totalFeet = lines.reduce((a, l) => a + l.feetN, 0);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const animatedTotal = useAnimatedNumber(total);

  const update = (id: string, patch: Partial<Section>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => setSections((prev) => prev.filter((s) => s.id !== id));
  const add = (name: string) => {
    setSections((prev) => [...prev, { id: uid(), name, feet: "", rate: "" }]);
    setShowPresets(false);
  };
  const newQuote = () => {
    if (!confirm("Start a new quote? This clears the client and sections.")) return;
    setClient("");
    setSections([{ id: uid(), name: "Front of House", feet: "", rate: "" }]);
  };

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const visibleLines = lines.filter((l) => l.feetN > 0);

  if (presenting) {
    return (
      <main className="present">
        <header className="present-head">
          <div>
            <div className="brand">{company}</div>
            <div className="muted">{today}</div>
          </div>
          <button className="ghost" onClick={() => setPresenting(false)}>
            Edit
          </button>
        </header>

        <section className="present-hero">
          {client && <div className="prepared">Prepared for {client}</div>}
          <div className="label">Project Total</div>
          <div className="hero-total">{money(animatedTotal)}</div>
          <div className="muted">{feetFmt(totalFeet)} linear feet</div>
        </section>

        <section className="breakdown">
          {visibleLines.map((l) => (
            <div className="line" key={l.id}>
              <div>
                <div className="line-name">{l.name || "Section"}</div>
                <div className="muted small">
                  {feetFmt(l.feetN)} ft × {money(l.rateN)}/ft
                </div>
              </div>
              <div className="line-amt">{money(l.amount)}</div>
            </div>
          ))}
          <div className="line total-line">
            <div className="line-name">Total</div>
            <div className="line-amt">{money(total)}</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="top">
        <input
          className="company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          aria-label="Company name"
        />
        <button className="ghost small-btn" onClick={newQuote}>
          New quote
        </button>
      </header>

      <section className="summary card">
        <div className="label">Current Total</div>
        <div className="total">{money(animatedTotal)}</div>
        <div className="summary-row">
          <span>{feetFmt(totalFeet)} ft</span>
          <span className="dot">•</span>
          <span>
            {sections.length} section{sections.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      <section className="card fields">
        <label className="field">
          <span>Client</span>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Client name (optional)"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Price per foot</span>
          <div className="money-input">
            <i>$</i>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.00"
            />
            <i>/ft</i>
          </div>
        </label>
      </section>

      <h2 className="section-title">Sections</h2>

      {lines.map((l) => (
        <section className="card sec" key={l.id}>
          <div className="sec-head">
            <input
              className="sec-name"
              value={l.name}
              onChange={(e) => update(l.id, { name: e.target.value })}
              placeholder="Section name"
            />
            <button className="x" onClick={() => remove(l.id)} aria-label={`Remove ${l.name}`}>
              ×
            </button>
          </div>
          <div className="sec-grid">
            <label className="field">
              <span>Linear feet</span>
              <div className="money-input">
                <input
                  inputMode="decimal"
                  value={l.feet}
                  onChange={(e) => update(l.id, { feet: e.target.value })}
                  placeholder="0"
                />
                <i>ft</i>
              </div>
            </label>
            <label className="field">
              <span>Rate</span>
              <div className="money-input">
                <i>$</i>
                <input
                  inputMode="decimal"
                  value={l.rate}
                  onChange={(e) => update(l.id, { rate: e.target.value })}
                  placeholder={rate || "0"}
                />
                <i>/ft</i>
              </div>
            </label>
          </div>
          <div className="sec-amt">{money(l.amount)}</div>
        </section>
      ))}

      {showPresets ? (
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => add(p)}>
              {p}
            </button>
          ))}
          <button className="chip chip-alt" onClick={() => add("")}>
            Custom…
          </button>
        </div>
      ) : (
        <button className="add" onClick={() => setShowPresets(true)}>
          + Add section
        </button>
      )}

      <div className="spacer" />

      <div className="bottom-bar">
        <button className="primary" onClick={() => setPresenting(true)} disabled={total <= 0}>
          Show Client · {money(total, false)}
        </button>
      </div>
    </main>
  );
}
