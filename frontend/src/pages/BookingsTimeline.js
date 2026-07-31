import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";
import { STATUS_HEX } from "../StatusBadge";
import NewBookingModal from "../NewBookingModal";

function todayStr() { return new Date().toISOString().slice(0, 10); }
function hhmm(mins) { return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`; }
function toMin(hhmmStr) { const [h, m] = hhmmStr.split(":").map(Number); return h * 60 + m; }

const ROW_HEIGHT = 44;
const HEADER_H = 36;

export default function BookingsTimeline() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayStr());
  const gridRef = useRef(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [editingBooking, setEditingBooking] = useState(null);

  const fetchAll = useCallback(async () => {
    const [b, tb, ar, cu, oh] = await Promise.all([
      api.get("/bookings", { params: { date } }),
      api.get("/tables"),
      api.get("/areas"),
      api.get("/customers"),
      api.get("/opening-hours"),
    ]);
    return { bookings: b.data, tables: tb.data, areas: ar.data, customers: cu.data, hours: oh.data };
  }, [date]);
  const { data } = usePolling(fetchAll, [date], 5000);
  const bookings = data?.bookings || [];
  const tables = data?.tables || [];
  const areas = data?.areas || [];
  const customers = data?.customers || [];
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  // Determine start/end times of the timeline from opening hours + bookings
  const { startMin, endMin } = useMemo(() => {
    let start = 12 * 60, end = 24 * 60;
    const wd = (new Date(date + "T12:00:00").getDay() + 6) % 7;
    const hours = (data?.hours || []).filter(
      (h) => !h.specific_date && h.weekday === wd
    );
    if (hours.length) {
      const opens = hours.map((h) => toMin(h.open_time));
      const closes = hours.map((h) => toMin(h.close_time));
      start = Math.min(...opens);
      end = Math.max(...closes);
    } else if (bookings.length) {
      const s = Math.min(...bookings.map((b) => toMin(b.time)));
      const e = Math.max(...bookings.map((b) => toMin(b.time) + (b.duration_minutes || 120)));
      start = Math.floor(s / 60) * 60;
      end = Math.ceil(e / 60) * 60;
    }
    // Extend to any bookings outside
    if (bookings.length) {
      const s = Math.min(...bookings.map((b) => toMin(b.time)));
      const e = Math.max(...bookings.map((b) => toMin(b.time) + (b.duration_minutes || 120)));
      start = Math.min(start, Math.floor(s / 60) * 60);
      end = Math.max(end, Math.ceil(e / 60) * 60);
    }
    // A little padding
    start = Math.max(0, start - 30);
    end = Math.min(28 * 60, end + 30);
    return { startMin: start, endMin: end };
  }, [bookings, data, date]);

  const totalMins = Math.max(1, endMin - startMin);

  // Observe grid width for measuring
  useEffect(() => {
    if (!gridRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setGridWidth(e.contentRect.width);
    });
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, []);

  // Group tables by area, sorted by area priority desc then table priority desc
  const orderedRows = useMemo(() => {
    const sortedAreas = [...areas].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const rows = [];
    sortedAreas.forEach((a) => {
      const ts = tables.filter((t) => t.area_id === a.id).sort((x, y) => (y.priority || 0) - (x.priority || 0));
      rows.push({ type: "area", area: a });
      ts.forEach((tb) => rows.push({ type: "table", table: tb, area: a }));
    });
    const orphans = tables.filter((t) => !areas.find((a) => a.id === t.area_id));
    if (orphans.length) {
      rows.push({ type: "area", area: { id: "orphans", name: "—" } });
      orphans.forEach((tb) => rows.push({ type: "table", table: tb, area: { id: "orphans", name: "—" } }));
    }
    return rows;
  }, [tables, areas]);

  // Hour marks. Show every 30min if space is tight
  const hourStep = totalMins <= 6 * 60 ? 30 : 60;
  const hourMarks = useMemo(() => {
    const acc = [];
    for (let m = Math.ceil(startMin / hourStep) * hourStep; m <= endMin; m += hourStep) {
      acc.push(m);
    }
    return acc;
  }, [startMin, endMin, hourStep]);

  const pctOf = (m) => ((m - startMin) / totalMins) * 100;

  const tableCount = orderedRows.filter((r) => r.type === "table").length;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">{t("nav.bookings")}</div>
          <h1 className="font-serif-display text-5xl">{t("nav.timeline")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <input data-testid="timeline-date-picker" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="border border-zinc-200 rounded-md px-3 py-2 bg-white" />
          <button data-testid="timeline-today" onClick={() => setDate(todayStr())}
                  className="px-3 py-2 border border-zinc-200 rounded-md text-sm hover:bg-zinc-100">
            {t("common.today")}
          </button>
        </div>
      </div>

      {/* Timeline container — fits width, no horizontal scroll */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden" data-testid="timeline-grid">
        {/* Header */}
        <div className="flex border-b border-zinc-200" style={{ height: HEADER_H }}>
          <div className="w-32 md:w-40 shrink-0 border-r border-zinc-200 px-3 py-2 label-eyebrow flex items-center">
            {t("common.tables")}
          </div>
          <div ref={gridRef} className="relative flex-1 min-w-0" style={{ height: HEADER_H }}>
            {hourMarks.map((m) => {
              const left = pctOf(m);
              return (
                <div key={m} className="absolute top-0 h-full text-[10px] font-mono text-zinc-500 border-l border-zinc-200"
                     style={{ left: `${left}%` }}>
                  <div className="pl-1 pt-1.5">{hhmm(m)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rows */}
        {orderedRows.length === 0 && (
          <div className="p-12 text-center text-zinc-400">Nessun tavolo configurato</div>
        )}
        {orderedRows.map((r, idx) => {
          if (r.type === "area") {
            return (
              <div key={`a-${r.area.id}`} className="flex bg-zinc-50 border-b border-zinc-200" style={{ height: 22 }}>
                <div className="w-32 md:w-40 shrink-0 px-3 label-eyebrow flex items-center">{r.area.name}</div>
                <div className="flex-1 min-w-0" />
              </div>
            );
          }
          const tb = r.table;
          return (
            <div key={tb.id} className="flex border-b border-zinc-100" style={{ height: ROW_HEIGHT }}>
              <div className="w-32 md:w-40 shrink-0 border-r border-zinc-200 px-3 flex flex-col justify-center" style={{ height: ROW_HEIGHT }}>
                <div className="text-sm font-medium truncate">{tb.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono">{tb.seats_min}-{tb.seats_max}p</div>
              </div>
              <div className="relative flex-1 min-w-0" style={{ height: ROW_HEIGHT }}>
                {/* Hour gridlines */}
                {hourMarks.map((m) => (
                  <div key={m} className="absolute top-0 h-full border-l border-zinc-100"
                       style={{ left: `${pctOf(m)}%` }} />
                ))}
                {/* Bookings */}
                {bookings
                  .filter((b) => b.table_ids?.includes(tb.id))
                  .map((b) => {
                    const s = toMin(b.time);
                    const dur = b.duration_minutes || 120;
                    const left = pctOf(s);
                    const width = (dur / totalMins) * 100;
                    const color = STATUS_HEX[b.status] || "#71717a";
                    const c = customerById[b.customer_id];
                    // Only show text if pixel width is enough
                    const pxWidth = (width / 100) * gridWidth;
                    return (
                      <div
                        key={b.id}
                        data-testid={`tl-block-${b.id}`}
                        title={`${b.time} · ${c?.name || ""} · ${b.persons}p · ${t(`status.${b.status}`)}`}
                        onClick={() => setEditingBooking(b)}
                        className="absolute rounded-md text-white shadow-sm overflow-hidden cursor-pointer hover:z-10 hover:-translate-y-0.5 transition-transform"
                        style={{
                          left: `${left}%`,
                          width: `calc(${width}% - 2px)`,
                          top: 4,
                          height: ROW_HEIGHT - 8,
                          backgroundColor: color,
                          minWidth: 8,
                        }}
                      >
                        {pxWidth >= 60 && (
                          <div className="px-2 py-1">
                            <div className="text-[11px] font-semibold truncate leading-tight">
                              {b.time} · {c?.name?.split(" ")[0] || "—"}
                            </div>
                            <div className="text-[10px] opacity-85 truncate leading-tight font-mono">
                              {b.persons}p
                            </div>
                          </div>
                        )}
                        {pxWidth < 60 && pxWidth >= 24 && (
                          <div className="px-1 py-0.5 text-[10px] font-mono text-center leading-tight">
                            {b.persons}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 flex-wrap text-xs text-zinc-600">
        {Object.entries(STATUS_HEX).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v }} />
            {t(`status.${k}`)}
          </div>
        ))}
        <div className="ml-auto text-zinc-400 font-mono">
          {tableCount} tavoli · {hhmm(startMin)} → {hhmm(endMin)}
        </div>
      </div>

      <NewBookingModal
        open={!!editingBooking}
        onClose={() => setEditingBooking(null)}
        onCreated={() => setEditingBooking(null)}
        defaultDate={date}
        tables={tables}
        areas={areas}
        customers={customers}
        booking={editingBooking}
      />
    </div>
  );
}
