import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n, WEEKDAY_NAMES } from "../i18n";

function emptyDraft() {
  return {
    weekday: 0,
    specific_date: "",
    open_time: "19:00",
    close_time: "23:00",
    title: "",
    slot_interval_minutes: 15,
    default_duration_minutes: 120,
    duration_rules: [],
    is_closed: false,
    mode: "weekly", // weekly | exception
  };
}

export default function OpeningHours() {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState(emptyDraft());
  const [showForm, setShowForm] = useState(false);

  const fetchAll = useCallback(async () => (await api.get("/opening-hours")).data, []);
  const { data, refresh } = usePolling(fetchAll, [], 5000);
  const items = data || [];
  const weekly = items.filter((i) => !i.specific_date && i.weekday !== null && i.weekday !== undefined);
  const exceptions = items.filter((i) => !!i.specific_date);

  const save = async () => {
    const payload = { ...draft };
    if (payload.mode === "weekly") { delete payload.specific_date; } else { payload.weekday = null; }
    delete payload.mode;
    try { await api.post("/opening-hours", payload); toast.success("Salvato"); setShowForm(false); setDraft(emptyDraft()); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Eliminare?")) return;
    try { await api.delete(`/opening-hours/${id}`); refresh(); toast.success("Eliminato"); }
    catch { toast.error("Errore"); }
  };

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Config</div>
          <h1 className="font-serif-display text-5xl">{t("nav.hours")}</h1>
        </div>
        <button data-testid="btn-new-hour" onClick={() => { setDraft(emptyDraft()); setShowForm(true); }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700">
          <Plus size={16} /> {t("hours.new")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6" data-testid="hours-form">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.mode === "weekly"} onChange={() => setDraft({ ...draft, mode: "weekly" })}/>
              <span className="text-sm">Settimanale</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.mode === "exception"} onChange={() => setDraft({ ...draft, mode: "exception" })}/>
              <span className="text-sm">Eccezione / data specifica</span>
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {draft.mode === "weekly" ? (
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.weekday")}</label>
                <select data-testid="hours-weekday" value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
                        className="w-full border border-zinc-200 rounded-md px-2 py-1.5">
                  {WEEKDAY_NAMES[lang].map((n, i) => <option key={i} value={i}>{n}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.specific_date")}</label>
                <input data-testid="hours-date" type="date" value={draft.specific_date}
                       onChange={(e) => setDraft({ ...draft, specific_date: e.target.value })}
                       className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
              </div>
            )}
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.open")}</label>
              <input data-testid="hours-open" type="time" value={draft.open_time}
                     onChange={(e) => setDraft({ ...draft, open_time: e.target.value })}
                     className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.close")}</label>
              <input data-testid="hours-close" type="time" value={draft.close_time}
                     onChange={(e) => setDraft({ ...draft, close_time: e.target.value })}
                     className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Titolo</label>
              <input placeholder="Cena / Pranzo…" value={draft.title || ""}
                     onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                     className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.interval")}</label>
              <input type="number" min={5} step={5} value={draft.slot_interval_minutes}
                     onChange={(e) => setDraft({ ...draft, slot_interval_minutes: Number(e.target.value) })}
                     className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.default_duration")}</label>
              <input type="number" min={30} step={15} value={draft.default_duration_minutes}
                     onChange={(e) => setDraft({ ...draft, default_duration_minutes: Number(e.target.value) })}
                     className="w-full border border-zinc-200 rounded-md px-2 py-1.5" />
            </div>
            {draft.mode === "exception" && (
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" checked={draft.is_closed}
                       onChange={(e) => setDraft({ ...draft, is_closed: e.target.checked })}/>
                <span className="text-sm">{t("hours.is_closed")}</span>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-zinc-200">{t("common.cancel")}</button>
            <button data-testid="btn-save-hour" onClick={save} className="px-5 py-2 rounded-md bg-zinc-900 text-white">{t("common.save")}</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 label-eyebrow">{t("hours.title")}</div>
          {weekly.length === 0 && <div className="p-8 text-center text-zinc-400">—</div>}
          {weekly.sort((a, b) => (a.weekday - b.weekday) || a.open_time.localeCompare(b.open_time)).map((h) => (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{WEEKDAY_NAMES[lang][h.weekday]}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 font-mono">{h.open_time} → {h.close_time} · slot {h.slot_interval_minutes}min · {h.default_duration_minutes}min</div>
              </div>
              <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 label-eyebrow">{t("hours.exceptions")}</div>
          {exceptions.length === 0 && <div className="p-8 text-center text-zinc-400">—</div>}
          {exceptions.sort((a, b) => a.specific_date.localeCompare(b.specific_date)).map((h) => (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{h.specific_date}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 font-mono">
                  {h.is_closed ? "Chiuso" : `${h.open_time} → ${h.close_time}`}
                </div>
              </div>
              <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
