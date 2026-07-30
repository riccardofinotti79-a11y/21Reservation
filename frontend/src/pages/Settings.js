import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
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

        <Section title="Depositi grandi gruppi (Stripe)" subtitle="Richiedi un deposito ai gruppi sopra la soglia. Il deposito viene tolto dal totale a fine servizio.">
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

        <Section title="WhatsApp (opzionale)" subtitle="Config per l'invio via WhatsApp. L'invio reale si attiva solo quando il provider è configurato.">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-wa-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.whatsapp_enabled}
                   onChange={(e) => set("whatsapp_enabled", e.target.checked)} />
            Abilita WhatsApp
          </label>
          <Field label="Provider">
            <select disabled={!isOwner || !form.whatsapp_enabled}
                    value={form.whatsapp_provider}
                    onChange={(e) => set("whatsapp_provider", e.target.value)} className="input">
              <option value="">— non configurato —</option>
              <option value="twilio">Twilio</option>
              <option value="meta">Meta Cloud API</option>
            </select>
          </Field>
          <Field label="Numero mittente">
            <input disabled={!isOwner || !form.whatsapp_enabled}
                   value={form.whatsapp_from}
                   onChange={(e) => set("whatsapp_from", e.target.value)} className="input"
                   placeholder="+390212345678" />
          </Field>
        </Section>
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
