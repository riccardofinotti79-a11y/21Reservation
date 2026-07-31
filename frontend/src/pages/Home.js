import React, { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Users, AlertCircle, ChevronRight, ClipboardList, UserCheck } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import api from "../api";
import usePolling from "../usePolling";
import { useAuth } from "../auth";
import StatusBadge from "../StatusBadge";

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export default function Home() {
  const { restaurant, user } = useAuth();

  const fetchData = useCallback(async () => {
    const [rep, customers] = await Promise.all([
      api.get("/reports/home"),
      api.get("/customers"),
    ]);
    return { rep: rep.data, customers: customers.data };
  }, []);
  const { data } = usePolling(fetchData, [], 8000);
  const rep = data?.rep;
  const customerById = useMemo(() => Object.fromEntries((data?.customers || []).map((c) => [c.id, c])), [data]);

  const last7 = rep?.last7 || [];

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-8">
        <div className="label-eyebrow">Home</div>
        <h1 className="font-serif-display text-5xl text-zinc-900 dark:text-zinc-50">Ciao, {user?.name?.split(" ")[0] || "—"}.</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">
          Ecco cosa sta succedendo oggi da <span className="font-semibold text-zinc-900 dark:text-zinc-100">{restaurant?.name}</span>.
        </p>
      </div>

      {/* Today */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard testId="kpi-today-bookings" label="Prenotazioni oggi" value={rep?.today?.bookings ?? 0} icon={CalendarDays} />
        <KpiCard testId="kpi-today-guests" label="Coperti oggi" value={rep?.today?.guests ?? 0} icon={Users} />
        <KpiCard testId="kpi-today-pending" label="Da confermare" value={rep?.today?.pending ?? 0} icon={AlertCircle} warn={rep?.today?.pending > 0} />
        <KpiCard testId="kpi-today-seated" label="Seduti" value={(rep?.upcoming || []).filter((b) => b.status === "seated").length} icon={UserCheck} />
      </div>

      {/* Week / Month */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <PeriodCard testId="period-week" label="Questa settimana"
          sub={rep ? `${formatDate(rep.week.start)} → ${formatDate(rep.week.end)}` : ""}
          bookings={rep?.week?.bookings} guests={rep?.week?.guests} />
        <PeriodCard testId="period-month" label="Questo mese"
          sub={rep ? `${formatDate(rep.month.start)} → ${formatDate(rep.month.end)}` : ""}
          bookings={rep?.month?.bookings} guests={rep?.month?.guests} />
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 mb-8" data-testid="home-chart">
        <div className="mb-4">
          <div className="label-eyebrow">Andamento</div>
          <div className="font-serif-display text-2xl text-zinc-900 dark:text-zinc-50">Ultimi 7 giorni</div>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={last7} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#18181B" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#18181B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip />
              <Area type="monotone" dataKey="guests" stroke="#18181B" strokeWidth={2.5} fill="url(#grad-g)" />
              <Line type="monotone" dataKey="bookings" stroke="#D97706" strokeWidth={2} dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Upcoming + Waitlist */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden md:col-span-2" data-testid="upcoming-list">
          <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <div className="label-eyebrow">Prossime</div>
              <div className="font-serif-display text-2xl text-zinc-900 dark:text-zinc-50">Prenotazioni</div>
            </div>
            <Link to="/bookings/list" className="text-xs font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1">
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
              {(rep?.upcoming || []).length === 0 && <tr><td colSpan={5} className="text-center py-8 text-zinc-400">—</td></tr>}
              {(rep?.upcoming || []).map((b) => (
                <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50">
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

        <Link to="/waitlist" className="block bg-zinc-900 dark:bg-zinc-800 text-white rounded-lg p-6 hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors" data-testid="card-waitlist">
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

function KpiCard({ label, value, icon: Icon, warn, testId }) {
  const cls = warn
    ? "bg-white dark:bg-zinc-900 border-amber-300 dark:border-amber-600/50"
    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800";
  return (
    <div className={`rounded-lg border p-5 ${cls}`} data-testid={testId}>
      <div className="flex items-center justify-between">
        <div className={`label-eyebrow ${warn ? "text-amber-700 dark:text-amber-400" : ""}`}>{label}</div>
        <Icon size={16} className="text-zinc-400" strokeWidth={1.5} />
      </div>
      <div className="text-4xl font-serif-display mt-2 text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}

function PeriodCard({ label, sub, bookings, guests, testId }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6" data-testid={testId}>
      <div className="mb-4">
        <div className="label-eyebrow">{label}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">{sub}</div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="label-eyebrow">Prenotazioni</div>
          <div className="text-3xl font-serif-display mt-1 text-zinc-900 dark:text-zinc-50">{bookings ?? 0}</div>
        </div>
        <div>
          <div className="label-eyebrow">Coperti</div>
          <div className="text-3xl font-serif-display mt-1 text-zinc-900 dark:text-zinc-50">{guests ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
