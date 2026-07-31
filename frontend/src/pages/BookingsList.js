import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, X as XIcon, UserCheck, Ghost } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";
import StatusBadge from "../StatusBadge";
import NewBookingModal from "../NewBookingModal";

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function BookingsList() {
  const { t, lang } = useI18n();
  const [date, setDate] = useState(todayStr());
  const [modalOpen, setModalOpen] = useState(false);

  const fetchBookings = useCallback(async () => {
    const [b, tb, ar, cu] = await Promise.all([
      api.get("/bookings", { params: { date } }),
      api.get("/tables"),
      api.get("/areas"),
      api.get("/customers"),
    ]);
    return { bookings: b.data, tables: tb.data, areas: ar.data, customers: cu.data };
  }, [date]);

  const { data, refresh } = usePolling(fetchBookings, [date], 5000);
  const bookings = data?.bookings || [];
  const tables = data?.tables || [];
  const customers = data?.customers || [];
  const [editingBooking, setEditingBooking] = useState(null);
  const openEdit = (b) => { setEditingBooking(b); setModalOpen(true); };
  const openNew = () => { setEditingBooking(null); setModalOpen(true); };
  const stop = (e) => { e.stopPropagation(); };
  const customerById = useMemo(() => {
    const m = {}; customers.forEach((c) => (m[c.id] = c)); return m;
  }, [customers]);
  const tableById = useMemo(() => {
    const m = {}; tables.forEach((t) => (m[t.id] = t)); return m;
  }, [tables]);

  const totalGuests = bookings
    .filter((b) => ["pending", "accepted", "seated"].includes(b.status))
    .reduce((s, b) => s + b.persons, 0);

  const setStatus = async (id, status) => {
    try { await api.post(`/bookings/${id}/status`, { status }); toast.success("Aggiornato"); refresh(); }
    catch { toast.error("Errore"); }
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
        <div>
          <div className="label-eyebrow">{t("nav.bookings")}</div>
          <h1 className="font-serif-display text-5xl">{t("nav.list")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <input data-testid="list-date-picker" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="border border-zinc-200 rounded-md px-3 py-2 bg-white" />
          <button data-testid="list-today-btn" onClick={() => setDate(todayStr())}
                  className="px-3 py-2 border border-zinc-200 rounded-md text-sm hover:bg-zinc-100">
            {t("common.today")}
          </button>
          <button data-testid="list-new-booking" onClick={openNew}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors">
            <Plus size={16} /> {t("common.new_booking")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_bookings")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="stat-bookings">{bookings.length}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_guests")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="stat-guests">{totalGuests}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("status.pending")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="stat-pending">
            {bookings.filter((b) => b.status === "pending").length}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("status.seated")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="stat-seated">
            {bookings.filter((b) => b.status === "seated").length}
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.time")}</th>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.name")}</th>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.persons")}</th>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.table")}</th>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.source")}</th>
              <th className="text-left px-4 py-3 label-eyebrow">{t("common.status")}</th>
              <th className="text-right px-4 py-3 label-eyebrow">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody data-testid="bookings-tbody">
            {bookings.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-zinc-400">
                Nessuna prenotazione per questa data
              </td></tr>
            )}
            {bookings
              .slice()
              .sort((a, b) => a.time.localeCompare(b.time))
              .map((b) => {
                const c = customerById[b.customer_id];
                const tbls = (b.table_ids || []).map((id) => tableById[id]?.name || id).join(", ");
                return (
                  <tr key={b.id}
                      onClick={() => openEdit(b)}
                      className="border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors cursor-pointer"
                      data-testid={`booking-row-${b.id}`}>
                    <td className="px-4 py-3 font-mono">{b.time}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900">{c?.name || "—"}</div>
                      <div className="text-xs text-zinc-500">{c?.phone || c?.email || ""}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">{b.persons}</td>
                    <td className="px-4 py-3">{tbls || "—"}</td>
                    <td className="px-4 py-3 text-xs uppercase text-zinc-500 tracking-wider">{t(`source.${b.source}`)}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3" onClick={stop}>
                      <div className="flex items-center justify-end gap-1">
                        {b.status === "pending" && (
                          <>
                            <button data-testid={`action-accept-${b.id}`} title={t("status.accepted")}
                                    onClick={(e) => { stop(e); setStatus(b.id, "accepted"); }}
                                    className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700">
                              <Check size={16} />
                            </button>
                            <button data-testid={`action-decline-${b.id}`} title={t("status.declined")}
                                    onClick={(e) => { stop(e); setStatus(b.id, "declined"); }}
                                    className="p-1.5 rounded hover:bg-red-100 text-red-700">
                              <XIcon size={16} />
                            </button>
                          </>
                        )}
                        {b.status === "accepted" && (
                          <button data-testid={`action-seated-${b.id}`} title={t("status.seated")}
                                  onClick={(e) => { stop(e); setStatus(b.id, "seated"); }}
                                  className="p-1.5 rounded hover:bg-blue-100 text-blue-700">
                            <UserCheck size={16} />
                          </button>
                        )}
                        {(b.status === "accepted" || b.status === "seated") && (
                          <button data-testid={`action-noshow-${b.id}`} title={t("status.no_show")}
                                  onClick={(e) => { stop(e); setStatus(b.id, "no_show"); }}
                                  className="p-1.5 rounded hover:bg-slate-100 text-slate-700">
                            <Ghost size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <NewBookingModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingBooking(null); }}
        onCreated={() => refresh()}
        defaultDate={date}
        tables={tables}
        areas={data?.areas || []}
        customers={customers}
        booking={editingBooking}
      />
    </div>
  );
}
