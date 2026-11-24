"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

export type Appearance = { theme: "light" | "dark"; accent: string };
export const appearanceKey = "marketing-os-appearance";
export const defaultAppearance: Appearance = { theme: "light", accent: "#cfe3de" };
const colors = [{ name: "Mint", color: "#cfe3de" }, { name: "Rose", color: "#f7cce1" }, { name: "Lavender", color: "#d9ceea" }, { name: "Butter", color: "#ffe7a1" }, { name: "Sky", color: "#cbdff4" }];

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(appearanceKey) ?? "null");
      if (stored && ["light", "dark"].includes(stored.theme) && /^#[0-9a-f]{6}$/i.test(stored.accent)) setAppearance(stored);
    } catch { /* Keep defaults if storage is unavailable or corrupt. */ }
  }, []);
  function updateAppearance(next: Appearance) {
    setAppearance(next);
    try { localStorage.setItem(appearanceKey, JSON.stringify(next)); } catch { /* Theme still applies for this session. */ }
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.style.setProperty("--accent-color", next.accent);
  }
  return { appearance, updateAppearance };
}

export function AppearanceSettings({ appearance, onChange }: { appearance: Appearance; onChange: (next: Appearance) => void }) {
  const [notice, setNotice] = useState("");
  function update(next: Appearance) { onChange(next); setNotice("Appearance saved on this device."); }
  return <div className="appearance-layout">
    <section className="os-panel appearance-controls">
      <div className="section-heading"><div><span className="eyebrow">MAKE YOURSELF AT HOME</span><h2>A little more you.</h2><p>Choose a theme and make the colors your own.</p></div><span className="round-icon accent"><Icon name="palette" /></span></div>
      <fieldset className="appearance-fieldset"><legend>Interface theme</legend><p>Same workspace. A different atmosphere.</p><div className="theme-options">
        {(["light", "dark"] as const).map(theme => <button type="button" key={theme} aria-pressed={appearance.theme === theme} className={`theme-option ${appearance.theme === theme ? "is-selected" : ""}`} onClick={() => update({ ...appearance, theme })}>
          <span className={`theme-miniature ${theme}`}><span className="mini-rail" /><span className="mini-main"><span /><span /><span /></span></span>
          <span className="theme-option-label"><Icon name={theme === "light" ? "sun" : "moon"} size={18} />{theme === "light" ? "Light" : "Dark"}<span className="selection-dot">{appearance.theme === theme && <Icon name="check" size={12} />}</span></span>
        </button>)}
      </div></fieldset>
      <fieldset className="appearance-fieldset"><legend>Accent color</legend><p>A personal touch for cards, highlights, and controls.</p><div className="accent-options">{colors.map(({ name, color }) => <button key={name} className="accent-option" aria-label={`${name} accent`} aria-pressed={appearance.accent.toLowerCase() === color} onClick={() => update({ ...appearance, accent: color })}><span style={{ background: color }}>{appearance.accent.toLowerCase() === color && <Icon name="check" size={20} />}</span>{name}</button>)}</div>
        <label className="custom-color"><input type="color" value={appearance.accent} aria-label="Custom accent color" onChange={event => update({ ...appearance, accent: event.target.value })} /><span>Something else?<small>Pick a custom color</small></span><code>{appearance.accent.toUpperCase()}</code></label>
      </fieldset>
      <div className="appearance-footer"><span role="status">{notice || "Your preferences are saved automatically on this device."}</span><button className="text-button-os" onClick={() => update(defaultAppearance)}>Reset to default</button></div>
    </section>
    <aside className="appearance-preview"><span className="eyebrow">LIVE PREVIEW</span><h3>Your next fresh start.</h3><p>A calmer space to create, connect, and keep things moving.</p><div className="preview-dashboard"><div className="preview-welcome">Welcome back <span>✳</span></div><div className="preview-tiles"><div className="accent"><Icon name="mail" /><strong>Your next campaign</strong><span className="round-arrow"><Icon name="arrow" size={17} /></span></div><div className="pink"><Icon name="contacts" /><strong>Your audience</strong></div></div><div className="preview-bar"><span className="round-icon"><Icon name="check" size={18} /></span><div><strong>Everything in its place.</strong><small>Made to feel like your workspace.</small></div></div></div><span className="preview-note"><Icon name="check" size={16} /> Changes apply across the dashboard.</span></aside>
  </div>;
}
