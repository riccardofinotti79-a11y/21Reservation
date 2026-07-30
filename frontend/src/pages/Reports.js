import React, { useCallback, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";

function offset(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const { t } = useI18n();
  const [from, setFrom] = useState(offset(-14));
  const [to, setTo] = useState(offset(14));

  const fetchRep = useCallback(async () => (await api.get("/reports/summary", { params: { date_from: from, date_to: to } })).data, [from, to]);
  const { data } = usePolling(fetchRep, [from, to], 10000);

  const chartData = useMemo(() => (data?.per_day || []).map((d) => ({ date: d.date.slice(5), bookings: d.bookings, guests: d.guests })), [data]);

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_bookings")}</div>
          <div className="text-4xl font-serif-display mt-2">{data?.total_bookings ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.total_guests")}</div>
          <div className="text-4xl font-serif-display mt-2">{data?.total_guests ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.no_show")}</div>
          <div className="text-4xl font-serif-display mt-2">{data?.total_no_show ?? 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="label-eyebrow">{t("reports.cancelled")}</div>
          <div className="text-4xl font-serif-display mt-2">{data?.total_cancelled ?? 0}</div>
        </div>
        <div className="bg-zinc-900 text-white border border-zinc-900 rounded-lg p-5">
          <div className="label-eyebrow" style={{ color: "#a1a1aa" }}>{t("reports.occupancy")}</div>
          <div className="text-4xl font-serif-display mt-2">{data?.estimated_occupancy_pct ?? 0}%</div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="report-chart">
        <div className="label-eyebrow mb-4">Prenotazioni & Ospiti / giorno</div>
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip />
              <Bar dataKey="bookings" fill="#18181B" radius={[4, 4, 0, 0]} />
              <Bar dataKey="guests" fill="#D97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
