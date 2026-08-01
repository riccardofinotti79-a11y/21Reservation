import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Save, X } from "lucide-react";
import api from "../api";
import usePolling from "../usePolling";
import { useI18n } from "../i18n";

const SHAPES = ["square", "round", "rect"];

export default function Tables() {
  const { t } = useI18n();
  const [newAreaName, setNewAreaName] = useState("");
  const [addingTableTo, setAddingTableTo] = useState(null);
  const [tableDraft, setTableDraft] = useState({ name: "", seats_min: 2, seats_max: 4, priority: 0, bookable_online: true, bookable_staff: true, shape: "square" });
  const [editingTable, setEditingTable] = useState(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchAll = useCallback(async () => {
    const [a, tb] = await Promise.all([api.get("/areas"), api.get("/tables")]);
    return { areas: a.data, tables: tb.data };
  }, []);
  const { data, refresh } = usePolling(fetchAll, [], 5000);
  const areas = data?.areas || [];
  const tables = data?.tables || [];

  const grouped = useMemo(() => areas.map((a) => ({
    area: a, tables: tables.filter((t) => t.area_id === a.id).sort((x, y) => (y.priority || 0) - (x.priority || 0)),
  })), [areas, tables]);

  const addArea = async () => {
    if (!newAreaName.trim()) return;
    try { await api.post("/areas", { name: newAreaName.trim(), priority: 0 }); setNewAreaName(""); refresh(); toast.success("Area creata"); }
    catch { toast.error("Errore"); }
  };

  const removeArea = async (id) => {
    if (!window.confirm("Eliminare l'area?")) return;
    try { await api.delete(`/areas/${id}`); refresh(); toast.success("Area eliminata"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const startAddTable = (areaId) => {
    setAddingTableTo(areaId);
    setTableDraft({ name: "", seats_min: 2, seats_max: 4, priority: 0, bookable_online: true, bookable_staff: true, shape: "square" });
  };

  const saveTable = async (areaId) => {
    try {
      await api.post("/tables", { ...tableDraft, area_id: areaId });
      setAddingTableTo(null);
      refresh(); toast.success("Tavolo creato");
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const updateTable = async (id, patch) => {
    try { await api.patch(`/tables/${id}`, patch); refresh(); toast.success("Salvato"); setEditingTable(null); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const removeTable = async (id) => {
    if (!window.confirm("Eliminare il tavolo?")) return;
    try { await api.delete(`/tables/${id}`); refresh(); toast.success("Eliminato"); }
    catch { toast.error("Errore"); }
  };

  const renderMobileCard = (tb) => {
    const isEditing = editingTable?.id === tb.id;
    if (isEditing) {
      return (
        <div key={tb.id} className="p-4 border-t border-zinc-100 bg-zinc-50/50 space-y-2" data-testid={`table-row-${tb.name}`}>
          <input value={editingTable.name} onChange={(e) => setEditingTable({ ...editingTable, name: e.target.value })} placeholder={t("common.name")} className="w-full border rounded-md px-3 py-2 text-base" />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={editingTable.seats_min} onChange={(e) => setEditingTable({ ...editingTable, seats_min: Number(e.target.value) })} placeholder={t("tables.seats_min")} className="border rounded-md px-2 py-2 text-base" />
            <input type="number" value={editingTable.seats_max} onChange={(e) => setEditingTable({ ...editingTable, seats_max: Number(e.target.value) })} placeholder={t("tables.seats_max")} className="border rounded-md px-2 py-2 text-base" />
            <input type="number" value={editingTable.priority} onChange={(e) => setEditingTable({ ...editingTable, priority: Number(e.target.value) })} placeholder={t("tables.priority")} className="border rounded-md px-2 py-2 text-base" />
          </div>
          <select value={editingTable.shape} onChange={(e) => setEditingTable({ ...editingTable, shape: e.target.value })} className="w-full border rounded-md px-3 py-2 text-base bg-white">
            {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editingTable.bookable_online} onChange={(e) => setEditingTable({ ...editingTable, bookable_online: e.target.checked })} className="w-4 h-4" />
            {t("tables.bookable_online")}
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => updateTable(tb.id, editingTable)} className="min-h-[40px] px-4 rounded-md bg-emerald-600 text-white text-sm inline-flex items-center gap-1"><Save size={16} /> {t("common.save")}</button>
            <button onClick={() => setEditingTable(null)} className="min-h-[40px] min-w-[40px] p-2 rounded-md border border-zinc-200 flex items-center justify-center"><X size={16} /></button>
          </div>
        </div>
      );
    }
    return (
      <div key={tb.id} className="p-4 border-t border-zinc-100" data-testid={`table-row-${tb.name}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-lg">{tb.name}</div>
            <div className="text-xs text-zinc-500 mt-1 uppercase tracking-widest">{tb.shape}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button data-testid={`btn-edit-table-${tb.name}`} onClick={() => setEditingTable({ ...tb })}
                    className="min-w-[40px] min-h-[40px] p-2 rounded-md border border-zinc-200 hover:bg-zinc-100 flex items-center justify-center">
              <Pencil size={16} />
            </button>
            <button data-testid={`btn-delete-table-${tb.name}`} onClick={() => removeTable(tb.id)}
                    className="min-w-[40px] min-h-[40px] p-2 rounded-md border border-red-200 hover:bg-red-50 text-red-700 flex items-center justify-center">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div><span className="text-zinc-400 text-[10px] uppercase tracking-widest mr-1">{t("tables.seats_min")}</span><span className="font-mono">{tb.seats_min}</span></div>
          <div><span className="text-zinc-400 text-[10px] uppercase tracking-widest mr-1">{t("tables.seats_max")}</span><span className="font-mono">{tb.seats_max}</span></div>
          <div><span className="text-zinc-400 text-[10px] uppercase tracking-widest mr-1">{t("tables.priority")}</span><span className="font-mono">{tb.priority}</span></div>
          <div><span className="text-zinc-400 text-[10px] uppercase tracking-widest mr-1">{t("tables.bookable_online")}</span>{tb.bookable_online ? "✓" : "—"}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6 sm:mb-8 flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Config</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl">{t("nav.tables")}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <input data-testid="new-area-name" placeholder={t("tables.new_area")} value={newAreaName}
                 onChange={(e) => setNewAreaName(e.target.value)}
                 className="flex-1 sm:flex-none border border-zinc-200 rounded-md px-3 py-2 bg-white text-base sm:text-sm" />
          <button data-testid="btn-add-area" onClick={addArea}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700">
            <Plus size={16} /> {t("common.add")}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {grouped.length === 0 && (
          <div className="p-16 bg-white border border-zinc-200 rounded-lg text-center text-zinc-400">
            Nessuna area configurata. Creane una per iniziare.
          </div>
        )}
        {grouped.map(({ area, tables: ts }) => (
          <div key={area.id} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-100 bg-zinc-50 flex-wrap gap-2">
              <div>
                <div className="label-eyebrow">Area</div>
                <div className="font-serif-display text-2xl">{area.name}</div>
              </div>
              <div className="flex items-center gap-2">
                <button data-testid={`btn-add-table-${area.name}`} onClick={() => startAddTable(area.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-zinc-200 text-sm hover:bg-white">
                  <Plus size={14} /> {t("tables.new_table")}
                </button>
                <button data-testid={`btn-delete-area-${area.name}`} onClick={() => removeArea(area.id)}
                        className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 p-2 rounded-md hover:bg-red-50 text-red-700 flex items-center justify-center">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {addingTableTo === area.id && (
              <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 grid grid-cols-2 md:grid-cols-7 gap-2">
                <input data-testid="new-table-name" placeholder={t("common.name")} value={tableDraft.name}
                       onChange={(e) => setTableDraft({ ...tableDraft, name: e.target.value })}
                       className="border border-zinc-200 rounded-md px-2 py-2 text-base md:text-sm col-span-2 md:col-span-1" />
                <input type="number" min={1} placeholder={t("tables.seats_min")} value={tableDraft.seats_min}
                       onChange={(e) => setTableDraft({ ...tableDraft, seats_min: Number(e.target.value) })}
                       className="border border-zinc-200 rounded-md px-2 py-2 text-base md:text-sm" />
                <input type="number" min={1} placeholder={t("tables.seats_max")} value={tableDraft.seats_max}
                       onChange={(e) => setTableDraft({ ...tableDraft, seats_max: Number(e.target.value) })}
                       className="border border-zinc-200 rounded-md px-2 py-2 text-base md:text-sm" />
                <input type="number" placeholder={t("tables.priority")} value={tableDraft.priority}
                       onChange={(e) => setTableDraft({ ...tableDraft, priority: Number(e.target.value) })}
                       className="border border-zinc-200 rounded-md px-2 py-2 text-base md:text-sm" />
                <select value={tableDraft.shape} onChange={(e) => setTableDraft({ ...tableDraft, shape: e.target.value })}
                        className="border border-zinc-200 rounded-md px-2 py-2 text-base md:text-sm bg-white">
                  {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs col-span-2 md:col-span-1">
                  <input type="checkbox" checked={tableDraft.bookable_online}
                         onChange={(e) => setTableDraft({ ...tableDraft, bookable_online: e.target.checked })}/>
                  {t("tables.bookable_online")}
                </label>
                <div className="flex items-center gap-2 col-span-2 md:col-span-1">
                  <button data-testid="btn-save-new-table" onClick={() => saveTable(area.id)}
                          className="min-h-[40px] px-3 rounded-md bg-zinc-900 text-white text-sm">{t("common.save")}</button>
                  <button onClick={() => setAddingTableTo(null)} className="min-w-[40px] min-h-[40px] p-2 rounded-md hover:bg-zinc-100 flex items-center justify-center"><X size={16} /></button>
                </div>
              </div>
            )}

            {isMobile ? (
              <div>
                {ts.length === 0 && <div className="px-4 py-8 text-center text-zinc-400 text-sm">Nessun tavolo</div>}
                {ts.map((tb) => renderMobileCard(tb))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white text-zinc-500">
                    <tr>
                      <th className="text-left px-4 py-2 label-eyebrow">{t("common.name")}</th>
                      <th className="text-left px-4 py-2 label-eyebrow">{t("tables.seats_min")}</th>
                      <th className="text-left px-4 py-2 label-eyebrow">{t("tables.seats_max")}</th>
                      <th className="text-left px-4 py-2 label-eyebrow">{t("tables.priority")}</th>
                      <th className="text-left px-4 py-2 label-eyebrow">Shape</th>
                      <th className="text-center px-4 py-2 label-eyebrow">{t("tables.bookable_online")}</th>
                      <th className="text-right px-4 py-2 label-eyebrow">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ts.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Nessun tavolo</td></tr>}
                    {ts.map((tb) => {
                      const isEditing = editingTable?.id === tb.id;
                      return (
                        <tr key={tb.id} className="border-t border-zinc-100" data-testid={`table-row-${tb.name}`}>
                          {isEditing ? (
                            <>
                              <td className="px-3 py-2"><input value={editingTable.name} onChange={(e) => setEditingTable({ ...editingTable, name: e.target.value })} className="border rounded px-2 py-1 text-sm w-full" /></td>
                              <td className="px-3 py-2"><input type="number" value={editingTable.seats_min} onChange={(e) => setEditingTable({ ...editingTable, seats_min: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-16" /></td>
                              <td className="px-3 py-2"><input type="number" value={editingTable.seats_max} onChange={(e) => setEditingTable({ ...editingTable, seats_max: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-16" /></td>
                              <td className="px-3 py-2"><input type="number" value={editingTable.priority} onChange={(e) => setEditingTable({ ...editingTable, priority: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-16" /></td>
                              <td className="px-3 py-2">
                                <select value={editingTable.shape} onChange={(e) => setEditingTable({ ...editingTable, shape: e.target.value })} className="border rounded px-2 py-1 text-sm">
                                  {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={editingTable.bookable_online} onChange={(e) => setEditingTable({ ...editingTable, bookable_online: e.target.checked })} />
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => updateTable(tb.id, editingTable)} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700"><Save size={14} /></button>
                                  <button onClick={() => setEditingTable(null)} className="p-1.5 rounded hover:bg-zinc-100"><X size={14} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-2 font-medium">{tb.name}</td>
                              <td className="px-4 py-2 font-mono">{tb.seats_min}</td>
                              <td className="px-4 py-2 font-mono">{tb.seats_max}</td>
                              <td className="px-4 py-2 font-mono">{tb.priority}</td>
                              <td className="px-4 py-2 text-xs">{tb.shape}</td>
                              <td className="px-4 py-2 text-center">{tb.bookable_online ? "✓" : "—"}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <button data-testid={`btn-edit-table-${tb.name}`} onClick={() => setEditingTable({ ...tb })} className="p-1.5 rounded hover:bg-zinc-100"><Pencil size={14} /></button>
                                  <button data-testid={`btn-delete-table-${tb.name}`} onClick={() => removeTable(tb.id)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
