import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import api from "../api";

export default function PublicCancel() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/public/cancel/${token}`)
       .then((r) => { setInfo(r.data); setDone(r.data.already_cancelled); })
       .catch(() => setErr("Link non valido o scaduto"))
       .finally(() => setLoading(false));
  }, [token]);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/public/cancel/${token}`);
      setDone(true);
      toast.success("Prenotazione disdetta");
    } catch { toast.error("Errore"); }
    finally { setBusy(false); }
  };

  return (
    <div className="public-shell">
      <div className="fixed inset-0 bg-black/40" style={{ zIndex: 0 }} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="glass w-full max-w-lg p-10 text-center" data-testid="cancel-shell">
          {loading ? (
            <div className="text-white/60">Caricamento…</div>
          ) : err ? (
            <>
              <X size={40} className="mx-auto text-red-400 mb-4" />
              <h1 className="serif-title text-3xl">Ops!</h1>
              <p className="text-white/70 mt-2">{err}</p>
            </>
          ) : done ? (
            <>
              <Check size={40} className="mx-auto text-emerald-400 mb-4" />
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">21Reservation</div>
              <h1 className="serif-title text-4xl mt-2">Prenotazione disdetta</h1>
              <p className="text-white/70 mt-4">
                Grazie per averci avvisato. Il tavolo tornerà disponibile per altri ospiti.
              </p>
              <div className="mt-4 text-xs font-mono text-white/50">
                {info?.restaurant_name} · {info?.date} · {info?.time}
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">21Reservation</div>
              <h1 className="serif-title text-4xl mt-2">Vuoi disdire?</h1>
              <p className="text-white/70 mt-4">Confermi la disdetta di questa prenotazione?</p>
              <div className="mt-6 py-4 border-y border-white/10 text-sm text-white/80 font-mono">
                <div>{info?.restaurant_name}</div>
                <div className="mt-1">{info?.date} · {info?.time}</div>
                <div>{info?.persons} ospiti · {info?.customer_name}</div>
              </div>
              <button data-testid="cancel-confirm" onClick={cancel} disabled={busy}
                      className="pill-btn mt-6 mx-auto">
                {busy ? "…" : "Disdici la prenotazione"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
