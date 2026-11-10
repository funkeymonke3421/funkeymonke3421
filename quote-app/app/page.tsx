"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Slideshow, { type Photo } from "./Slideshow";

type Section = {
  id: string;
  name: string;
  feet: string; // kept as string so the input behaves naturally while typing
  rate: string; // blank = use the default price per foot
};

type Saved = { client: string; rate: string; sections: Section[] };

const PRESETS = [
  "Full House",
  "Half House",
  "Front of House",
  "Back of House",
  "Left Side",
  "Right Side",
  "Garage",
  "Peaks & Gables",
];
const STORAGE_KEY = "shine-quote:v1";

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

/**
 * Odometer-style number: every digit is a vertical reel that rolls to its new value.
 * Reels are keyed from the right so the ones/tens/etc. stay put as the number grows.
 */
function Rolling({ text, className = "" }: { text: string; className?: string }) {
  const chars = text.split("");
  return (
    <span className={`rolling ${className}`} aria-label={text}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (!/\d/.test(ch)) {
          return (
            <span key={`s${key}`} className="roll-static" aria-hidden>
              {ch}
            </span>
          );
        }
        return <Reel key={`d${key}`} digit={Number(ch)} />;
      })}
    </span>
  );
}

/** One digit reel. New reels start at 0 and roll into place. */
function Reel({ digit }: { digit: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const f = requestAnimationFrame(() => setShown(digit));
    return () => cancelAnimationFrame(f);
  }, [digit]);
  return (
    <span className="reel" aria-hidden>
      <span className="reel-strip" style={{ transform: `translateY(-${shown * 10}%)` }}>
        {"0123456789".split("").map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

/** A strand of glowing bulbs that chase along the roofline — a nod to the product. */
function LightStrand({ count = 18 }: { count?: number }) {
  return (
    <div className="strand" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }} />
      ))}
    </div>
  );
}

export default function Home() {
  const [client, setClient] = useState("");
  const [rate, setRate] = useState("");
  const [sections, setSections] = useState<Section[]>([
    { id: uid(), name: "Front of House", feet: "", rate: "" },
  ]);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [presenting, setPresenting] = useState(false);
  const [slides, setSlides] = useState(false);
  // Mockup photos live in memory only — they're gone on refresh, by design.
  const [photos, setPhotos] = useState<Photo[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load / save on this device only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        setClient(s.client ?? "");
        setRate(s.rate ?? "");
        if (Array.isArray(s.sections) && s.sections.length) setSections(s.sections);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ client, rate, sections } satisfies Saved));
    } catch {}
  }, [client, rate, sections, loaded]);

  // On the client screen, start the total at $0 and let it roll up to the real number.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (!presenting) return setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 350);
    return () => clearTimeout(t);
  }, [presenting]);

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

  const update = (id: string, patch: Partial<Section>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => {
    setRemoving((r) => new Set(r).add(id));
    setTimeout(() => {
      setSections((prev) => prev.filter((s) => s.id !== id));
      setRemoving((r) => {
        const n = new Set(r);
        n.delete(id);
        return n;
      });
    }, 280);
  };
  const add = (name: string) => {
    setSections((prev) => [...prev, { id: uid(), name, feet: "", rate: "" }]);
    setShowPresets(false);
  };
  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ id: uid(), url: URL.createObjectURL(f), name: f.name }));
    setPhotos((prev) => [...prev, ...next]);
    if (fileInput.current) fileInput.current.value = ""; // allow re-picking the same photo
  };
  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  const movePhoto = (id: string, dir: -1 | 1) =>
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const startPresentation = () => (photos.length ? setSlides(true) : setPresenting(true));

  const newQuote = () => {
    if (!confirm("Start a new quote? This clears the client, sections and mockups.")) return;
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setClient("");
    setSections([{ id: uid(), name: "Front of House", feet: "", rate: "" }]);
  };

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const visibleLines = lines.filter((l) => l.feetN > 0);

  if (slides) {
    return (
      <Slideshow
        photos={photos}
        client={client}
        onClose={() => setSlides(false)}
        onDone={() => {
          setSlides(false);
          setPresenting(true);
        }}
      />
    );
  }

  if (presenting) {
    return (
      <main className="present">
        <div className="present-bar">
          <span className="muted">{today}</span>
          <div className="bar-actions">
            {photos.length > 0 && (
              <button
                className="ghost"
                onClick={() => {
                  setPresenting(false);
                  setSlides(true);
                }}
              >
                ‹ Mockups
              </button>
            )}
            <button className="ghost" onClick={() => setPresenting(false)}>
              Edit
            </button>
          </div>
        </div>

        <img src="/logo.png" alt="Shine Permanent Lighting" className="logo logo-lg" />
        <LightStrand count={22} />

        <section className="present-hero">
          {client && <div className="prepared">Prepared for {client}</div>}
          <div className="label">Your Investment</div>
          <Rolling className="hero-total" text={money(revealed ? total : 0)} />
          <div className="muted feet-line">{feetFmt(totalFeet)} linear feet of permanent lighting</div>
        </section>

        <section className="breakdown">
          {visibleLines.map((l, i) => (
            <div className="line rise" key={l.id} style={{ animationDelay: `${0.5 + i * 0.12}s` }}>
              <div>
                <div className="line-name">{l.name || "Section"}</div>
                <div className="muted small">
                  {feetFmt(l.feetN)} ft × {money(l.rateN)}/ft
                </div>
              </div>
              <div className="line-amt">{money(l.amount)}</div>
            </div>
          ))}
          <div
            className="line total-line rise"
            style={{ animationDelay: `${0.5 + visibleLines.length * 0.12}s` }}
          >
            <div className="line-name">Total</div>
            <div className="line-amt">{money(total)}</div>
          </div>
        </section>

        <p className="tagline rise" style={{ animationDelay: `${0.8 + visibleLines.length * 0.12}s` }}>
          Every holiday · Every season
        </p>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="top">
        <img src="/logo.png" alt="Shine Permanent Lighting" className="logo" />
        <button className="ghost new-btn" onClick={newQuote}>
          New quote
        </button>
      </header>
      <LightStrand />

      <section className="summary card">
        <div className="label">Current Total</div>
        <Rolling className="total" text={money(total)} />
        <div className="summary-row">
          <span>{feetFmt(totalFeet)} ft</span>
          <span className="dot">✦</span>
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
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
            <i>/ft</i>
          </div>
        </label>
      </section>

      <h2 className="section-title">
        Mockups <span className="title-note">{photos.length ? `${photos.length} · shown before the price` : "optional"}</span>
      </h2>
      <section className="card mockups">
        <div className="thumbs">
          {photos.map((p, i) => (
            <div className="thumb" key={p.id}>
              <img src={p.url} alt={`Mockup ${i + 1}`} />
              <span className="thumb-num">{i + 1}</span>
              <button className="thumb-x" onClick={() => removePhoto(p.id)} aria-label={`Remove mockup ${i + 1}`}>
                ×
              </button>
              {photos.length > 1 && (
                <div className="thumb-move">
                  <button onClick={() => movePhoto(p.id, -1)} disabled={i === 0} aria-label="Move earlier">
                    ‹
                  </button>
                  <button onClick={() => movePhoto(p.id, 1)} disabled={i === photos.length - 1} aria-label="Move later">
                    ›
                  </button>
                </div>
              )}
            </div>
          ))}
          <button className="thumb thumb-add" onClick={() => fileInput.current?.click()}>
            <span>+</span>
            <small>Add photos</small>
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => addPhotos(e.target.files)}
        />
      </section>

      <h2 className="section-title">Sections</h2>

      {lines.map((l) => (
        <div className={`sec-wrap ${removing.has(l.id) ? "leaving" : ""}`} key={l.id}>
          <section className="card sec">
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
            <Rolling className="sec-amt" text={money(l.amount)} />
          </section>
        </div>
      ))}

      {showPresets ? (
        <div className="chips">
          {PRESETS.map((p, i) => (
            <button key={p} className="chip" style={{ animationDelay: `${i * 0.03}s` }} onClick={() => add(p)}>
              {p}
            </button>
          ))}
          <button className="chip chip-alt" style={{ animationDelay: `${PRESETS.length * 0.03}s` }} onClick={() => add("")}>
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
        <button className="primary" onClick={startPresentation} disabled={total <= 0}>
          ✦ {photos.length ? "Start Presentation" : "Show Client"} · {money(total, false)}
        </button>
      </div>
    </main>
  );
}
