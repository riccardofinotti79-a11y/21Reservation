import React, { useCallback, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";

function offset(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

function currency(v, code) {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: code || "EUR", maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `${(v || 0).toFixed(0)} ${code || ""}`; }
}

export default function Reports() {
  const { t } = useI18n();
  const { restaurant } = useAuth();
  const [from, setFrom] = useState(offset(-14));
  const [to, setTo] = useState(offset(14));

  const fetchRep = useCallback(async () => (await api.get("/reports/summary", { params: { date_from: from, date_to: to } })).data, [from, to]);
  const { data } = usePolling(fetchRep, [from, to], 10000);

  const ticket = data?.avg_ticket_per_guest ?? 0;
  const chartData = useMemo(() =>
    (data?.per_day || []).map((d) => ({
      date: d.date.slice(5),
      bookings: d.bookings,
      guests: d.guests,
      revenue: Math.round(d.guests * ticket),
    })), [data, ticket]);

  const cur = data?.currency || restaurant?.currency || "EUR";

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Analytics</div>
          <h1 className="font-serif-display text-5xl">{t("reports.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <input data-testid="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-zinc-200 rounded-md px-3 py-2 bg-white" />
          <span className="text-zinc-400">→</span>
          <input data-testid="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-zinc-200 rounded-md px-3 py-2 bg-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_bookings")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-bookings">{data?.total_bookings ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_guests")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-guests">{data?.total_guests ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.no_show")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-noshow">{data?.total_no_show ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.cancelled")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-cancelled">{data?.total_cancelled ?? 0}</div>
        </div>
        <div className="bg-zinc-900 text-white border border-zinc-900 rounded-lg p-5">
          <div className="label-eyebrow" style={{ color: "#a1a1aa" }}>{t("reports.occupancy")}</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-occupancy">{data?.estimated_occupancy_pct ?? 0}%</div>
        </div>
        <div className="rounded-lg p-5 text-white border" style={{ background: "#D97706", borderColor: "#D97706" }}>
          <div className="label-eyebrow" style={{ color: "rgba(255,255,255,0.75)" }}>Revenue stimato</div>
          <div className="text-4xl font-serif-display mt-2" data-testid="kpi-revenue">{currency(data?.estimated_revenue, cur)}</div>
          <div className="text-[10px] font-mono mt-1 opacity-80">ticket medio: {currency(ticket, cur)}/ospite</div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6" data-testid="report-chart">
        <div className="label-eyebrow mb-4">Prenotazioni · Ospiti · Revenue / giorno</div>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis yAxisId="left" stroke="#71717a" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke="#D97706" fontSize={11} />
              <Tooltip />
              <Bar yAxisId="left" dataKey="bookings" fill="#18181B" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="guests" fill="#71717A" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#D97706" strokeWidth={2.5} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-zinc-500 mt-3">
          Il revenue stimato usa il ticket medio configurato in <a href="/settings" className="underline">Impostazioni</a>.
        </p>
      </div>
    </div>
  );
}
