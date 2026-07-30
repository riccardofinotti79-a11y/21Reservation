import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Send, Trash2, Users, Calendar } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";

const STATUS_CLS = {
  waiting: "bg-amber-50 text-amber-800 border-amber-200",
  notified: "bg-emerald-50 text-emerald-800 border-emerald-200",
  converted: "bg-blue-50 text-blue-800 border-blue-200",
  expired: "bg-zinc-100 text-zinc-700 border-zinc-300",
  cancelled: "bg-rose-50 text-rose-800 border-rose-200",
};

export default function Waitlist() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState("");

  const fetchList = useCallback(async () => {
    const params = {};
    if (statusFilter) params.status = statusFilter;
    return (await api.get("/waitlist", { params })).data;
  }, [statusFilter]);
  const { data, refresh } = usePolling(fetchList, [statusFilter], 8000);
  const items = data || [];

  const notify = async (id) => {
    try {
      await api.post(`/waitlist/${id}/notify`);
      toast.success("Notifica inviata");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Rimuovere dalla lista d'attesa?")) return;
    try {
      await api.delete(`/waitlist/${id}`);
      toast.success("Rimosso");
      refresh();
    } catch { toast.error("Errore"); }
  };

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Prenotazioni</div>
          <h1 className="font-serif-display text-5xl">Lista d'attesa</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Gli iscritti sono notificati automaticamente quando un tavolo si libera.
          </p>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                data-testid="waitlist-filter"
                className="border border-zinc-200 rounded-md px-3 py-2 bg-white">
          <option value="">Tutti gli stati</option>
          <option value="waiting">In attesa</option>
          <option value="notified">Notificato</option>
          <option value="converted">Convertito</option>
          <option value="expired">Scaduto</option>
          <option value="cancelled">Annullato</option>
        </select>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="text-left px-4 py-3 label-eyebrow">Data</th>
              <th className="text-left px-4 py-3 label-eyebrow">Servizio</th>
              <th className="text-left px-4 py-3 label-eyebrow">Persone</th>
              <th className="text-left px-4 py-3 label-eyebrow">Cliente</th>
              <th className="text-left px-4 py-3 label-eyebrow">Contatti</th>
              <th className="text-left px-4 py-3 label-eyebrow">Stato</th>
              <th className="text-right px-4 py-3 label-eyebrow">Azioni</th>
            </tr>
          </thead>
          <tbody data-testid="waitlist-tbody">
            {items.length === 0 && (
              <tr><td colSpan={7} className="py-16 text-center text-zinc-400">
                <Users size={20} className="mx-auto mb-2 opacity-50" />
                Nessuna iscrizione
              </td></tr>
            )}
            {items.map((w) => (
              <tr key={w.id} className="border-b border-zinc-100 hover:bg-zinc-50/50" data-testid={`waitlist-row-${w.id}`}>
                <td className="px-4 py-3 font-mono">
                  <div>{w.date}</div>
                  {w.preferred_time && <div className="text-xs text-zinc-500">pref. {w.preferred_time}</div>}
                </td>
                <td className="px-4 py-3">
                  {w.service ? (
                    <span className="text-xs uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-zinc-100">
                      {w.service === "lunch" ? "Pranzo" : w.service === "dinner" ? "Cena" : w.service}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 font-mono">{w.persons}</td>
                <td className="px-4 py-3 font-medium">{w.customer_name}</td>
                <td className="px-4 py-3 text-xs">
                  <div>{w.customer_email}</div>
                  <div className="text-zinc-500 font-mono">{w.customer_phone}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`status-pill ${STATUS_CLS[w.status] || STATUS_CLS.waiting}`}>
                    {w.status === "waiting" ? "In attesa" :
                     w.status === "notified" ? "Notificato" :
                     w.status === "converted" ? "Convertito" :
                     w.status === "expired" ? "Scaduto" : "Annullato"}
                  </span>
                  {w.notified_at && (
                    <div className="text-[10px] text-zinc-500 mt-1 font-mono">{w.notified_at.slice(0, 16).replace("T", " ")}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {w.status === "waiting" && (
                      <button data-testid={`btn-notify-${w.id}`} onClick={() => notify(w.id)}
                              title="Notifica manualmente"
                              className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700">
                        <Send size={14} />
                      </button>
                    )}
                    <button data-testid={`btn-delete-wl-${w.id}`} onClick={() => remove(w.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-red-700">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
