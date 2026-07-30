import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Users, TrendingUp, Clock, AlertCircle, ChevronRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import StatusBadge from "../StatusBadge";

function currency(v, code) {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: code || "EUR", maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `${(v || 0).toFixed(0)} ${code || ""}`; }
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export default function Home() {
  const { restaurant, user } = useAuth();
  const { t } = useI18n();

  const fetchData = useCallback(async () => {
    const [rep, customers] = await Promise.all([
      api.get("/reports/home"),
      api.get("/customers"),
    ]);
    return { rep: rep.data, customers: customers.data };
  }, []);
  const { data } = usePolling(fetchData, [], 8000);
  const rep = data?.rep;
  const cur = rep?.currency || restaurant?.currency || "EUR";
  const customerById = useMemo(() => Object.fromEntries((data?.customers || []).map((c) => [c.id, c])), [data]);

  const last7 = rep?.last7 || [];

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-8">
        <div className="label-eyebrow">Home</div>
        <h1 className="font-serif-display text-5xl">Ciao, {user?.name?.split(" ")[0] || "—"}.</h1>
        <p className="text-zinc-500 mt-2">
          Ecco cosa sta succedendo oggi da <span className="font-semibold text-zinc-900">{restaurant?.name}</span>.
        </p>
      </div>

      {/* Today */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          testId="kpi-today-bookings"
          label="Prenotazioni oggi"
          value={rep?.today?.bookings ?? 0}
          icon={CalendarDays}
        />
        <KpiCard
          testId="kpi-today-guests"
          label="Coperti oggi"
          value={rep?.today?.guests ?? 0}
          icon={Users}
        />
        <KpiCard
          testId="kpi-today-revenue"
          label="Incasso stimato oggi"
          value={currency(rep?.today?.revenue, cur)}
          icon={TrendingUp}
          accent
        />
        <KpiCard
          testId="kpi-today-pending"
          label="Da confermare"
          value={rep?.today?.pending ?? 0}
          icon={AlertCircle}
          warn={rep?.today?.pending > 0}
        />
      </div>

      {/* Week / Month */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <PeriodCard
          label="Questa settimana"
          sub={rep ? `${formatDate(rep.week.start)} → ${formatDate(rep.week.end)}` : ""}
          bookings={rep?.week?.bookings}
          guests={rep?.week?.guests}
          revenue={rep?.week?.revenue}
          currency={cur}
          testId="period-week"
        />
        <PeriodCard
          label="Questo mese"
          sub={rep ? `${formatDate(rep.month.start)} → ${formatDate(rep.month.end)}` : ""}
          bookings={rep?.month?.bookings}
          guests={rep?.month?.guests}
          revenue={rep?.month?.revenue}
          currency={cur}
          testId="period-month"
        />
      </div>

      {/* Chart */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-8" data-testid="home-chart">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="label-eyebrow">Andamento</div>
            <div className="font-serif-display text-2xl">Ultimi 7 giorni</div>
          </div>
          <div className="text-xs text-zinc-500 font-mono">
            ticket medio: {currency(rep?.avg_ticket_per_guest, cur)}/ospite
          </div>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={last7} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D97706" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip formatter={(v, k) => k === "revenue" ? currency(v, cur) : v} />
              <Area type="monotone" dataKey="revenue" stroke="#D97706" strokeWidth={2.5} fill="url(#grad-revenue)" />
              <Line type="monotone" dataKey="guests" stroke="#18181B" strokeWidth={2} dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Upcoming + Waitlist */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden md:col-span-2" data-testid="upcoming-list">
          <div className="flex items-center justify-between p-4 border-b border-zinc-100">
            <div>
              <div className="label-eyebrow">Prossime</div>
              <div className="font-serif-display text-2xl">Prenotazioni</div>
            </div>
            <Link to="/bookings/list" className="text-xs font-mono uppercase tracking-widest text-zinc-500 hover:text-zinc-900 flex items-center gap-1">
              Tutte <ChevronRight size={14} />
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2 label-eyebrow">Data</th>
                <th className="text-left px-4 py-2 label-eyebrow">Ora</th>
                <th className="text-left px-4 py-2 label-eyebrow">Cliente</th>
                <th className="text-left px-4 py-2 label-eyebrow">P.</th>
                <th className="text-left px-4 py-2 label-eyebrow">Stato</th>
              </tr>
            </thead>
            <tbody>
              {(rep?.upcoming || []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-zinc-400">—</td></tr>
              )}
              {(rep?.upcoming || []).map((b) => (
                <tr key={b.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                  <td className="px-4 py-2 font-mono text-xs">{formatDate(b.date)}</td>
                  <td className="px-4 py-2 font-mono">{b.time}</td>
                  <td className="px-4 py-2">{customerById[b.customer_id]?.name || "—"}</td>
                  <td className="px-4 py-2 font-mono">{b.persons}</td>
                  <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Link to="/waitlist" className="block bg-zinc-900 text-white rounded-lg p-6 hover:bg-zinc-800 transition-colors" data-testid="card-waitlist">
          <div className="label-eyebrow" style={{ color: "#a1a1aa" }}>Lista d'attesa</div>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="font-serif-display text-6xl">{rep?.waitlist_active ?? 0}</div>
            <div className="text-sm text-zinc-400">in attesa</div>
          </div>
          <p className="text-xs text-zinc-400 mt-6">
            Verranno notificati automaticamente quando un tavolo si libera.
          </p>
          <div className="mt-6 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-amber-500">
            Vedi lista <ChevronRight size={14} />
          </div>
        </Link>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent, warn, testId }) {
  const cls = accent
    ? "bg-amber-600 text-white border-amber-600"
    : warn
      ? "bg-white border-amber-300"
      : "bg-white border-zinc-200";
  const labelCls = accent ? "text-amber-100" : warn ? "text-amber-700" : "text-zinc-500";
  return (
    <div className={`rounded-lg border p-5 ${cls}`} data-testid={testId}>
      <div className="flex items-center justify-between">
        <div className={`label-eyebrow ${accent ? "text-amber-100" : ""}`} style={accent ? { color: "rgba(255,255,255,0.75)" } : {}}>{label}</div>
        <Icon size={16} className={accent ? "text-amber-100" : "text-zinc-400"} strokeWidth={1.5} />
      </div>
      <div className="text-4xl font-serif-display mt-2">{value}</div>
    </div>
  );
}

function PeriodCard({ label, sub, bookings, guests, revenue, currency: cur, testId }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6" data-testid={testId}>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="label-eyebrow">{label}</div>
          <div className="text-xs text-zinc-500 font-mono mt-0.5">{sub}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="label-eyebrow">Prenotazioni</div>
          <div className="text-3xl font-serif-display mt-1">{bookings ?? 0}</div>
        </div>
        <div>
          <div className="label-eyebrow">Coperti</div>
          <div className="text-3xl font-serif-display mt-1">{guests ?? 0}</div>
        </div>
        <div>
          <div className="label-eyebrow">Incasso stimato</div>
          <div className="text-3xl font-serif-display mt-1 text-amber-700">{currency(revenue, cur)}</div>
        </div>
      </div>
    </div>
  );
}
