import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Send, Loader2, Check } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import { HERO_PRESETS, ACCENT_COLORS } from "../themePresets";

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
      description: data.description || "",
      hero_image_url: data.hero_image_url || "",
      theme_preset: data.theme_preset || "",
      accent_color: data.accent_color || "#D97706",
      currency: data.currency || "EUR",
      timezone: data.timezone || "Europe/Rome",
      reminder_enabled: data.reminder_enabled !== false,
      reminder_lead_hours: data.reminder_lead_hours ?? 24,
      whatsapp_enabled: !!data.whatsapp_enabled,
      whatsapp_provider: data.whatsapp_provider || "",
      whatsapp_from: data.whatsapp_from || "",
      whatsapp_twilio_sid: data.whatsapp_twilio_sid || "",
      whatsapp_twilio_auth_token: data.whatsapp_twilio_auth_token || "",
      whatsapp_meta_phone_id: data.whatsapp_meta_phone_id || "",
      whatsapp_meta_access_token: data.whatsapp_meta_access_token || "",
      deposit_enabled: !!data.deposit_enabled,
      deposit_threshold_persons: data.deposit_threshold_persons ?? 8,
      deposit_amount_per_person: data.deposit_amount_per_person ?? 20,
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!isOwner) return;
    setBusy(true);
    try { await api.patch("/restaurant", form); toast.success("Impostazioni salvate"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
    finally { setBusy(false); }
  };

  const testWhatsApp = async () => {
    if (!waTest.to) { toast.error("Inserisci un numero (formato E.164)"); return; }
    setWaTest((s) => ({ ...s, busy: true }));
    try { await api.post("/whatsapp/test", { to: waTest.to }); toast.success("Test inviato"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Invio fallito"); }
    finally { setWaTest((s) => ({ ...s, busy: false })); }
  };

  if (!form) return <div className="p-8 text-zinc-400">Caricamento…</div>;
  const set = (k, v) => setForm({ ...form, [k]: v });

  const applyPreset = (p) => setForm({ ...form, theme_preset: p.key, hero_image_url: p.hero, accent_color: p.accent });

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Config</div>
          <h1 className="font-serif-display text-5xl text-zinc-900 dark:text-zinc-50">Impostazioni</h1>
        </div>
        {isOwner && (
          <button data-testid="settings-save" onClick={save} disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50">
            <Save size={16} /> {t("common.save")}
          </button>
        )}
      </div>

      {!isOwner && (
        <div className="mb-6 p-4 border border-amber-200 bg-amber-50 dark:bg-amber-950/50 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
          Sola lettura — solo l'owner può modificare queste impostazioni.
        </div>
      )}

      <div className="space-y-6">
        <Section title="Generale" subtitle="Questi dati sono visibili anche nella pagina pubblica di prenotazione.">
          <Field label="Nome ristorante"><input data-testid="s-name" disabled={!isOwner} value={form.name} onChange={(e) => set("name", e.target.value)} className="input" /></Field>
          <Field label="Indirizzo"><input data-testid="s-address" disabled={!isOwner} value={form.address} onChange={(e) => set("address", e.target.value)} className="input" /></Field>
          <Field label="Telefono"><input data-testid="s-phone" disabled={!isOwner} value={form.phone} onChange={(e) => set("phone", e.target.value)} className="input" /></Field>
          <Field label="Email"><input data-testid="s-email" disabled={!isOwner} value={form.email} onChange={(e) => set("email", e.target.value)} className="input" /></Field>
          <div className="md:col-span-2">
            <label className="label-eyebrow block mb-1">Descrizione (mostrata nel wizard pubblico)</label>
            <textarea data-testid="s-description" disabled={!isOwner} rows={3} value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder="Es. Cucina italiana contemporanea con vista sui Navigli…"
                      className="input" />
          </div>
          <Field label="Valuta"><input disabled={!isOwner} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className="input" /></Field>
          <Field label="Timezone"><input disabled={!isOwner} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className="input" /></Field>
        </Section>

        <Section title="Pagina di prenotazione" subtitle="Scegli un tema preimpostato oppure inserisci una tua immagine di sfondo.">
          <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {HERO_PRESETS.map((p) => {
              const active = form.theme_preset === p.key;
              return (
                <button
                  key={p.key}
                  data-testid={`preset-${p.key}`}
                  disabled={!isOwner}
                  onClick={() => applyPreset(p)}
                  className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all ${active ? "border-zinc-900 dark:border-zinc-100 shadow-lg" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"}`}
                >
                  <div className="absolute inset-0"
                       style={p.hero
                         ? { backgroundImage: `url(${p.hero})`, backgroundSize: "cover", backgroundPosition: "center" }
                         : { background: `linear-gradient(135deg, ${p.accent} 0%, #09090b 80%)` }} />
                  <div className="absolute inset-0 bg-black/45" />
                  <div className="absolute inset-0 p-2 flex flex-col justify-end items-start text-white">
                    <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">{p.key}</div>
                    <div className="text-sm font-semibold">{p.label}</div>
                  </div>
                  {active && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-zinc-900 flex items-center justify-center">
                      <Check size={14} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="md:col-span-2">
            <label className="label-eyebrow block mb-1">URL immagine personalizzata (opzionale, sostituisce il preset)</label>
            <input data-testid="s-hero-url" disabled={!isOwner} value={form.hero_image_url}
                   onChange={(e) => set("hero_image_url", e.target.value)}
                   placeholder="https://…/immagine.jpg"
                   className="input" />
          </div>

          <div className="md:col-span-2">
            <label className="label-eyebrow block mb-2">Colore accent</label>
            <div className="flex items-center gap-2 flex-wrap">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.key}
                  data-testid={`accent-${c.key}`}
                  disabled={!isOwner}
                  onClick={() => set("accent_color", c.value)}
                  title={c.label}
                  className={`w-10 h-10 rounded-full border-2 transition-transform ${form.accent_color?.toLowerCase() === c.value.toLowerCase() ? "border-zinc-900 dark:border-zinc-100 scale-110" : "border-transparent hover:scale-105"}`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
              <input type="color" disabled={!isOwner} value={form.accent_color}
                     onChange={(e) => set("accent_color", e.target.value)}
                     className="w-10 h-10 rounded-full border-2 border-zinc-200 cursor-pointer" />
              <input disabled={!isOwner} value={form.accent_color}
                     onChange={(e) => set("accent_color", e.target.value)}
                     className="input max-w-[140px] font-mono text-sm" />
            </div>
          </div>
        </Section>

        <Section title="Reminder automatici" subtitle="Email 24h prima con link di auto-cancellazione. WhatsApp opzionale.">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-reminder-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.reminder_enabled} onChange={(e) => set("reminder_enabled", e.target.checked)} />
            Abilita reminder
          </label>
          <Field label="Ore di anticipo">
            <input data-testid="s-reminder-hours" type="number" min={1} max={168} disabled={!isOwner || !form.reminder_enabled}
                   value={form.reminder_lead_hours} onChange={(e) => set("reminder_lead_hours", Number(e.target.value))} className="input" />
          </Field>
        </Section>

        <Section title="Depositi" subtitle="Richiedi un anticipo online per prenotazioni con molti ospiti.">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-deposit-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.deposit_enabled} onChange={(e) => set("deposit_enabled", e.target.checked)} />
            Abilita deposito prenotazione
          </label>
          <Field label="Soglia ospiti (deposito richiesto da)">
            <input data-testid="s-deposit-threshold" type="number" min={1} disabled={!isOwner || !form.deposit_enabled}
                   value={form.deposit_threshold_persons} onChange={(e) => set("deposit_threshold_persons", Number(e.target.value))} className="input" />
          </Field>
          <Field label="Importo per ospite (EUR)">
            <input data-testid="s-deposit-amount" type="number" min={0} step={0.5} disabled={!isOwner || !form.deposit_enabled}
                   value={form.deposit_amount_per_person} onChange={(e) => set("deposit_amount_per_person", Number(e.target.value))} className="input" />
          </Field>
        </Section>

        <Section title="WhatsApp" subtitle="Invia conferme e reminder anche via WhatsApp. Confronta i costi prima di scegliere.">
          <div className="md:col-span-2 border border-zinc-200 dark:border-zinc-800 rounded-md p-3 bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
            <div><strong>Meta Cloud API</strong>: 1000 conversazioni/mese gratis, poi ~$0.005-0.10 per conversazione.</div>
            <div><strong>Twilio WhatsApp</strong>: nessun tier gratuito. Sandbox immediato per test.</div>
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input data-testid="s-wa-enabled" type="checkbox" disabled={!isOwner}
                   checked={form.whatsapp_enabled} onChange={(e) => set("whatsapp_enabled", e.target.checked)} />
            Abilita WhatsApp
          </label>
          <Field label="Provider">
            <select data-testid="s-wa-provider" disabled={!isOwner || !form.whatsapp_enabled}
                    value={form.whatsapp_provider} onChange={(e) => set("whatsapp_provider", e.target.value)} className="input">
              <option value="">— seleziona —</option>
              <option value="twilio">Twilio</option>
              <option value="meta">Meta Cloud API</option>
            </select>
          </Field>
          <Field label="Numero mittente (E.164)">
            <input data-testid="s-wa-from" disabled={!isOwner || !form.whatsapp_enabled}
                   value={form.whatsapp_from} onChange={(e) => set("whatsapp_from", e.target.value)}
                   className="input" placeholder="+390212345678" />
          </Field>
          {form.whatsapp_provider === "twilio" && (
            <>
              <Field label="Twilio Account SID"><input data-testid="s-wa-twilio-sid" disabled={!isOwner || !form.whatsapp_enabled} value={form.whatsapp_twilio_sid} onChange={(e) => set("whatsapp_twilio_sid", e.target.value)} className="input" /></Field>
              <Field label="Twilio Auth Token"><input data-testid="s-wa-twilio-token" type="password" disabled={!isOwner || !form.whatsapp_enabled} value={form.whatsapp_twilio_auth_token} onChange={(e) => set("whatsapp_twilio_auth_token", e.target.value)} className="input" /></Field>
            </>
          )}
          {form.whatsapp_provider === "meta" && (
            <>
              <Field label="Meta Phone Number ID"><input data-testid="s-wa-meta-phone" disabled={!isOwner || !form.whatsapp_enabled} value={form.whatsapp_meta_phone_id} onChange={(e) => set("whatsapp_meta_phone_id", e.target.value)} className="input" /></Field>
              <Field label="Meta Access Token"><input data-testid="s-wa-meta-token" type="password" disabled={!isOwner || !form.whatsapp_enabled} value={form.whatsapp_meta_access_token} onChange={(e) => set("whatsapp_meta_access_token", e.target.value)} className="input" /></Field>
            </>
          )}
          {isOwner && form.whatsapp_enabled && form.whatsapp_provider && (
            <div className="md:col-span-2 mt-2 flex flex-col md:flex-row gap-2 items-stretch md:items-end border-t border-zinc-100 dark:border-zinc-800 pt-4">
              <div className="flex-1">
                <label className="label-eyebrow block mb-1">Prova l'invio</label>
                <input data-testid="wa-test-to" value={waTest.to} onChange={(e) => setWaTest({ ...waTest, to: e.target.value })}
                       placeholder="+391112223333" className="input" />
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

      <style>{`.input { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: var(--surface); color: var(--ink); } .input:disabled { background: var(--surface-3); color: var(--ink-3); }`}</style>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
      <div className="mb-4">
        <div className="label-eyebrow">Sezione</div>
        <div className="font-serif-display text-2xl text-zinc-900 dark:text-zinc-50">{title}</div>
        {subtitle && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const sub = subdomain || "demo";
  const snippet = useMemo(() => {
    if (mode === "inline") {
      return `<!-- 21Reservation booking widget -->\n<div data-21r-widget data-subdomain="${sub}"></div>\n<script src="${origin}/widget.js" async></script>`;
    }
    return `<!-- 21Reservation floating button -->\n<div data-21r-widget\n     data-subdomain="${sub}"\n     data-mode="button"\n     data-label="Prenota un tavolo"></div>\n<script src="${origin}/widget.js" async></script>`;
  }, [mode, sub, origin]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5" data-testid="embed-section">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Sezione</div>
          <div className="font-serif-display text-2xl text-zinc-900 dark:text-zinc-50">Widget embed</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Incolla lo snippet nel sito del ristorante.</div>
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700">
          {["inline", "button"].map((m) => (
            <button key={m} data-testid={`embed-mode-${m}`} onClick={() => setMode(m)}
                    className={`px-4 py-1.5 text-xs font-mono uppercase tracking-widest ${mode === m ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300"}`}>
              {m === "inline" ? "Inline" : "Button"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <pre className="bg-zinc-950 text-zinc-100 rounded-md p-4 overflow-x-auto text-xs leading-relaxed" data-testid="embed-snippet">
{snippet}
        </pre>
        <button data-testid="embed-copy" onClick={copy}
                className={`absolute top-3 right-3 px-3 py-1 rounded-md text-xs font-mono uppercase tracking-widest ${copied ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"}`}>
          {copied ? "Copiato" : "Copia"}
        </button>
      </div>
      <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        URL diretto: <a href={`/book/${sub}`} target="_blank" rel="noreferrer" className="underline">{origin}/book/{sub}</a>
      </div>
    </div>
  );
}
