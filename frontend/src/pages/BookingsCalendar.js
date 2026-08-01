import React, { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import usePolling from "../usePolling";
import { MONTH_NAMES, WEEKDAY_NAMES, useI18n } from "../i18n";

function pad(n) { return String(n).padStart(2, "0"); }
function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

function workloadLevel(bookings, capacity) {
  if (!capacity) return null;
  const ratio = bookings / capacity;
  if (ratio <= 0.3) return "low";
  if (ratio <= 0.7) return "mid";
  return "high";
}

const LEVEL = {
  low: { dot: "#10B981", label: "Poco lavoro" },
  mid: { dot: "#F59E0B", label: "Lavoro normale" },
  high: { dot: "#DC2626", label: "Tanto lavoro" },
};

export default function BookingsCalendar() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const range = useMemo(() => {
    const first = iso(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const last = iso(year, month, daysInMonth);
    return { first, last, daysInMonth };
  }, [year, month]);

  const fetchAll = useCallback(async () => {
    const [s, tb] = await Promise.all([
      api.get("/bookings/day-summary", { params: { date_from: range.first, date_to: range.last } }),
      api.get("/tables"),
    ]);
    return { summary: s.data, tables: tb.data };
  }, [range]);
  const { data } = usePolling(fetchAll, [year, month], 5000);
  const summary = useMemo(() => {
    const m = {}; (data?.summary || []).forEach((d) => (m[d.date] = d)); return m;
  }, [data]);
  // Capacity = seats_max sum across bookable_online tables
  const totalCapacity = useMemo(() => (data?.tables || []).reduce((s, t) => s + (t.seats_max || 0), 0), [data]);

  const goPrev = () => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); };
  const goNext = () => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); };

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= range.daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">{t("nav.bookings")}</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-zinc-900 dark:text-zinc-50">{t("nav.calendar")}</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <button data-testid="cal-prev" onClick={goPrev} className="min-w-[40px] min-h-[40px] p-2 border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center">
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-0 sm:min-w-[220px] flex-1 sm:flex-none text-center font-serif-display text-xl sm:text-2xl text-zinc-900 dark:text-zinc-50">
            {MONTH_NAMES[lang][month - 1]} <span className="text-zinc-400">{year}</span>
          </div>
          <button data-testid="cal-next" onClick={goNext} className="min-w-[40px] min-h-[40px] p-2 border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Workload legend */}
      <div className="flex items-center gap-4 mb-3 flex-wrap text-xs text-zinc-600 dark:text-zinc-400" data-testid="workload-legend">
        {Object.entries(LEVEL).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.dot }} />
            {v.label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-zinc-200 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        {WEEKDAY_NAMES[lang].map((n) => (
          <div key={n} className="bg-zinc-50 dark:bg-zinc-900 px-1 sm:px-3 py-2 label-eyebrow text-center sm:text-left">{n.slice(0, 3)}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="bg-zinc-50/60 dark:bg-zinc-900/40 min-h-[64px] sm:min-h-[110px]" />;
          const dstr = iso(year, month, d);
          const s = summary[dstr];
          const isToday = dstr === todayIso;
          const level = s ? workloadLevel(s.guests, totalCapacity) : null;
          const dot = level ? LEVEL[level].dot : null;
          return (
            <button
              key={i}
              data-testid={`cal-day-${dstr}`}
              onClick={() => nav(`/bookings/list?date=${dstr}`)}
              className={`bg-white dark:bg-zinc-900 text-left p-2 sm:p-3 min-h-[64px] sm:min-h-[110px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${isToday ? "ring-2 ring-inset ring-zinc-900 dark:ring-zinc-100" : ""}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className={`text-base sm:text-lg font-serif-display ${isToday ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-300"}`}>{d}</div>
                {dot && (
                  <span
                    data-testid={`workload-${dstr}-${level}`}
                    className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: dot }}
                    title={LEVEL[level].label}
                  />
                )}
              </div>
              {s && (
                <div className="mt-2 sm:mt-3 space-y-0.5 sm:space-y-1">
                  <div className="text-[10px] sm:text-xs">
                    <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">{s.bookings}</span>
                    <span className="text-zinc-500 dark:text-zinc-400 ml-1 hidden sm:inline">{t("cal.reservations")}</span>
                  </div>
                  <div className="text-[10px] sm:text-xs">
                    <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">{s.guests}</span>
                    <span className="text-zinc-500 dark:text-zinc-400 ml-1 hidden sm:inline">{t("cal.guests")}</span>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
