import React, { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import usePolling from "../usePolling";
import { MONTH_NAMES, WEEKDAY_NAMES, useI18n } from "../i18n";

function pad(n) { return String(n).padStart(2, "0"); }
function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

export default function BookingsCalendar() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1..12

  const range = useMemo(() => {
    const first = iso(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const last = iso(year, month, daysInMonth);
    return { first, last, daysInMonth };
  }, [year, month]);

  const fetchSummary = useCallback(async () => {
    const { data } = await api.get("/bookings/day-summary", {
      params: { date_from: range.first, date_to: range.last },
    });
    return data;
  }, [range]);
  const { data } = usePolling(fetchSummary, [year, month], 5000);
  const summary = useMemo(() => {
    const m = {}; (data || []).forEach((d) => (m[d.date] = d)); return m;
  }, [data]);

  const goPrev = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1);
  };
  const goNext = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1);
  };

  // Grid: start on Monday
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= range.daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="label-eyebrow">{t("nav.bookings")}</div>
          <h1 className="font-serif-display text-5xl">{t("nav.calendar")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button data-testid="cal-prev" onClick={goPrev} className="p-2 border border-zinc-200 rounded-md bg-white hover:bg-zinc-50">
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-[220px] text-center font-serif-display text-2xl">
            {MONTH_NAMES[lang][month - 1]} <span className="text-zinc-400">{year}</span>
          </div>
          <button data-testid="cal-next" onClick={goNext} className="p-2 border border-zinc-200 rounded-md bg-white hover:bg-zinc-50">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-zinc-200 border border-zinc-200 rounded-lg overflow-hidden">
        {WEEKDAY_NAMES[lang].map((n) => (
          <div key={n} className="bg-zinc-50 px-3 py-2 label-eyebrow">{n.slice(0, 3)}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="bg-zinc-50/60 min-h-[110px]" />;
          const dstr = iso(year, month, d);
          const s = summary[dstr];
          const isToday = dstr === todayIso;
          return (
            <button
              key={i}
              data-testid={`cal-day-${dstr}`}
              onClick={() => nav(`/bookings/list?date=${dstr}`)}
              className={`bg-white text-left p-3 min-h-[110px] hover:bg-zinc-50 transition-colors ${isToday ? "ring-2 ring-inset ring-zinc-900" : ""}`}
            >
              <div className={`text-lg font-serif-display ${isToday ? "text-zinc-900" : "text-zinc-600"}`}>{d}</div>
              {s && (
                <div className="mt-3 space-y-1">
                  <div className="text-xs">
                    <span className="font-mono text-zinc-900 font-semibold">{s.bookings}</span>
                    <span className="text-zinc-500 ml-1">{t("cal.reservations")}</span>
                  </div>
                  <div className="text-xs">
                    <span className="font-mono text-zinc-900 font-semibold">{s.guests}</span>
                    <span className="text-zinc-500 ml-1">{t("cal.guests")}</span>
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
