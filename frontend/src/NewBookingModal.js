import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, Sparkles } from "lucide-react";
import api from "./api";
import { useI18n } from "./i18n";

const STATUSES = ["pending", "accepted", "seated", "declined", "no_show", "cancelled"];
const SOURCES = ["phone", "online", "walkin"];

function todayStr() { return new Date().toISOString().slice(0, 10); }

const inputCls = "w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10";

export default function NewBookingModal({ open, onClose, onCreated, defaultDate, tables = [], areas = [], booking = null, customers = [] }) {
  const { t } = useI18n();
  const isEdit = !!booking;
  const [form, setForm] = useState(() => ({
    date: defaultDate || todayStr(),
    time: "20:00",
    persons: 2,
    duration_minutes: "",
    source: "phone",
    status: "accepted",
    table_ids: [],
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    guest_message: "",
    internal_note: "",
  }));
  const [suggestion, setSuggestion] = useState(null);
  const [busy, setBusy] = useState(false);

  // Sync form with the incoming booking when the modal opens in edit mode
  useEffect(() => {
    if (!open) return;
    if (booking) {
      const c = customers.find((x) => x.id === booking.customer_id);
      setForm({
        date: booking.date,
        time: booking.time,
        persons: booking.persons,
        duration_minutes: booking.duration_minutes ?? "",
        source: booking.source || "phone",
        status: booking.status || "accepted",
        table_ids: booking.table_ids || [],
        customer_name: c?.name || "",
        customer_phone: c?.phone || "",
        customer_email: c?.email || "",
        guest_message: booking.guest_message || "",
        internal_note: booking.internal_note || "",
      });
    } else {
      setForm((f) => ({ ...f, date: defaultDate || todayStr(), table_ids: [] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  // Lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const areaById = useMemo(() => {
    const m = {}; (areas || []).forEach((a) => (m[a.id] = a)); return m;
  }, [areas]);

  const requestSuggestion = async () => {
    try {
      const { data } = await api.get("/availability/suggest-tables", {
        params: {
          date: form.date, time: form.time, persons: form.persons,
          duration_minutes: form.duration_minutes || undefined,
        },
      });
      setSuggestion(data);
      if (data.suggested && form.table_ids.length === 0) {
        set("table_ids", [data.suggested]);
      }
    } catch (e) {
      toast.error("Impossibile calcolare disponibilità");
    }
  };

  useEffect(() => {
    if (open) {
      setSuggestion(null);
      requestSuggestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.date, form.time, form.persons]);

  if (!open) return null;

  const toggleTable = (id) => {
    set("table_ids", form.table_ids.includes(id)
      ? form.table_ids.filter((x) => x !== id)
      : [...form.table_ids, id]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!isEdit && !form.customer_name && !form.customer_phone && !form.customer_email) {
      toast.error("Serve almeno un dato cliente");
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        const patch = {
          date: form.date,
          time: form.time,
          persons: Number(form.persons),
          duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : undefined,
          source: form.source,
          status: form.status,
          table_ids: form.table_ids,
          guest_message: form.guest_message || undefined,
          internal_note: form.internal_note || undefined,
        };
        const { data } = await api.patch(`/bookings/${booking.id}`, patch);
        toast.success("Prenotazione aggiornata");
        onCreated?.(data);
      } else {
        const payload = {
          date: form.date,
          time: form.time,
          persons: Number(form.persons),
          duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : undefined,
          source: form.source,
          status: form.status,
          table_ids: form.table_ids.length ? form.table_ids : undefined,
          customer_name: form.customer_name || undefined,
          customer_phone: form.customer_phone || undefined,
          customer_email: form.customer_email || undefined,
          guest_message: form.guest_message || undefined,
          internal_note: form.internal_note || undefined,
        };
        const { data } = await api.post("/bookings", payload);
        toast.success("Prenotazione creata");
        onCreated?.(data);
      }
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4 overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onClick={onClose}
      data-testid="new-booking-modal"
    >
      <div
        className="w-full sm:max-w-3xl h-full sm:h-auto max-h-full sm:max-h-[92vh] bg-white dark:bg-zinc-900 rounded-none sm:rounded-lg shadow-2xl border-0 sm:border sm:border-zinc-200 sm:dark:border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <div className="min-w-0">
            <div className="label-eyebrow">21Reservation</div>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-zinc-900 dark:text-zinc-100 truncate">
              {isEdit ? "Modifica prenotazione" : t("common.new_booking")}
            </h2>
          </div>
          <button data-testid="modal-close" onClick={onClose}
                  className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-md flex items-center justify-center shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <form id="new-booking-form" onSubmit={submit}
              className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          <div>
            <label className="label-eyebrow mb-1 block">{t("common.date")}</label>
            <input data-testid="nb-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
                   className={inputCls} required />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">{t("common.time")}</label>
            <input data-testid="nb-time" type="time" value={form.time} onChange={(e) => set("time", e.target.value)}
                   className={inputCls} required />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">{t("common.persons")}</label>
            <input data-testid="nb-persons" type="number" min={1} max={40} value={form.persons}
                   onChange={(e) => set("persons", e.target.value)}
                   className={inputCls} required />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">{t("common.duration")}</label>
            <input data-testid="nb-duration" type="number" placeholder={suggestion?.duration_minutes || "auto"}
                   value={form.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)}
                   className={inputCls} />
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="label-eyebrow">{t("common.tables")}</label>
              {suggestion?.suggested && (
                <button type="button" onClick={() => set("table_ids", [suggestion.suggested])}
                        className="text-xs inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100" data-testid="nb-use-suggestion">
                  <Sparkles size={12} /> Suggerito
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border border-zinc-200 dark:border-zinc-800 rounded-md p-3 max-h-40 overflow-y-auto bg-zinc-50 dark:bg-zinc-800/60">
              {tables.length === 0 && <div className="text-xs text-zinc-500 dark:text-zinc-400">Nessun tavolo configurato</div>}
              {tables.map((tb) => {
                const isCandidate = suggestion?.candidates?.includes(tb.id);
                const isSelected = form.table_ids.includes(tb.id);
                return (
                  <button type="button" key={tb.id} onClick={() => toggleTable(tb.id)}
                          data-testid={`nb-table-${tb.name}`}
                          className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                            isSelected ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                              : isCandidate ? "border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40"
                              : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 opacity-60"
                          }`}>
                    {tb.name} · {tb.seats_min}-{tb.seats_max}p
                    <span className="ml-1 text-[10px] opacity-70">{areaById[tb.area_id]?.name || ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label-eyebrow mb-1 block">{t("common.status")}</label>
            <select data-testid="nb-status" value={form.status} onChange={(e) => set("status", e.target.value)}
                    className={inputCls}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">{t("common.source")}</label>
            <select data-testid="nb-source" value={form.source} onChange={(e) => set("source", e.target.value)}
                    className={inputCls}>
              {SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
            </select>
          </div>

          <div className="md:col-span-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <div className="label-eyebrow mb-2">Cliente</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input data-testid="nb-customer-name" placeholder={t("common.name")} value={form.customer_name}
                     onChange={(e) => set("customer_name", e.target.value)} className={inputCls} />
              <input data-testid="nb-customer-phone" placeholder={t("common.phone")} value={form.customer_phone}
                     onChange={(e) => set("customer_phone", e.target.value)} className={inputCls} />
              <input data-testid="nb-customer-email" type="email" placeholder={t("common.email")} value={form.customer_email}
                     onChange={(e) => set("customer_email", e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="label-eyebrow mb-1 block">{t("common.message")}</label>
            <textarea data-testid="nb-guest-message" value={form.guest_message}
                      onChange={(e) => set("guest_message", e.target.value)} rows={2}
                      className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className="label-eyebrow mb-1 block">Nota interna</label>
            <textarea data-testid="nb-internal-note" value={form.internal_note}
                      onChange={(e) => set("internal_note", e.target.value)} rows={2}
                      className={inputCls} />
          </div>
        </form>

        {/* Sticky footer */}
        <div className="flex items-center justify-end gap-3 p-4 sm:p-5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            {t("common.cancel")}
          </button>
          <button data-testid="nb-submit" type="submit" form="new-booking-form" disabled={busy}
                  className="px-5 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-white text-white dark:text-zinc-900 font-semibold disabled:opacity-50 transition-colors">
            {busy ? "…" : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
