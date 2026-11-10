"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Photo = { id: string; url: string; name: string };

/**
 * Full-screen mockup slideshow. Swipe (native scroll-snap) or use the buttons / arrow keys.
 * The last slide's button hands off to the price reveal.
 */
export default function Slideshow({
  photos,
  client,
  onDone,
  onClose,
}: {
  photos: Photo[];
  client: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = photos.length - 1;

  const go = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(i, el.children.length - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }, []);

  // Keep the counter in sync with swipes.
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") index >= last ? onDone() : go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, go, onDone, onClose]);

  return (
    <main className="show">
      <header className="show-bar">
        <button className="ghost" onClick={onClose} aria-label="Close slideshow">
          ✕
        </button>
        <img src="/logo.png" alt="Shine Permanent Lighting" className="show-logo" />
        <span className="show-count">
          {index + 1} / {photos.length}
        </span>
      </header>

      {client && <div className="show-client">Your home, {client}</div>}

      <div className="show-track" ref={track} onScroll={onScroll}>
        {photos.map((p, i) => (
          <figure className={`slide ${i === index ? "active" : ""}`} key={p.id}>
            {/* blurred copy fills the screen behind the full, uncropped mockup */}
            <div className="slide-bg" style={{ backgroundImage: `url(${p.url})` }} aria-hidden />
            <img src={p.url} alt={`Mockup ${i + 1}`} draggable={false} />
          </figure>
        ))}
      </div>

      <footer className="show-foot">
        <div className="show-dots" aria-hidden>
          {photos.map((p, i) => (
            <button key={p.id} className={i === index ? "on" : ""} onClick={() => go(i)} tabIndex={-1} />
          ))}
        </div>
        <div className="show-nav">
          <button className="ghost show-prev" onClick={() => go(index - 1)} disabled={index === 0}>
            ‹ Back
          </button>
          {index >= last ? (
            <button className="primary show-next" onClick={onDone}>
              ✦ See Your Quote
            </button>
          ) : (
            <button className="primary show-next" onClick={() => go(index + 1)}>
              Next ›
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
