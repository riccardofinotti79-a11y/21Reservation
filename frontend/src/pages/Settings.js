import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Send, Loader2 } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";

export default function Settings() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [r, setR] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [waTest, setWaTest] = useState({ to: "", busy: false });

  const load = useCallback(async () => {
    const { data } = await api.get("/restaurant");
    setR(data);
    setForm({
      name: data.name || "",
      address: data.address || "",
      phone: data.phone || "",
      email: data.email || "",
      currency: data.currency || "EUR",
      language: data.language || "it",
      timezone: data.timezone || "Europe/Rome",
      avg_ticket_per_guest: data.avg_ticket_per_guest ?? 55,
      deposit_enabled: !!data.deposit_enabled,
      deposit_threshold_persons: data.deposit_threshold_persons ?? 8,
      deposit_amount_per_person: data.deposit_amount_per_person ?? 20,
      reminder_enabled: data.reminder_enabled !== false,
      reminder_lead_hours: data.reminder_lead_hours ?? 24,
      whatsapp_enabled: !!data.whatsapp_enabled,
      whatsapp_provider: data.whatsapp_provider || "",
      whatsapp_from: data.whatsapp_from || "",
      whatsapp_twilio_sid: data.whatsapp_twilio_sid || "",
      whatsapp_twilio_auth_token: data.whatsapp_twilio_auth_token || "",
      whatsapp_meta_phone_id: data.whatsapp_meta_phone_id || "",
      whatsapp_meta_access_token: data.whatsapp_meta_access_token || "",
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await api.patch("/restaurant", form);
      toast.success("Impostazioni salvate");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    } finally { setBusy(false); }
  };

  const testWhatsApp = async () => {
    if (!waTest.to) { toast.error("Inserisci un numero (formato E.164, es. +391112223333)"); return; }
    setWaTest((s) => ({ ...s, busy: true }));
    try {
      await api.post("/whatsapp/test", { to: waTest.to });
      toast.success("Messaggio di test inviato");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invio fallito");
    } finally {
      setWaTest((s) => ({ ...s, busy: false }));
    }
  };

  if (!form) return <div className="p-8 text-zinc-400">Caricamento…</div>;

  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Config</div>
          <h1 className="font-serif-display text-5xl">Impostazioni</h1>
        </div>
        {isOwner && (
          <button data-testid="settings-save" onClick={save} disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50">
            <Save size={16} /> {t("common.save")}
          </button>
        )}
      </div>

      {!isOwner && (
        <div className="mb-6 p-4 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-800">
          Sola lettura — solo l'owner può modificare queste impostazioni.
        </div>
      )}

      <div className="space-y-6">
        <Section title="Generale">
          <Field label="Nome"><input data-testid="s-name" disabled={!isOwner} value={form.name} onChange={(e) => set("name", e.target.value)} className="input" /></Field>
          <Field label="Indirizzo"><input data-testid="s-address" disabled={!isOwner} value={form.address} onChange={(e) => set("address", e.target.value)} className="input" /></Field>
          <Field label="Telefono"><input data-testid="s-phone" disabled={!isOwner} value={form.phone} onChange={(e) => set("phone", e.target.value)} className="input" /></Field>
          <Field label="Email"><input data-testid="s-email" disabled={!isOwner} value={form.email} onChange={(e) => set("email", e.target.value)} className="input" /></Field>
          <Field label="Valuta"><input disabled={!isOwner} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className="input" /></Field>
          <Field label="Timezone"><input disabled={!isOwner} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className="input" /></Field>
        </Section>

        <Section title="Revenue & Ticket medio" subtitle="Usato per stimare il fatturato nei Report.">
          <Field label={`Ticket medio per ospite (${form.currency})`}>
            <input data-testid="s-avg-ticket" type="number" step="0.5" min={0}
                   disabled={!isOwner} value={form.avg_ticket_per_guest}
                   onChange={(e) => set("avg_ticket_per_guest", Number(e.target.value))} className="input" />
          </Field>
        </Section>

        <Section title="Depositi grandi gruppi (Stripe)" subtitle="Richiedi un deposito ai gruppi sopra la soglia.">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-deposit-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.deposit_enabled}
                   onChange={(e) => set("deposit_enabled", e.target.checked)} />
            Abilita depositi
          </label>
          <Field label="Soglia (n. persone)">
            <input data-testid="s-deposit-threshold" type="number" min={2} max={40}
                   disabled={!isOwner || !form.deposit_enabled}
                   value={form.deposit_threshold_persons}
                   onChange={(e) => set("deposit_threshold_persons", Number(e.target.value))} className="input" />
          </Field>
          <Field label={`Importo per ospite (${form.currency})`}>
            <input data-testid="s-deposit-amount" type="number" step="0.5" min={0}
                   disabled={!isOwner || !form.deposit_enabled}
                   value={form.deposit_amount_per_person}
                   onChange={(e) => set("deposit_amount_per_person", Number(e.target.value))} className="input" />
          </Field>
        </Section>

        <Section title="Reminder automatici" subtitle="Email 24h prima con link di auto-cancellazione. WhatsApp opzionale.">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-reminder-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.reminder_enabled}
                   onChange={(e) => set("reminder_enabled", e.target.checked)} />
            Abilita reminder
          </label>
          <Field label="Ore di anticipo">
            <input data-testid="s-reminder-hours" type="number" min={1} max={168}
                   disabled={!isOwner || !form.reminder_enabled}
                   value={form.reminder_lead_hours}
                   onChange={(e) => set("reminder_lead_hours", Number(e.target.value))} className="input" />
          </Field>
        </Section>

        <Section title="WhatsApp" subtitle="Invia conferme e reminder anche via WhatsApp. Confronta i costi prima di scegliere.">
          <div className="md:col-span-2 border border-zinc-200 rounded-md p-3 bg-zinc-50 text-xs text-zinc-600 space-y-1">
            <div><strong>Meta Cloud API</strong>: 1000 conversazioni/mese gratis, poi ~$0.005-0.10 per conversazione. Setup più complesso (business verification).</div>
            <div><strong>Twilio WhatsApp</strong>: nessun tier gratuito. Sandbox immediato per test. Costi Twilio ~$0.005/msg + fee Meta pass-through.</div>
          </div>

          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-wa-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.whatsapp_enabled}
                   onChange={(e) => set("whatsapp_enabled", e.target.checked)} />
            Abilita WhatsApp
          </label>
          <Field label="Provider">
            <select data-testid="s-wa-provider" disabled={!isOwner || !form.whatsapp_enabled}
                    value={form.whatsapp_provider}
                    onChange={(e) => set("whatsapp_provider", e.target.value)} className="input">
              <option value="">— seleziona —</option>
              <option value="twilio">Twilio</option>
              <option value="meta">Meta Cloud API</option>
            </select>
          </Field>
          <Field label="Numero mittente (E.164)">
            <input data-testid="s-wa-from" disabled={!isOwner || !form.whatsapp_enabled}
                   value={form.whatsapp_from}
                   onChange={(e) => set("whatsapp_from", e.target.value)} className="input"
                   placeholder="+390212345678" />
          </Field>

          {form.whatsapp_provider === "twilio" && (
            <>
              <Field label="Twilio Account SID">
                <input data-testid="s-wa-twilio-sid" disabled={!isOwner || !form.whatsapp_enabled}
                       value={form.whatsapp_twilio_sid}
                       onChange={(e) => set("whatsapp_twilio_sid", e.target.value)} className="input"
                       placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </Field>
              <Field label="Twilio Auth Token">
                <input data-testid="s-wa-twilio-token" type="password" disabled={!isOwner || !form.whatsapp_enabled}
                       value={form.whatsapp_twilio_auth_token}
                       onChange={(e) => set("whatsapp_twilio_auth_token", e.target.value)} className="input"
                       placeholder="●●●●●●●●●●●●●●●●●●●●●●●●" />
              </Field>
            </>
          )}
          {form.whatsapp_provider === "meta" && (
            <>
              <Field label="Meta Phone Number ID">
                <input data-testid="s-wa-meta-phone" disabled={!isOwner || !form.whatsapp_enabled}
                       value={form.whatsapp_meta_phone_id}
                       onChange={(e) => set("whatsapp_meta_phone_id", e.target.value)} className="input"
                       placeholder="1234567890123456" />
              </Field>
              <Field label="Meta Access Token (permanent)">
                <input data-testid="s-wa-meta-token" type="password" disabled={!isOwner || !form.whatsapp_enabled}
                       value={form.whatsapp_meta_access_token}
                       onChange={(e) => set("whatsapp_meta_access_token", e.target.value)} className="input"
                       placeholder="EAAG●●●●●●●●●●●●●●●●●●●●" />
              </Field>
            </>
          )}

          {isOwner && form.whatsapp_enabled && form.whatsapp_provider && (
            <div className="md:col-span-2 mt-2 flex flex-col md:flex-row gap-2 items-stretch md:items-end border-t border-zinc-100 pt-4">
              <div className="flex-1">
                <label className="label-eyebrow block mb-1">Prova l'invio</label>
                <input data-testid="wa-test-to" value={waTest.to}
                       onChange={(e) => setWaTest({ ...waTest, to: e.target.value })}
                       placeholder="+391112223333"
                       className="input" />
              </div>
              <button data-testid="wa-test-send" onClick={testWhatsApp} disabled={waTest.busy}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50">
                {waTest.busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Invia test
              </button>
            </div>
          )}
        </Section>

        <EmbedSection subdomain={r?.subdomain} />
      </div>

      <style>{`.input { width: 100%; border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px 12px; background: white; } .input:disabled { background: #f4f4f5; color: #71717a; }`}</style>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <div className="mb-4">
        <div className="label-eyebrow">Sezione</div>
        <div className="font-serif-display text-2xl">{title}</div>
        {subtitle && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label-eyebrow block mb-1">{label}</label>
      {children}
    </div>
  );
}

function EmbedSection({ subdomain }) {
  const [mode, setMode] = useState("inline");
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const sub = subdomain || "demo";

  const snippet = useMemo(() => {
    if (mode === "inline") {
      return `<!-- 21Reservation booking widget -->
<div data-21r-widget data-subdomain="${sub}"></div>
<script src="${origin}/widget.js" async></script>`;
    }
    return `<!-- 21Reservation floating button -->
<div data-21r-widget
     data-subdomain="${sub}"
     data-mode="button"
     data-label="Prenota un tavolo"></div>
<script src="${origin}/widget.js" async></script>`;
  }, [mode, sub, origin]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* noop */ }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="embed-section">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Sezione</div>
          <div className="font-serif-display text-2xl">Widget embed</div>
          <div className="text-xs text-zinc-500 mt-1">
            Incolla lo snippet nel sito del ristorante. Il wizard si adatta al colore e alla larghezza del contenitore.
          </div>
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-zinc-200">
          {["inline", "button"].map((m) => (
            <button
              key={m}
              data-testid={`embed-mode-${m}`}
              onClick={() => { setMode(m); setPreviewKey((k) => k + 1); }}
              className={`px-4 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${
                mode === m ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {m === "inline" ? "Inline" : "Button"}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <pre className="bg-zinc-950 text-zinc-100 rounded-md p-4 overflow-x-auto text-xs leading-relaxed" data-testid="embed-snippet">
{snippet}
        </pre>
        <button
          data-testid="embed-copy"
          onClick={copy}
          className={`absolute top-3 right-3 px-3 py-1 rounded-md text-xs font-mono uppercase tracking-widest transition-colors ${
            copied ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          }`}
        >
          {copied ? "Copiato" : "Copia"}
        </button>
      </div>

      <div className="mt-6">
        <div className="label-eyebrow mb-2">Anteprima</div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          {mode === "inline" ? (
            <iframe
              key={previewKey}
              data-testid="embed-preview-iframe"
              title="Preview"
              src={`${origin}/book/${sub}?embed=1`}
              className="w-full rounded-md bg-black"
              style={{ minHeight: 640, border: 0 }}
            />
          ) : (
            <div className="text-center py-8">
              <button
                data-testid="embed-preview-button"
                onClick={() => window.open(`${origin}/book/${sub}?embed=1`, "_blank", "width=900,height=800")}
                className="pill-btn"
                style={{
                  background: "#D97706", color: "#0a0a0a",
                  padding: "12px 22px", borderRadius: 999,
                  fontWeight: 600, boxShadow: "0 8px 24px -8px rgba(217,119,6,.5)",
                }}
              >
                Prenota un tavolo
              </button>
              <div className="text-xs text-zinc-500 mt-3 font-mono">Il bottone apre il wizard in un overlay a schermo intero.</div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-zinc-500 space-y-1">
        <div>URL diretto: <a href={`/book/${sub}`} target="_blank" rel="noreferrer" className="underline">{origin}/book/{sub}</a></div>
        <div>Personalizza il colore del bottone con <code className="font-mono bg-zinc-100 px-1 rounded">data-color="#…"</code>.</div>
      </div>
    </div>
  );
}
