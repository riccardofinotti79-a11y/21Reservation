import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Loader2, X } from "lucide-react";
import api from "../api";

export default function PaymentResult({ mode }) {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const bookingId = params.get("booking_id");
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    if (mode === "cancel") { setState({ status: "cancel" }); return; }
    if (!sessionId) { setState({ status: "cancel" }); return; }
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const { data } = await api.get(`/payments/status/${sessionId}`);
        if (data.deposit_status === "paid") { setState({ status: "paid", data }); return; }
        if (data.deposit_status === "failed") { setState({ status: "failed" }); return; }
        if (attempts >= 12) { setState({ status: "timeout" }); return; }
        setTimeout(poll, 2000);
      } catch (e) {
        if (attempts >= 3) { setState({ status: "failed" }); return; }
        setTimeout(poll, 2000);
      }
    };
    poll();
  }, [mode, sessionId]);

  return (
    <div className="public-shell">
      <div className="fixed inset-0 bg-black/40" style={{ zIndex: 0 }} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="glass w-full max-w-lg p-10 text-center" data-testid="payment-result">
          {state.status === "loading" && (
            <>
              <Loader2 size={40} className="mx-auto text-amber-400 mb-4 animate-spin" />
              <h1 className="serif-title text-3xl">Attendo conferma del deposito…</h1>
              <p className="text-white/60 mt-2 text-sm font-mono">session: {sessionId?.slice(0, 24)}…</p>
            </>
          )}
          {state.status === "paid" && (
            <>
              <Check size={40} className="mx-auto text-emerald-400 mb-4" />
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">21Reservation</div>
              <h1 className="serif-title text-4xl mt-2">Deposito ricevuto</h1>
              <p className="text-white/70 mt-4">La prenotazione è ora confermata. Riceverai una email a breve.</p>
            </>
          )}
          {state.status === "cancel" && (
            <>
              <X size={40} className="mx-auto text-amber-400 mb-4" />
              <h1 className="serif-title text-4xl">Pagamento annullato</h1>
              <p className="text-white/70 mt-4">
                Il deposito non è stato completato. Torna al ristorante per riprovare o contattalo direttamente.
              </p>
            </>
          )}
          {state.status === "failed" && (
            <>
              <X size={40} className="mx-auto text-red-400 mb-4" />
              <h1 className="serif-title text-4xl">Deposito fallito</h1>
              <p className="text-white/70 mt-4">Riprova o contatta il ristorante.</p>
            </>
          )}
          {state.status === "timeout" && (
            <>
              <Loader2 size={40} className="mx-auto text-amber-400 mb-4" />
              <h1 className="serif-title text-3xl">In elaborazione</h1>
              <p className="text-white/70 mt-4">
                Il pagamento è ancora in verifica. Riceverai una email quando sarà completato.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
