import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, RefreshCw } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";

const GRID_W = 900;
const GRID_H = 600;
const CELL = 20;

/** MVP drag & drop floor plan — one canvas per area, tables placed by x/y. */
export default function FloorPlan() {
  const { t } = useI18n();
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [activeArea, setActiveArea] = useState(null);
  const [dirty, setDirty] = useState({});
  const [dragging, setDragging] = useState(null);
  const containerRef = useRef(null);

  const load = useCallback(async () => {
    const [a, tb] = await Promise.all([api.get("/areas"), api.get("/tables")]);
    setAreas(a.data);
    setTables(tb.data);
    if (!activeArea && a.data.length) setActiveArea(a.data[0].id);
  }, [activeArea]);

  useEffect(() => { load(); }, [load]);

  const areaTables = tables.filter((t) => t.area_id === activeArea);

  const onMouseDown = (e, table) => {
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - (table.position?.x || 0);
    const py = e.clientY - rect.top - (table.position?.y || 0);
    setDragging({ id: table.id, offsetX: px, offsetY: py });
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left - dragging.offsetX;
    let y = e.clientY - rect.top - dragging.offsetY;
    // Snap to grid
    x = Math.round(x / CELL) * CELL;
    y = Math.round(y / CELL) * CELL;
    x = Math.max(0, Math.min(GRID_W - 80, x));
    y = Math.max(0, Math.min(GRID_H - 80, y));
    setTables((prev) => prev.map((t) => t.id === dragging.id ? { ...t, position: { x, y } } : t));
    setDirty((d) => ({ ...d, [dragging.id]: true }));
  };

  const onMouseUp = () => setDragging(null);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line
  }, [dragging]);

  const saveAll = async () => {
    const ids = Object.keys(dirty);
    if (!ids.length) { toast.info("Nessuna modifica"); return; }
    try {
      await Promise.all(ids.map((id) => {
        const t = tables.find((x) => x.id === id);
        return api.patch(`/tables/${id}`, { position: t.position });
      }));
      toast.success(`Salvate ${ids.length} posizioni`);
      setDirty({});
    } catch { toast.error("Errore"); }
  };

  const tableColor = (tb) => {
    if (tb.seats_max <= 2) return "#0EA5E9";
    if (tb.seats_max <= 4) return "#059669";
    if (tb.seats_max <= 6) return "#D97706";
    return "#7C3AED";
  };

  const shapeStyle = (tb) => {
    const base = { width: 72, height: 72, borderRadius: 12 };
    if (tb.shape === "round") base.borderRadius = 999;
    if (tb.shape === "rect") { base.width = 110; base.height = 60; }
    return base;
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Config</div>
          <h1 className="font-serif-display text-5xl">Planimetria</h1>
          <p className="text-sm text-zinc-500 mt-1">Trascina i tavoli per posizionarli. Snap alla griglia da {CELL}px.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 border border-zinc-200 rounded-md hover:bg-zinc-50"><RefreshCw size={16} /></button>
          <button data-testid="plan-save" onClick={saveAll}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700">
            <Save size={16} /> {t("common.save")} ({Object.keys(dirty).length})
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {areas.map((a) => (
          <button key={a.id} data-testid={`plan-area-${a.name}`} onClick={() => setActiveArea(a.id)}
                  className={`px-4 py-2 rounded-full border text-sm transition-colors ${activeArea === a.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200 hover:bg-zinc-50"}`}>
            {a.name}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        data-testid="plan-canvas"
        className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden r21-plan-canvas"
        style={{ width: GRID_W, height: GRID_H, maxWidth: "100%",
          backgroundSize: `${CELL}px ${CELL}px` }}
      >
        {areaTables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
            Nessun tavolo in questa area
          </div>
        )}
        {areaTables.map((tb) => {
          const s = shapeStyle(tb);
          const isDrag = dragging?.id === tb.id;
          return (
            <div
              key={tb.id}
              data-testid={`plan-table-${tb.name}`}
              onMouseDown={(e) => onMouseDown(e, tb)}
              className={`absolute flex flex-col items-center justify-center text-white font-semibold cursor-move select-none shadow-md ${isDrag ? "ring-4 ring-amber-400/50" : ""}`}
              style={{
                left: tb.position?.x || 0,
                top: tb.position?.y || 0,
                backgroundColor: tableColor(tb),
                transition: isDrag ? "none" : "box-shadow 0.15s ease",
                ...s,
              }}
              title={`${tb.name} · ${tb.seats_min}-${tb.seats_max}`}
            >
              <div className="text-sm leading-none">{tb.name}</div>
              <div className="text-[10px] font-mono opacity-90 mt-1">{tb.seats_min}-{tb.seats_max}p</div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-600 flex-wrap">
        <Legend color="#0EA5E9" label="1-2 posti" />
        <Legend color="#059669" label="3-4 posti" />
        <Legend color="#D97706" label="5-6 posti" />
        <Legend color="#7C3AED" label="7+ posti" />
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

// Grid lines follow the theme via CSS
const _r21PlanStyle = (() => {
  if (typeof document === "undefined") return null;
  const id = "r21-plan-canvas-style";
  if (document.getElementById(id)) return null;
  const s = document.createElement("style");
  s.id = id;
  s.textContent = `
    .r21-plan-canvas {
      background-image:
        linear-gradient(#f4f4f5 1px, transparent 1px),
        linear-gradient(90deg, #f4f4f5 1px, transparent 1px);
    }
    .dark .r21-plan-canvas {
      background-image:
        linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
    }
  `;
  document.head.appendChild(s);
  return true;
})();
