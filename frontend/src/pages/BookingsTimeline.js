import React, { useCallback, useMemo, useState } from "react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";
import { STATUS_HEX } from "../StatusBadge";

function todayStr() { return new Date().toISOString().slice(0, 10); }
function hhmm(mins) { return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`; }
function toMin(hhmmStr) { const [h, m] = hhmmStr.split(":").map(Number); return h * 60 + m; }

const PX_PER_MIN = 3; // 180 px per hour
const ROW_HEIGHT = 52;
const HEADER_H = 40;
const LEFT_COL = 160;

export default function BookingsTimeline() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayStr());

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
  const areaById = useMemo(() => Object.fromEntries(areas.map((a) => [a.id, a])), [areas]);

  // Determine start/end times of the timeline
  const { startMin, endMin } = useMemo(() => {
    // Use min booking time and max end time, or defaults
    let start = 12 * 60, end = 24 * 60;
    if (bookings.length) {
      const s = Math.min(...bookings.map((b) => toMin(b.time)));
      const e = Math.max(...bookings.map((b) => toMin(b.time) + (b.duration_minutes || 120)));
      start = Math.min(start, Math.floor(s / 60) * 60);
      end = Math.max(end, Math.ceil(e / 60) * 60);
    }
    start = Math.max(0, start - 60);
    end = Math.min(28 * 60, end + 60);
    return { startMin: start, endMin: end };
  }, [bookings]);

  const totalMins = endMin - startMin;
  const gridWidth = totalMins * PX_PER_MIN;

  // Group tables by area, sorted by area priority (desc) then table priority (desc)
  const orderedTables = useMemo(() => {
    const sortedAreas = [...areas].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const out = [];
    sortedAreas.forEach((a) => {
      const ts = tables.filter((t) => t.area_id === a.id).sort((x, y) => (y.priority || 0) - (x.priority || 0));
      out.push({ area: a, tables: ts });
    });
    // tables with unknown area
    const orphans = tables.filter((t) => !areas.find((a) => a.id === t.area_id));
    if (orphans.length) out.push({ area: { id: "orphans", name: "—" }, tables: orphans });
    return out;
  }, [tables, areas]);

  const flatRows = useMemo(() => {
    const rows = [];
    orderedTables.forEach(({ area, tables: ts }) => {
      ts.forEach((tb) => rows.push({ table: tb, area }));
    });
    return rows;
  }, [orderedTables]);
  const rowIndex = useMemo(() => Object.fromEntries(flatRows.map((r, i) => [r.table.id, i])), [flatRows]);

  // Time markers (every hour)
  const hourMarks = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 60) {
    hourMarks.push(m);
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
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

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="timeline-scroll">
          <div style={{ width: LEFT_COL + gridWidth }} className="relative">
            {/* Header row */}
            <div className="flex sticky top-0 bg-white border-b border-zinc-200" style={{ height: HEADER_H }}>
              <div style={{ width: LEFT_COL }} className="shrink-0 border-r border-zinc-200 px-3 py-2 label-eyebrow flex items-center">
                {t("common.tables")}
              </div>
              <div className="relative" style={{ width: gridWidth, height: HEADER_H }}>
                {hourMarks.map((m) => (
                  <div key={m} className="absolute top-0 h-full border-l border-zinc-200 pl-1 pt-2 text-xs font-mono text-zinc-500"
                       style={{ left: (m - startMin) * PX_PER_MIN }}>
                    {hhmm(m)}
                  </div>
                ))}
              </div>
            </div>

            {/* Body rows */}
            <div>
              {orderedTables.map(({ area, tables: ts }) => (
                <React.Fragment key={area.id}>
                  <div className="flex bg-zinc-50 border-b border-zinc-200">
                    <div style={{ width: LEFT_COL }} className="shrink-0 px-3 py-1 label-eyebrow">{area.name}</div>
                    <div style={{ width: gridWidth }} />
                  </div>
                  {ts.map((tb) => (
                    <div key={tb.id} className="flex border-b border-zinc-100 relative" style={{ height: ROW_HEIGHT }}>
                      <div style={{ width: LEFT_COL }} className="shrink-0 border-r border-zinc-200 px-3 py-2 text-sm flex flex-col justify-center">
                        <div className="font-medium">{tb.name}</div>
                        <div className="text-xs text-zinc-500 font-mono">{tb.seats_min}-{tb.seats_max} p</div>
                      </div>
                      <div className="relative" style={{ width: gridWidth, height: ROW_HEIGHT }}>
                        {hourMarks.map((m) => (
                          <div key={m} className="absolute top-0 h-full border-l border-zinc-100"
                               style={{ left: (m - startMin) * PX_PER_MIN }} />
                        ))}
                        {bookings
                          .filter((b) => b.table_ids?.includes(tb.id))
                          .map((b) => {
                            const s = toMin(b.time);
                            const dur = b.duration_minutes || 120;
                            const left = (s - startMin) * PX_PER_MIN;
                            const width = dur * PX_PER_MIN;
                            const color = STATUS_HEX[b.status] || "#71717a";
                            const c = customerById[b.customer_id];
                            return (
                              <div
                                key={b.id}
                                data-testid={`tl-block-${b.id}`}
                                title={`${b.time} · ${c?.name || ""} · ${b.persons}p`}
                                className="absolute top-1 rounded-md px-2 py-1 text-white text-xs shadow-sm overflow-hidden cursor-pointer transition-transform hover:-translate-y-0.5"
                                style={{ left, width: Math.max(width - 2, 20), height: ROW_HEIGHT - 8, backgroundColor: color }}
                              >
                                <div className="font-semibold truncate">{b.time} · {c?.name || "—"}</div>
                                <div className="opacity-90 truncate text-[10px] font-mono">{b.persons}p · {t(`status.${b.status}`)}</div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
              {flatRows.length === 0 && (
                <div className="p-16 text-center text-zinc-400">Nessun tavolo configurato</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4 flex-wrap">
        {Object.entries(STATUS_HEX).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs text-zinc-600">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v }} />
            {t(`status.${k}`)}
          </div>
        ))}
      </div>
    </div>
  );
}
