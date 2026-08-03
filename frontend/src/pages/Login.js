import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import LanguageToggle from "../LanguageToggle";

export default function Login() {
  const { t } = useI18n();
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("owner@demo.com");
  const [password, setPassword] = useState("demo1234");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await login(email, password);
      if (data?.user?.role === "agency_admin") nav("/admin");
      else nav("/");
    } catch (err) {
      toast.error(t("login.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#F8F9FA] grid lg:grid-cols-2">
      {/* Left panel */}
      <div className="hidden lg:flex relative overflow-hidden">
        <img
          src="https://images.pexels.com/photos/20184687/pexels-photo-20184687.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 p-14 flex flex-col justify-between text-white w-full">
          <div className="label-eyebrow" style={{ color: "#D97706" }}>21Reservation</div>
          <div>
            <div className="font-serif-display text-6xl leading-none">Il tuo servizio.<br/>In tempo reale.</div>
            <p className="mt-6 max-w-md text-white/70">
              Prenotazioni, tavoli e ospiti su un unico pannello sincronizzato tra tutti i dispositivi.
            </p>
          </div>
          <div className="text-xs text-white/50 font-mono uppercase tracking-widest">Milan · IT</div>
        </div>
      </div>
      {/* Right panel */}
      <div className="flex items-center justify-center p-6 lg:p-16">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between mb-10">
            <div className="label-eyebrow">{t("app.name")}</div>
            <LanguageToggle />
          </div>
          <h1 className="font-serif-display text-5xl mb-2">{t("login.title")}</h1>
          <p className="text-zinc-500 mb-10">{t("login.subtitle")}</p>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label-eyebrow mb-2 block">{t("login.email")}</label>
              <input
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-zinc-200 bg-white px-4 py-3 rounded-md focus:border-zinc-900 transition-colors"
                required
              />
            </div>
            <div>
              <label className="label-eyebrow mb-2 block">{t("login.password")}</label>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-zinc-200 bg-white px-4 py-3 rounded-md focus:border-zinc-900 transition-colors"
                required
              />
            </div>
            <button
              data-testid="login-submit"
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-md bg-zinc-900 hover:bg-zinc-700 text-white font-semibold tracking-wide transition-colors disabled:opacity-50"
            >
              {busy ? "…" : t("login.submit")}
            </button>
          </form>
          <p className="mt-8 text-xs text-zinc-400 font-mono">{t("login.demo_hint")}</p>
          <p className="mt-3 text-xs text-zinc-500">
            Pagina pubblica demo: <a className="underline hover:text-zinc-900" href="/book/demo" data-testid="link-public-demo">/book/demo</a>
          </p>
        </div>
      </div>
    </div>
  );
}
