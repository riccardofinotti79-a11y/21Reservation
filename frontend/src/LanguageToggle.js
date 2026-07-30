import React from "react";
import { useI18n } from "./i18n";

export default function LanguageToggle({ dark = false }) {
  const { lang, setLang } = useI18n();
  const base = dark
    ? "border-white/15 text-white/80 hover:bg-white/5"
    : "border-zinc-200 text-zinc-700 hover:bg-zinc-50";
  const active = dark ? "bg-white/10 text-white" : "bg-zinc-900 text-white";
  return (
    <div className={`inline-flex overflow-hidden rounded-full border ${base}`} data-testid="lang-toggle">
      {["it", "en"].map((l) => (
        <button
          key={l}
          data-testid={`lang-btn-${l}`}
          onClick={() => setLang(l)}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-colors ${lang === l ? active : ""}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
