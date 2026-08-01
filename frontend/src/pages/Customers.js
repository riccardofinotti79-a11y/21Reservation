import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Shield, ShieldAlert } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";

function reliabilityScore(c) {
  const total = c.total_bookings || 0;
  if (total === 0) return { score: null, label: "—", cls: "text-zinc-400 dark:text-zinc-500" };
  const bad = (c.no_show_count || 0) + Math.floor((c.cancelled_count || 0) / 2);
  const ratio = 1 - bad / Math.max(total, 1);
  const score = Math.max(0, Math.round(ratio * 100));
  const cls = score >= 80 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-red-700";
  return { score, label: `${score}`, cls };
}

export default function Customers() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchList = useCallback(async () => (await api.get("/customers", { params: { search: q || undefined } })).data, [q]);
  const { data } = usePolling(fetchList, [q], 10000);
  const customers = data || [];

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6 sm:mb-8 flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">CRM</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl">{t("customers.title")}</h1>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-3 text-zinc-400 dark:text-zinc-500" />
          <input data-testid="customers-search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={t("common.search")}
                 className="pl-9 pr-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-zinc-900 w-full text-base sm:text-sm" />
        </div>
      </div>

      {isMobile ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-100" data-testid="customers-tbody">
          {customers.length === 0 && (
            <div className="px-4 py-12 text-center text-zinc-400 dark:text-zinc-500 text-sm">—</div>
          )}
          {customers.map((c) => {
            const r = reliabilityScore(c);
            return (
              <Link key={c.id} to={`/customers/${c.id}`}
                    data-testid={`customer-row-${c.id}`}
                    className="block p-4 active:bg-zinc-50 dark:bg-zinc-800/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.bad_guest_flag ? <ShieldAlert size={14} className="text-red-600 shrink-0" /> : <Shield size={14} className="text-zinc-300 shrink-0" />}
                    <div className="font-medium text-zinc-900 dark:text-zinc-100 break-words">{c.name}</div>
                  </div>
                  <div className={`font-mono font-semibold text-lg ${r.cls} shrink-0`}>{r.label}</div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div><span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest mr-1">{t("common.phone")}</span><span className="font-mono break-all">{c.phone || "—"}</span></div>
                  <div><span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest mr-1">{t("common.email")}</span><span className="break-all">{c.email || "—"}</span></div>
                </div>
                <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest mr-1">Storico</span>
                  <span className="font-mono">{c.total_bookings || 0}</span> · NS <span className="font-mono">{c.no_show_count || 0}</span> · X <span className="font-mono">{c.cancelled_count || 0}</span>
                </div>
                {(c.tags || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(c.tags || []).map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full bg-zinc-100 text-xs">{tag}</span>)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-3 label-eyebrow">{t("common.name")}</th>
                  <th className="text-left px-4 py-3 label-eyebrow">{t("common.phone")}</th>
                  <th className="text-left px-4 py-3 label-eyebrow">{t("common.email")}</th>
                  <th className="text-left px-4 py-3 label-eyebrow">Storico</th>
                  <th className="text-left px-4 py-3 label-eyebrow">{t("customers.reliability")}</th>
                  <th className="text-left px-4 py-3 label-eyebrow">Tag</th>
                </tr>
              </thead>
              <tbody data-testid="customers-tbody">
                {customers.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-400 dark:text-zinc-500">—</td></tr>}
                {customers.map((c) => {
                  const r = reliabilityScore(c);
                  return (
                    <tr key={c.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/50 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/40" data-testid={`customer-row-${c.id}`}>
                      <td className="px-4 py-3">
                        <Link to={`/customers/${c.id}`} className="font-medium hover:underline flex items-center gap-2">
                          {c.bad_guest_flag ? <ShieldAlert size={14} className="text-red-600" /> : <Shield size={14} className="text-zinc-300" />}
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.phone || "—"}</td>
                      <td className="px-4 py-3 text-xs">{c.email || "—"}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-mono">{c.total_bookings || 0}</span> · NS <span className="font-mono">{c.no_show_count || 0}</span> · X <span className="font-mono">{c.cancelled_count || 0}</span>
                      </td>
                      <td className={`px-4 py-3 font-mono font-semibold ${r.cls}`}>{r.label}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(c.tags || []).map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full bg-zinc-100 text-xs">{tag}</span>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
