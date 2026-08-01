import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Trash2, Users } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";

const STATUS_CLS = {
  waiting: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60",
  notified: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60",
  converted: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800/60",
  expired: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-200 dark:border-zinc-700",
  cancelled: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60",
};

const STATUS_LABEL = {
  waiting: "In attesa",
  notified: "Notificato",
  converted: "Convertito",
  expired: "Scaduto",
  cancelled: "Annullato",
};

function svcLabel(s) {
  if (s === "lunch") return "Pranzo";
  if (s === "dinner") return "Cena";
  return s || "—";
}

export default function Waitlist() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState("");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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

  const renderActions = (w) => (
    <div className="flex items-center gap-2 sm:gap-1 justify-end">
      {w.status === "waiting" && (
        <button data-testid={`btn-notify-${w.id}`} onClick={() => notify(w.id)}
                title="Notifica manualmente"
                className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1.5 rounded-md sm:rounded hover:bg-emerald-100 dark:hover:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 sm:border-0 flex items-center justify-center">
          <Send size={16} className="sm:hidden" /><Send size={14} className="hidden sm:block" />
        </button>
      )}
      <button data-testid={`btn-delete-wl-${w.id}`} onClick={() => remove(w.id)}
              className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1.5 rounded-md sm:rounded hover:bg-red-50 dark:hover:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 sm:border-0 flex items-center justify-center">
        <Trash2 size={16} className="sm:hidden" /><Trash2 size={14} className="hidden sm:block" />
      </button>
    </div>
  );

  const emptyState = (
    <div className="py-16 text-center text-zinc-400 dark:text-zinc-500">
      <Users size={20} className="mx-auto mb-2 opacity-50" />
      Nessuna iscrizione
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6 sm:mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Prenotazioni</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-zinc-900 dark:text-zinc-100">Lista d'attesa</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            Gli iscritti sono notificati automaticamente quando un tavolo si libera.
          </p>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                data-testid="waitlist-filter"
                className="w-full sm:w-auto border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
          <option value="">Tutti gli stati</option>
          <option value="waiting">In attesa</option>
          <option value="notified">Notificato</option>
          <option value="converted">Convertito</option>
          <option value="expired">Scaduto</option>
          <option value="cancelled">Annullato</option>
        </select>
      </div>

      {isMobile ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800" data-testid="waitlist-tbody">
          {items.length === 0 && emptyState}
          {items.map((w) => (
            <div key={w.id} className="p-4" data-testid={`waitlist-row-${w.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-lg text-zinc-900 dark:text-zinc-100 leading-none">{w.date}</div>
                  {w.preferred_time && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">pref. {w.preferred_time}</div>}
                </div>
                <span className={`status-pill ${STATUS_CLS[w.status] || STATUS_CLS.waiting}`}>
                  {STATUS_LABEL[w.status] || w.status}
                </span>
              </div>
              <div className="mt-3">
                <div className="font-medium text-zinc-900 dark:text-zinc-100 break-words">{w.customer_name}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400 break-all">{w.customer_email}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400 font-mono break-all">{w.customer_phone}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <div><span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest mr-1">Servizio</span>{svcLabel(w.service)}</div>
                <div><span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest mr-1">Persone</span><span className="font-mono">{w.persons}</span></div>
              </div>
              {w.notified_at && (
                <div className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                  notificato {w.notified_at.slice(0, 16).replace("T", " ")}
                </div>
              )}
              <div className="mt-4">{renderActions(w)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800">
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
                  <tr><td colSpan={7}>{emptyState}</td></tr>
                )}
                {items.map((w) => (
                  <tr key={w.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/40" data-testid={`waitlist-row-${w.id}`}>
                    <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-100">
                      <div>{w.date}</div>
                      {w.preferred_time && <div className="text-xs text-zinc-500 dark:text-zinc-400">pref. {w.preferred_time}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {w.service ? (
                        <span className="text-xs uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200">
                          {svcLabel(w.service)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-100">{w.persons}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{w.customer_name}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-zinc-700 dark:text-zinc-200">{w.customer_email}</div>
                      <div className="text-zinc-500 dark:text-zinc-400 font-mono">{w.customer_phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`status-pill ${STATUS_CLS[w.status] || STATUS_CLS.waiting}`}>
                        {STATUS_LABEL[w.status] || w.status}
                      </span>
                      {w.notified_at && (
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">{w.notified_at.slice(0, 16).replace("T", " ")}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{renderActions(w)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
