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
    slot_interval_minutes: "15",
    default_duration_minutes: 120,
    duration_rules: [],
    is_closed: false,
    mode: "weekly", // weekly | exception
  };
}

function emptyWeek() {
  return Array.from({ length: 7 }, () => ({
    lunchOpen: "",
    lunchClose: "",
    dinnerOpen: "",
    dinnerClose: "",
  }));
}

// Build the 7-row week table from existing opening hours.
// Only rows tagged service_type lunch/dinner are picked up; legacy rows
// without a service_type stay untouched in the list below.
function buildWeek(items) {
  const week = emptyWeek();
  items.forEach((h) => {
    if (h.weekday == null || h.weekday < 0 || h.weekday > 6) return;
    if (h.service_type === "lunch") {
      week[h.weekday].lunchOpen = h.open_time || "";
      week[h.weekday].lunchClose = h.close_time || "";
    } else if (h.service_type === "dinner") {
      week[h.weekday].dinnerOpen = h.open_time || "";
      week[h.weekday].dinnerClose = h.close_time || "";
    }
  });
  return week;
}

function parseIntSafe(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : dflt;
}

export default function OpeningHours() {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [week, setWeek] = useState(emptyWeek());

  const fetchAll = useCallback(async () => (await api.get("/opening-hours")).data, []);
  const { data, refresh } = usePolling(fetchAll, [], 5000);
  const items = data || [];
  const weekly = items.filter((i) => !i.specific_date && i.weekday !== null && i.weekday !== undefined);
  const exceptions = items.filter((i) => !!i.specific_date);

  const openNewForm = () => {
    setDraft(emptyDraft());
    setWeek(buildWeek(items));
    setShowForm(true);
  };

  // --- exception / specific date (single row) ---
  const saveException = async () => {
    const payload = { ...draft, slot_interval_minutes: parseIntSafe(draft.slot_interval_minutes, 15) };
    payload.weekday = null;
    delete payload.mode;
    try {
      await api.post("/opening-hours", payload);
      toast.success("Salvato");
      setShowForm(false);
      setDraft(emptyDraft());
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    }
  };

  // --- whole week: create / update / delete lunch+dinner rows per weekday ---
  const saveWeek = async () => {
    const intervalMin = parseIntSafe(draft.slot_interval_minutes, 15);
    const defaultDuration = parseIntSafe(draft.default_duration_minutes, 120);
    const jobs = [];

    week.forEach((d, weekday) => {
      const slots = [
        { service_type: "lunch", title: t("book.service_lunch"), open: d.lunchOpen, close: d.lunchClose },
        { service_type: "dinner", title: t("book.service_dinner"), open: d.dinnerOpen, close: d.dinnerClose },
      ];
      slots.forEach((s) => {
        const existing = weekly.find((h) => h.weekday === weekday && h.service_type === s.service_type);
        const filled = !!s.open && !!s.close;
        if (filled) {
          const payload = {
            weekday,
            specific_date: null,
            open_time: s.open,
            close_time: s.close,
            title: s.title,
            service_type: s.service_type,
            slot_interval_minutes: intervalMin,
            default_duration_minutes: defaultDuration,
            duration_rules: existing?.duration_rules || [],
            is_closed: false,
            requires_payment: existing?.requires_payment ?? false,
            payment_amount: existing?.payment_amount ?? 0,
          };
          if (existing) {
            jobs.push(api.patch(`/opening-hours/${existing.id}`, payload));
          } else {
            jobs.push(api.post("/opening-hours", payload));
          }
        } else if (existing) {
          jobs.push(api.delete(`/opening-hours/${existing.id}`));
        }
      });
    });

    if (jobs.length === 0) {
      toast.error("Imposta almeno un orario");
      return;
    }
    try {
      await Promise.all(jobs);
      toast.success("Orari settimanali salvati");
      setShowForm(false);
      setDraft(emptyDraft());
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    }
  };

  const save = () => {
    if (draft.mode === "exception") saveException();
    else saveWeek();
  };

  const setDay = (weekday, field) => (e) =>
    setWeek(week.map((d, i) => (i === weekday ? { ...d, [field]: e.target.value } : d)));

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
        <button data-testid="btn-new-hour" onClick={openNewForm}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700">
          <Plus size={16} /> {t("hours.new")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 mb-6" data-testid="hours-form">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.mode === "weekly"} onChange={() => setDraft({ ...draft, mode: "weekly" })}/>
              <span className="text-sm">Settimana intera</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.mode === "exception"} onChange={() => setDraft({ ...draft, mode: "exception" })}/>
              <span className="text-sm">Eccezione / data specifica</span>
            </label>
          </div>

          {draft.mode === "weekly" ? (
            <>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th></th>
                      <th colSpan={2} className="text-left label-eyebrow px-1 py-1">{t("book.service_lunch")}</th>
                      <th colSpan={2} className="text-left label-eyebrow px-1 py-1">{t("book.service_dinner")}</th>
                    </tr>
                    <tr>
                      <th></th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">{t("hours.open")}</th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">{t("hours.close")}</th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">{t("hours.open")}</th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">{t("hours.close")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAY_NAMES[lang].map((name, i) => (
                      <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{name}</td>
                        <td className="px-1 py-1.5">
                          <input data-testid={`hours-week-${i}-lunch-open`} type="time" value={week[i].lunchOpen}
                                 onChange={setDay(i, "lunchOpen")}
                                 className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                        </td>
                        <td className="px-1 py-1.5">
                          <input data-testid={`hours-week-${i}-lunch-close`} type="time" value={week[i].lunchClose}
                                 onChange={setDay(i, "lunchClose")}
                                 className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                        </td>
                        <td className="px-1 py-1.5">
                          <input data-testid={`hours-week-${i}-dinner-open`} type="time" value={week[i].dinnerOpen}
                                 onChange={setDay(i, "dinnerOpen")}
                                 className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                        </td>
                        <td className="px-1 py-1.5">
                          <input data-testid={`hours-week-${i}-dinner-close`} type="time" value={week[i].dinnerClose}
                                 onChange={setDay(i, "dinnerClose")}
                                 className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div>
                  <label className="label-eyebrow block mb-1">{t("hours.interval")}</label>
                  <input data-testid="hours-interval" type="text" inputMode="numeric" value={draft.slot_interval_minutes}
                         onChange={(e) => setDraft({ ...draft, slot_interval_minutes: e.target.value })}
                         className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">{t("hours.default_duration")}</label>
                  <input data-testid="hours-default-duration" type="number" min={30} step={15} value={draft.default_duration_minutes}
                         onChange={(e) => setDraft({ ...draft, default_duration_minutes: e.target.value })}
                         className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-2">Giorni vuoti = fascia chiusa. Intervallo e durata si applicano a tutte le fasce.</p>
              {weekly.some((h) => !h.service_type) && (
                <p className="text-xs text-amber-600 mt-2">
                  Trovate righe settimanali senza servizio (dalla vecchia interfaccia): il salvataggio non le tocca.
                  Eliminale dalla lista qui sotto per evitare fasce duplicate.
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.specific_date")}</label>
                <input data-testid="hours-date" type="date" value={draft.specific_date}
                       onChange={(e) => setDraft({ ...draft, specific_date: e.target.value })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.open")}</label>
                <input data-testid="hours-open" type="time" value={draft.open_time}
                       onChange={(e) => setDraft({ ...draft, open_time: e.target.value })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.close")}</label>
                <input data-testid="hours-close" type="time" value={draft.close_time}
                       onChange={(e) => setDraft({ ...draft, close_time: e.target.value })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Titolo</label>
                <input placeholder="Cena / Pranzo…" value={draft.title || ""}
                       onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.interval")}</label>
                <input type="text" inputMode="numeric" value={draft.slot_interval_minutes}
                       onChange={(e) => setDraft({ ...draft, slot_interval_minutes: e.target.value })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">{t("hours.default_duration")}</label>
                <input type="number" min={30} step={15} value={draft.default_duration_minutes}
                       onChange={(e) => setDraft({ ...draft, default_duration_minutes: Number(e.target.value) })}
                       className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" checked={draft.is_closed}
                       onChange={(e) => setDraft({ ...draft, is_closed: e.target.checked })}/>
                <span className="text-sm">{t("hours.is_closed")}</span>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-800">{t("common.cancel")}</button>
            <button data-testid="btn-save-hour" onClick={save} className="px-5 py-2 rounded-md bg-zinc-900 text-white">{t("common.save")}</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 label-eyebrow">{t("hours.title")}</div>
          {weekly.length === 0 && <div className="p-8 text-center text-zinc-400 dark:text-zinc-500">—</div>}
          {weekly.sort((a, b) => (a.weekday - b.weekday) || a.open_time.localeCompare(b.open_time)).map((h) => (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{WEEKDAY_NAMES[lang][h.weekday]}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 font-mono">{h.open_time} → {h.close_time} · slot {h.slot_interval_minutes}min · {h.default_duration_minutes}min</div>
              </div>
              <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 label-eyebrow">{t("hours.exceptions")}</div>
          {exceptions.length === 0 && <div className="p-8 text-center text-zinc-400 dark:text-zinc-500">—</div>}
          {exceptions.sort((a, b) => a.specific_date.localeCompare(b.specific_date)).map((h) => (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{h.specific_date}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 font-mono">
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