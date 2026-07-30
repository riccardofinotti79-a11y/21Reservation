import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import StatusBadge from "../StatusBadge";

export default function CustomerDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const [c, setC] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [badFlag, setBadFlag] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c1, b1] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get(`/customers/${id}/bookings`),
      ]);
      setC(c1.data);
      setTags((c1.data.tags || []).join(", "));
      setNotes(c1.data.notes || "");
      setBadFlag(!!c1.data.bad_guest_flag);
      setBookings(b1.data);
    } catch { toast.error("Errore"); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.patch(`/customers/${id}`, {
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        notes,
        bad_guest_flag: badFlag,
      });
      toast.success("Salvato"); load();
    } catch { toast.error("Errore"); }
  };

  if (!c) return <div className="p-8 text-zinc-400">Caricamento…</div>;

  const total = c.total_bookings || 0;
  const bad = (c.no_show_count || 0) + Math.floor((c.cancelled_count || 0) / 2);
  const score = total === 0 ? null : Math.max(0, Math.round((1 - bad / total) * 100));

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      <Link to="/customers" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 mb-4">
        <ArrowLeft size={14} /> {t("customers.title")}
      </Link>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="label-eyebrow">Cliente</div>
          <h1 className="font-serif-display text-5xl">{c.name}</h1>
          <div className="text-sm text-zinc-500 mt-1 font-mono">{c.phone || "—"} · {c.email || "—"}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg px-5 py-3">
          <div className="label-eyebrow">{t("customers.reliability")}</div>
          <div className={`text-3xl font-serif-display ${score === null ? "text-zinc-400" : score >= 80 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-red-700"}`}>
            {score === null ? "—" : score}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="label-eyebrow">Totale</div>
          <div className="text-3xl font-serif-display mt-1">{c.total_bookings || 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="label-eyebrow">No-show</div>
          <div className="text-3xl font-serif-display mt-1">{c.no_show_count || 0}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="label-eyebrow">Annullate</div>
          <div className="text-3xl font-serif-display mt-1">{c.cancelled_count || 0}</div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <div className="label-eyebrow mb-3">Meta</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Tag (separati da virgola)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full border border-zinc-200 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Note</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border border-zinc-200 rounded-md px-3 py-2" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={badFlag} onChange={(e) => setBadFlag(e.target.checked)} />
            Cattivo ospite (flag manuale)
          </label>
          <button onClick={save} className="px-4 py-2 rounded-md bg-zinc-900 text-white text-sm">{t("common.save")}</button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-zinc-100 label-eyebrow">{t("customers.history")}</div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-4 py-2 label-eyebrow">{t("common.date")}</th>
              <th className="text-left px-4 py-2 label-eyebrow">{t("common.time")}</th>
              <th className="text-left px-4 py-2 label-eyebrow">{t("common.persons")}</th>
              <th className="text-left px-4 py-2 label-eyebrow">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-zinc-400">—</td></tr>}
            {bookings.map((b) => (
              <tr key={b.id} className="border-t border-zinc-100">
                <td className="px-4 py-2 font-mono">{b.date}</td>
                <td className="px-4 py-2 font-mono">{b.time}</td>
                <td className="px-4 py-2 font-mono">{b.persons}</td>
                <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
