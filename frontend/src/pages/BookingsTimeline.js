import React, { useCallback, useMemo, useState } from "react";
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
const AREA_H = 22;
const LABEL_W = 128; // 8rem — sticky table-name column

export default function BookingsTimeline() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayStr());
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

  const { startMin, endMin } = useMemo(() => {
    let start = 12 * 60, end = 24 * 60;
    const wd = (new Date(date + "T12:00:00").getDay() + 6) % 7;
    const hours = (data?.hours || []).filter((h) => !h.specific_date && h.weekday === wd);
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
    if (bookings.length) {
      const s = Math.min(...bookings.map((b) => toMin(b.time)));
      const e = Math.max(...bookings.map((b) => toMin(b.time) + (b.duration_minutes || 120)));
      start = Math.min(start, Math.floor(s / 60) * 60);
      end = Math.max(end, Math.ceil(e / 60) * 60);
    }
    start = Math.max(0, start - 30);
    end = Math.min(28 * 60, end + 30);
    return { startMin: start, endMin: end };
  }, [bookings, data, date]);

  const totalMins = Math.max(1, endMin - startMin);
  const PX_PER_HOUR = 56;
  const pxPerMin = PX_PER_HOUR / 60;
  const gridWidth = Math.round(totalMins * pxPerMin);
  const pxOf = (m) => Math.round((m - startMin) * pxPerMin);

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

  const hourStep = 60; // fixed columns → always at full hours
  const hourMarks = useMemo(() => {
    const acc = [];
    for (let m = Math.ceil(startMin / hourStep) * hourStep; m <= endMin; m += hourStep) acc.push(m);
    return acc;
  }, [startMin, endMin]);

  const tableCount = orderedRows.filter((r) => r.type === "table").length;

  // Sticky-left classes shared by the label column of both header and rows
  const stickyCol = "sticky left-0 z-10 shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800";

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">{t("nav.bookings")}</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-zinc-900 dark:text-zinc-100">{t("nav.timeline")}</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
          <input data-testid="timeline-date-picker" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="flex-1 sm:flex-none border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 bg-white dark:bg-zinc-900 text-base sm:text-sm text-zinc-900 dark:text-zinc-100" />
          <button data-testid="timeline-today" onClick={() => setDate(todayStr())}
                  className="px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {t("common.today")}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden" data-testid="timeline-grid">
        <div className="overflow-x-auto overflow-y-hidden" style={{ WebkitOverflowScrolling: "touch" }}>
          <div style={{ width: LABEL_W + gridWidth, minWidth: "100%" }}>
            {/* Header */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" style={{ height: HEADER_H }}>
              <div className={`${stickyCol} px-3 py-2 label-eyebrow flex items-center`} style={{ width: LABEL_W, height: HEADER_H }}>
                {t("common.tables")}
              </div>
              <div className="relative" style={{ width: gridWidth, height: HEADER_H }}>
                {hourMarks.map((m) => {
                  const left = pxOf(m);
                  return (
                    <div key={m}
                         className="absolute top-0 h-full border-l border-zinc-200 dark:border-zinc-800"
                         style={{ left }}>
                      <div className="pl-1 pt-1.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                        {hhmm(m)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            {orderedRows.length === 0 && (
              <div className="p-12 text-center text-zinc-400 dark:text-zinc-500" style={{ width: LABEL_W + gridWidth }}>
                Nessun tavolo configurato
              </div>
            )}
            {orderedRows.map((r) => {
              if (r.type === "area") {
                return (
                  <div key={`a-${r.area.id}`} className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60" style={{ height: AREA_H }}>
                    <div className={`${stickyCol.replace("bg-white dark:bg-zinc-900", "bg-zinc-50 dark:bg-zinc-800/60")} px-3 label-eyebrow flex items-center`} style={{ width: LABEL_W, height: AREA_H }}>
                      {r.area.name}
                    </div>
                    <div style={{ width: gridWidth, height: AREA_H }} />
                  </div>
                );
              }
              const tb = r.table;
              return (
                <div key={tb.id} className="flex border-b border-zinc-100 dark:border-zinc-800" style={{ height: ROW_HEIGHT }}>
                  <div className={`${stickyCol} px-3 flex flex-col justify-center`} style={{ width: LABEL_W, height: ROW_HEIGHT }}>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{tb.name}</div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">{tb.seats_min}-{tb.seats_max}p</div>
                  </div>
                  <div className="relative bg-white dark:bg-zinc-900" style={{ width: gridWidth, height: ROW_HEIGHT }}>
                    {hourMarks.map((m) => (
                      <div key={m}
                           className="absolute top-0 h-full border-l border-zinc-100 dark:border-zinc-800"
                           style={{ left: pxOf(m) }} />
                    ))}
                    {bookings
                      .filter((b) => b.table_ids?.includes(tb.id))
                      .map((b) => {
                        const s = toMin(b.time);
                        const dur = b.duration_minutes || 120;
                        const left = pxOf(s);
                        const width = Math.max(8, Math.round(dur * pxPerMin) - 2);
                        const color = STATUS_HEX[b.status] || "#71717a";
                        const c = customerById[b.customer_id];
                        return (
                          <div
                            key={b.id}
                            data-testid={`tl-block-${b.id}`}
                            title={`${b.time} · ${c?.name || ""} · ${b.persons}p · ${t(`status.${b.status}`)}`}
                            onClick={() => setEditingBooking(b)}
                            className="absolute rounded-md text-white shadow-sm overflow-hidden cursor-pointer hover:z-10 hover:-translate-y-0.5 transition-transform"
                            style={{
                              left,
                              width,
                              top: 4,
                              height: ROW_HEIGHT - 8,
                              backgroundColor: color,
                            }}
                          >
                            {width >= 60 && (
                              <div className="px-2 py-1">
                                <div className="text-[11px] font-semibold truncate leading-tight">
                                  {b.time} · {c?.name?.split(" ")[0] || "—"}
                                </div>
                                <div className="text-[10px] opacity-85 truncate leading-tight font-mono">
                                  {b.persons}p
                                </div>
                              </div>
                            )}
                            {width < 60 && width >= 24 && (
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
        </div>
      </div>

      <div className="flex items-center gap-4 mt-4 flex-wrap text-xs text-zinc-600 dark:text-zinc-300">
        {Object.entries(STATUS_HEX).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v }} />
            {t(`status.${k}`)}
          </div>
        ))}
        <div className="ml-auto text-zinc-400 dark:text-zinc-500 font-mono">
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
