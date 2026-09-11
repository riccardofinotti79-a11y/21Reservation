import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X } from "lucide-react";
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

// Suggested defaults for a fresh table: lunch 12:00–14:30, dinner 19:30–23:00.
function emptyWeek() {
  return Array.from({ length: 7 }, () => ({
    lunchOpen: "12:00",
    lunchClose: "14:30",
    dinnerOpen: "19:30",
    dinnerClose: "23:00",
    closed: false,
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
  week.forEach((d, i) => {
    d.closed = !items.some((h) => h.weekday === i && (h.service_type === "lunch" || h.service_type === "dinner"));
  });
  return week;
}

function parseIntSafe(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : dflt;
}

const HOUR_VALUES = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_STEPS = ["00", "30"];

// Time picker built from two selects: hour (00–23) + minute (only 00 / 30).
// Non-step minute values already saved (legacy) are kept as an extra option.
function TimeField({ value = "", onChange, testId }) {
  const parts = (value || "").split(":");
  const h = parts[0] || "12";
  const m = parts[1] || "00";
  const minutes = MINUTE_STEPS.includes(m) ? MINUTE_STEPS : [m, ...MINUTE_STEPS];
  return (
    <div className="flex gap-1" data-testid={testId}>
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}
              className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-1 py-1.5 bg-white dark:bg-zinc-900">
        {HOUR_VALUES.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}
              className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-1 py-1.5 bg-white dark:bg-zinc-900">
        {minutes.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
    </div>
  );
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
      if (d.closed) {
        slots.forEach((s) => {
          const existing = weekly.find((h) => h.weekday === weekday && h.service_type === s.service_type);
          if (existing) jobs.push(api.delete(`/opening-hours/${existing.id}`));
        });
        return;
      }
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

  // Shift one time column (all days) by delta minutes. Closed days keep their state.
  const nudgeColumn = (field, deltaMin) => {
    setWeek(prev => prev.map((d) => {
      if (d.closed || !d[field]) return d;
      const [h, m] = d[field].split(":").map(Number);
      const total = (h * 60 + m + deltaMin + 24 * 60) % (24 * 60);
      return {
        ...d,
        [field]: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      };
    }));
  };

  const nudgeBtn = (field, delta) => (
    <button type="button" onClick={() => nudgeColumn(field, delta)}
            className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {delta > 0 ? "+" : ""}{delta}
    </button>
  );

  const remove = async (id) => {
    if (!window.confirm("Eliminare?")) return;
    try { await api.delete(`/opening-hours/${id}`); refresh(); toast.success("Eliminato"); }
    catch { toast.error("Errore"); }
  };

  const [editingHour, setEditingHour] = useState(null);

  const saveEdited = async (h) => {
    const isExc = !!h.specific_date;
    const payload = {
      weekday: isExc ? null : Number(editingHour.weekday),
      specific_date: isExc ? editingHour.specific_date : null,
      open_time: editingHour.open_time,
      close_time: editingHour.close_time,
      title: editingHour.title || "",
      service_type: h.service_type || null,
      slot_interval_minutes: parseIntSafe(editingHour.slot_interval_minutes, 15),
      default_duration_minutes: parseIntSafe(editingHour.default_duration_minutes, 120),
      duration_rules: h.duration_rules || [],
      is_closed: isExc ? editingHour.is_closed : false,
      requires_payment: h.requires_payment ?? false,
      payment_amount: h.payment_amount ?? 0,
    };
    try {
      await api.patch(`/opening-hours/${h.id}`, payload);
      toast.success("Modificato");
      setEditingHour(null);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    }
  };

  const inlineEditor = (h) => {
    const isExc = !!h.specific_date;
    return (
      <div key={h.id} className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 space-y-3" data-testid={`hours-inline-edit-${h.id}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {isExc ? (
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.specific_date")}</label>
              <input type="date" value={editingHour.specific_date}
                     onChange={(e) => setEditingHour({ ...editingHour, specific_date: e.target.value })}
                     className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
            </div>
          ) : (
            <div>
              <label className="label-eyebrow block mb-1">{t("hours.weekday")}</label>
              <select value={editingHour.weekday} onChange={(e) => setEditingHour({ ...editingHour, weekday: Number(e.target.value) })}
                      className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5 bg-white dark:bg-zinc-900">
                {WEEKDAY_NAMES[lang].map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label-eyebrow block mb-1">{t("hours.open")}</label>
            <TimeField value={editingHour.open_time} onChange={(v) => setEditingHour({ ...editingHour, open_time: v })} />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">{t("hours.close")}</label>
            <TimeField value={editingHour.close_time} onChange={(v) => setEditingHour({ ...editingHour, close_time: v })} />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Titolo</label>
            <input placeholder="Cena / Pranzo…" value={editingHour.title || ""}
                   onChange={(e) => setEditingHour({ ...editingHour, title: e.target.value })}
                   className="w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1.5 text-xs">
            {t("hours.interval")}
            <input type="text" inputMode="numeric" value={editingHour.slot_interval_minutes}
                   onChange={(e) => setEditingHour({ ...editingHour, slot_interval_minutes: e.target.value })}
                   className="w-16 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1" />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            {t("hours.default_duration")}
            <input type="number" min={30} step={15} value={editingHour.default_duration_minutes}
                   onChange={(e) => setEditingHour({ ...editingHour, default_duration_minutes: e.target.value })}
                   className="w-20 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1" />
          </label>
          {isExc && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={editingHour.is_closed}
                     onChange={(e) => setEditingHour({ ...editingHour, is_closed: e.target.checked })} />
              {t("hours.is_closed")}
            </label>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button data-testid="btn-save-hour-edit" onClick={() => saveEdited(h)}
                    className="px-3 py-1.5 rounded-md bg-zinc-900 text-white text-sm">{t("common.save")}</button>
            <button onClick={() => setEditingHour(null)} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"><X size={14} /></button>
          </div>
        </div>
      </div>
    );
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
                      <th></th>
                    </tr>
                    <tr>
                      <th></th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">
                        {t("hours.open")}
                        <div className="flex gap-1 mt-0.5">{nudgeBtn("lunchOpen", -30)}{nudgeBtn("lunchOpen", 30)}</div>
                      </th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">
                        {t("hours.close")}
                        <div className="flex gap-1 mt-0.5">{nudgeBtn("lunchClose", -30)}{nudgeBtn("lunchClose", 30)}</div>
                      </th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">
                        {t("hours.open")}
                        <div className="flex gap-1 mt-0.5">{nudgeBtn("dinnerOpen", -30)}{nudgeBtn("dinnerOpen", 30)}</div>
                      </th>
                      <th className="text-left px-1 py-1 font-normal text-zinc-500 dark:text-zinc-400">
                        {t("hours.close")}
                        <div className="flex gap-1 mt-0.5">{nudgeBtn("dinnerClose", -30)}{nudgeBtn("dinnerClose", 30)}</div>
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAY_NAMES[lang].map((name, i) => (
                      <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{name}</td>
                        {["lunchOpen", "lunchClose", "dinnerOpen", "dinnerClose"].map((f) => (
                          <td key={f} className="px-1 py-1.5">
                            <TimeField testId={`hours-week-${i}-${f}`} value={week[i][f]}
                                       onChange={setDay(i, f)} />
                          </td>
                        ))}
                        <td className="px-1 py-1.5 whitespace-nowrap">
                          <label className={`flex items-center gap-1.5 text-xs ${week[i].closed ? "text-red-600" : "text-zinc-500"}`}>
                            <input type="checkbox" checked={week[i].closed}
                                   onChange={(e) => setWeek(prev => prev.map((d, j) => j === i ? { ...d, closed: e.target.checked } : d))} />
                            Chiuso
                          </label>
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
              <p className="text-xs text-zinc-500 mt-2">Orari già suggeriti, modificali e spunta "Chiuso" per il giorno senza fasce. I pulsanti +30 / −30 sull'header spostano una colonna intera (tutti i giorni insieme). Intervallo e durata si applicano a tutte le fasce. Minuti disponibili: 00 e 30.</p>
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
            editingHour?.id === h.id ? inlineEditor(h) : (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{WEEKDAY_NAMES[lang][h.weekday]}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 font-mono">{h.open_time} → {h.close_time} · slot {h.slot_interval_minutes}min · {h.default_duration_minutes}min</div>
              </div>
              <div className="flex items-center gap-1">
                <button data-testid={`btn-edit-hour-${h.weekday}`} onClick={() => setEditingHour({ ...h, slot_interval_minutes: String(h.slot_interval_minutes), default_duration_minutes: h.default_duration_minutes })} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><Pencil size={14} /></button>
                <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
              </div>
            </div>
            )
          ))}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 label-eyebrow">{t("hours.exceptions")}</div>
          {exceptions.length === 0 && <div className="p-8 text-center text-zinc-400 dark:text-zinc-500">—</div>}
          {exceptions.sort((a, b) => a.specific_date.localeCompare(b.specific_date)).map((h) => (
            editingHour?.id === h.id ? inlineEditor(h) : (
            <div key={h.id} className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
              <div>
                <div className="text-sm font-medium">{h.specific_date}{h.title ? ` · ${h.title}` : ""}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 font-mono">
                  {h.is_closed ? "Chiuso" : `${h.open_time} → ${h.close_time}`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button data-testid={`btn-edit-hour-exc-${h.specific_date}`} onClick={() => setEditingHour({ ...h, slot_interval_minutes: String(h.slot_interval_minutes), default_duration_minutes: h.default_duration_minutes })} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><Pencil size={14} /></button>
                <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
              </div>
            </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}