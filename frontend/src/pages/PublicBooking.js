import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Minus, Plus, Check, Sun, Moon } from "lucide-react";
import api from "../api";
import { useI18n, MONTH_NAMES, WEEKDAY_NAMES } from "../i18n";
import LanguageToggle from "../LanguageToggle";

function pad(n) { return String(n).padStart(2, "0"); }
function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

const HERO_BG = "https://images.pexels.com/photos/20184687/pexels-photo-20184687.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";
const SUCCESS_BG = "https://images.unsplash.com/photo-1643101570532-88c8ecc07c1f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwzfHxmaW5lJTIwZGluaW5nJTIwcmVzdGF1cmFudCUyMGludGVyaW9yJTIwZWxlZ2FudHxlbnwwfHx8fDE3ODU0MDU4MzR8MA&ixlib=rb-4.1.0&q=85";

const stepAnim = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3, ease: "easeOut" },
};

export default function PublicBooking() {
  const { subdomain } = useParams();
  const [searchParams] = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const { t, lang } = useI18n();
  const [restaurant, setRestaurant] = useState(null);
  const [servicesOffered, setServicesOffered] = useState([]);
  const [service, setService] = useState(null);
  const [step, setStep] = useState(1);
  const [persons, setPersons] = useState(2);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [monthAvail, setMonthAvail] = useState({});
  const [slots, setSlots] = useState([]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [contact, setContact] = useState({ name: "", email: "", phone: "", message: "", terms: false });
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: "", email: "", phone: "", message: "" });

  useEffect(() => {
    api.get(`/public/restaurant/${subdomain}`).then((r) => setRestaurant(r.data)).catch(() => toast.error("Ristorante non trovato"));
    api.get(`/public/${subdomain}/services`).then((r) => {
      const svcs = r.data.services || [];
      setServicesOffered(svcs);
      // If only one service, pre-select it
      if (svcs.length === 1) setService(svcs[0]);
    }).catch(() => setServicesOffered([]));
  }, [subdomain]);

  // Embed mode: post height to parent for iframe auto-resize
  const shellRef = useRef(null);
  useEffect(() => {
    if (!embed) return;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const post = () => {
      const h = document.body.scrollHeight;
      try {
        window.parent.postMessage(
          { source: "21reservation", type: "height", name: window.name, height: h },
          "*"
        );
      } catch (e) { /* noop */ }
    };
    post();
    const ro = new ResizeObserver(() => post());
    if (shellRef.current) ro.observe(shellRef.current);
    const id = setInterval(post, 800);
    return () => { ro.disconnect(); clearInterval(id); };
  }, [embed, step, confirmed]);

  // Reload month availability whenever service, persons, or month changes and we're at date step
  useEffect(() => {
    if (step !== 3 || !restaurant || !service) return;
    api.get(`/public/${subdomain}/availability/month`, { params: { year, month, persons, service } })
       .then((r) => {
         const m = {};
         (r.data.days || []).forEach((d) => { m[d.date] = d; });
         setMonthAvail(m);
       }).catch(() => {});
  }, [step, year, month, persons, service, restaurant, subdomain]);

  // Load slots when date changes on step 3
  useEffect(() => {
    if (step !== 3 || !selectedDate || !service) { setSlots([]); return; }
    setLoadingSlots(true);
    setSelectedTime(null);
    api.get(`/public/${subdomain}/availability/day`, { params: { date: selectedDate, persons, service } })
       .then((r) => setSlots(r.data.slots || []))
       .catch(() => setSlots([]))
       .finally(() => setLoadingSlots(false));
  }, [step, selectedDate, persons, service, subdomain]);

  const submit = async () => {
    if (!contact.terms) { toast.error("Devi accettare i termini"); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/public/${subdomain}/book`, {
        date: selectedDate, time: selectedTime, persons, service,
        customer_name: contact.name, customer_email: contact.email,
        customer_phone: contact.phone, guest_message: contact.message,
        accept_terms: true,
        origin_url: window.location.origin,
      });
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setConfirmed(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    } finally { setSubmitting(false); }
  };

  const resetAll = () => {
    setStep(1); setPersons(2); setSelectedDate(null); setSelectedTime(null); setService(servicesOffered.length === 1 ? servicesOffered[0] : null);
    setContact({ name: "", email: "", phone: "", message: "", terms: false });
    setConfirmed(false);
    setWaitlistOpen(false); setWaitlistDone(false); setWaitlistForm({ name: "", email: "", phone: "", message: "" });
  };

  const submitWaitlist = async () => {
    if (!waitlistForm.name || !waitlistForm.email || !waitlistForm.phone) {
      toast.error("Compila nome, email e telefono");
      return;
    }
    setWaitlistBusy(true);
    try {
      await api.post(`/public/${subdomain}/waitlist`, {
        date: selectedDate,
        persons,
        service,
        preferred_time: selectedTime || null,
        customer_name: waitlistForm.name,
        customer_email: waitlistForm.email,
        customer_phone: waitlistForm.phone,
        message: waitlistForm.message || null,
      });
      setWaitlistDone(true);
      toast.success("Sei in lista d'attesa!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    } finally {
      setWaitlistBusy(false);
    }
  };

  const totalSteps = 4;

  return (
    <div className={embed ? "public-shell public-shell-embed" : "public-shell"} ref={shellRef}
         style={{ "--r21-accent": restaurant?.accent_color || "#D97706" }}>
      {!embed && (
        <>
          {(() => {
            const hero = restaurant?.hero_image_url || HERO_BG;
            return hero
              ? <img src={hero} alt="" className="fixed inset-0 h-full w-full object-cover opacity-30" style={{ zIndex: 0 }} />
              : null;
          })()}
          <div className="fixed inset-0 bg-black/40" style={{ zIndex: 0 }} />
        </>
      )}

      <div className={embed ? "relative z-10 flex flex-col" : "relative z-10 min-h-screen flex flex-col"}>
        {!embed && (
          <header className="px-6 md:px-12 py-6 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">{t("book.by")}</div>
              <div className="serif-title text-2xl mt-0.5">{restaurant?.name || "…"}</div>
            </div>
            <LanguageToggle dark />
          </header>
        )}

        <div className={embed
          ? "flex items-start justify-center px-3 md:px-6 py-4"
          : "flex-1 flex items-center justify-center px-4 md:px-10 pb-10"}>
          <div className={embed
            ? "glass w-full max-w-2xl p-5 md:p-8 relative"
            : "glass w-full max-w-3xl p-6 md:p-12 relative"} data-testid="public-wizard">
            {!confirmed && (
              <div className="flex items-center gap-2 mb-8">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                  <div key={s} className="flex-1 h-[2px] rounded-full transition-colors"
                       style={{ backgroundColor: s <= step ? "#D97706" : "rgba(255,255,255,0.15)" }} />
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              {confirmed ? (
                <motion.div key="done" {...stepAnim} className="text-center py-6">
                  <img src={SUCCESS_BG} alt="" className="w-full h-40 object-cover rounded-xl mb-6 opacity-70" />
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">{t("app.name")}</div>
                  <h2 className="serif-title text-5xl md:text-6xl mt-2">{t("book.thanks_title")}</h2>
                  <p className="text-white/70 mt-4 max-w-md mx-auto">{t("book.thanks_body")}</p>
                  <div className="mt-6 inline-flex flex-col items-center gap-2 text-white/80 text-sm font-mono">
                    <div><Check size={14} className="inline mr-1 text-emerald-400" /> {selectedDate} · {selectedTime}</div>
                    <div>{persons} {t("book.persons_label").toLowerCase()} · {t(`book.service_${service}`)}</div>
                  </div>
                  <button onClick={resetAll} data-testid="book-new" className="pill-btn mt-8">
                    {t("book.new_reservation")}
                  </button>
                </motion.div>
              ) : step === 1 ? (
                <motion.div key="s1" {...stepAnim} className="text-center">
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">01 / 0{totalSteps}</div>
                  <h2 className="serif-title text-4xl md:text-5xl mt-3">{t("book.step_service")}</h2>

                  <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                    {["lunch", "dinner"].map((sv) => {
                      const offered = servicesOffered.includes(sv);
                      const isSel = service === sv;
                      const Icon = sv === "lunch" ? Sun : Moon;
                      return (
                        <button
                          key={sv}
                          data-testid={`service-${sv}`}
                          disabled={!offered}
                          onClick={() => setService(sv)}
                          className={`p-8 rounded-2xl border transition-all ${
                            !offered ? "opacity-25 cursor-not-allowed border-white/10"
                              : isSel
                                ? "bg-amber-600 text-black border-amber-600 scale-[1.02]"
                                : "border-white/15 hover:border-white/40 hover:bg-white/5"
                          }`}
                        >
                          <Icon size={36} className="mx-auto mb-3" strokeWidth={1.4} />
                          <div className="serif-title text-3xl">
                            {t(`book.service_${sv}`)}
                          </div>
                          {!offered && (
                            <div className="text-[10px] font-mono uppercase tracking-widest mt-2 opacity-60">
                              non disponibile
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-10 flex justify-center">
                    <button data-testid="step1-next" onClick={() => setStep(2)} disabled={!service} className="pill-btn">
                      {t("book.next")} <ChevronRight size={16} />
                    </button>
                  </div>
                </motion.div>
              ) : step === 2 ? (
                <motion.div key="s2" {...stepAnim} className="text-center">
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400">02 / 0{totalSteps}</div>
                  <h2 className="serif-title text-4xl md:text-5xl mt-3">{t("book.step_persons")}</h2>

                  <div className="mt-10 flex items-center justify-center gap-6">
                    <button data-testid="persons-minus" onClick={() => setPersons(Math.max(1, persons - 1))}
                            className="w-14 h-14 rounded-full border border-white/15 hover:bg-white/10 flex items-center justify-center transition-colors">
                      <Minus size={20} />
                    </button>
                    <div className="w-40 text-center">
                      <div className="serif-title text-8xl" data-testid="persons-count">{persons}</div>
                      <div className="text-xs font-mono uppercase tracking-widest text-white/50 mt-1">
                        {persons === 1 ? "ospite" : t("book.persons_label").toLowerCase()}
                      </div>
                    </div>
                    <button data-testid="persons-plus" onClick={() => setPersons(Math.min(20, persons + 1))}
                            className="w-14 h-14 rounded-full border border-white/15 hover:bg-white/10 flex items-center justify-center transition-colors">
                      <Plus size={20} />
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-8 gap-2 max-w-md mx-auto">
                    {[1,2,3,4,5,6,7,8].map((n) => (
                      <button key={n} data-testid={`persons-quick-${n}`} onClick={() => setPersons(n)}
                              className={`py-2 rounded-full border text-sm transition-colors ${persons === n ? "bg-amber-600 text-black border-amber-600" : "border-white/15 hover:bg-white/5"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-white/40 mt-6">{t("book.large_party_hint")}</p>

                  <div className="mt-10 flex justify-between">
                    <button data-testid="step2-back" onClick={() => setStep(1)} className="pill-ghost">
                      <ChevronLeft size={16} /> {t("book.back")}
                    </button>
                    <button data-testid="step2-next" onClick={() => setStep(3)} className="pill-btn">
                      {t("book.next")} <ChevronRight size={16} />
                    </button>
                  </div>
                </motion.div>
              ) : step === 3 ? (
                <motion.div key="s3" {...stepAnim}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400 text-center">03 / 0{totalSteps}</div>
                  <h2 className="serif-title text-4xl md:text-5xl mt-3 text-center">{t("book.step_datetime")}</h2>
                  <p className="text-white/60 text-center mt-2 font-mono text-xs uppercase tracking-widest">
                    {t(`book.service_${service}`)} · {persons}p
                  </p>

                  <div className="grid md:grid-cols-2 gap-6 mt-8">
                    {/* Calendar */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <button data-testid="month-prev" onClick={() => { if (month === 1) { setMonth(12); setYear(year-1); } else setMonth(month-1); }}
                                className="w-9 h-9 rounded-full border border-white/15 hover:bg-white/10 flex items-center justify-center">
                          <ChevronLeft size={14} />
                        </button>
                        <div className="serif-title text-lg">{MONTH_NAMES[lang][month-1]} {year}</div>
                        <button data-testid="month-next" onClick={() => { if (month === 12) { setMonth(1); setYear(year+1); } else setMonth(month+1); }}
                                className="w-9 h-9 rounded-full border border-white/15 hover:bg-white/10 flex items-center justify-center">
                          <ChevronRight size={14} />
                        </button>
                      </div>

                      <div className="grid grid-cols-7 gap-1 mb-2 text-center">
                        {WEEKDAY_NAMES[lang].map((n) => (
                          <div key={n} className="text-[10px] font-mono uppercase tracking-widest text-white/40">{n.slice(0,3)}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {(() => {
                          const daysInMonth = new Date(year, month, 0).getDate();
                          const first = (new Date(year, month-1, 1).getDay() + 6) % 7;
                          const out = [];
                          for (let i = 0; i < first; i++) out.push(<div key={`e${i}`} />);
                          for (let d = 1; d <= daysInMonth; d++) {
                            const ds = iso(year, month, d);
                            const info = monthAvail[ds];
                            const disabled = !info?.open || !info?.has_availability;
                            const isSel = selectedDate === ds;
                            out.push(
                              <button key={ds} data-testid={`day-${ds}`}
                                      disabled={disabled}
                                      onClick={() => setSelectedDate(ds)}
                                      className={`aspect-square rounded-lg text-sm transition-colors ${
                                        disabled ? "opacity-25 cursor-not-allowed line-through"
                                          : isSel ? "bg-amber-600 text-black"
                                          : "bg-white/5 hover:bg-white/10 text-white"
                                      }`}>
                                {d}
                              </button>
                            );
                          }
                          return out;
                        })()}
                      </div>
                    </div>

                    {/* Slots */}
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">
                        Orario disponibile
                      </div>
                      {!selectedDate ? (
                        <div className="text-white/40 text-sm py-10 text-center border border-dashed border-white/10 rounded-lg">
                          {t("book.pick_date_first")}
                        </div>
                      ) : loadingSlots ? (
                        <div className="text-white/40 text-sm py-6 text-center">{t("common.loading")}</div>
                      ) : slots.length === 0 || slots.every((s) => !s.available) ? (
                        <div className="text-center py-6 border border-dashed border-white/10 rounded-lg" data-testid="no-slots">
                          <div className="text-white/60 text-sm">{t("book.no_slots")}</div>
                          {!waitlistOpen && !waitlistDone && (
                            <button
                              data-testid="btn-open-waitlist"
                              onClick={() => { setWaitlistOpen(true); setWaitlistForm({ ...waitlistForm, name: contact.name, email: contact.email, phone: contact.phone }); }}
                              className="pill-ghost mt-4">
                              Iscrivimi alla lista d'attesa
                            </button>
                          )}
                          {waitlistOpen && !waitlistDone && (
                            <div className="mt-4 space-y-3 text-left max-w-sm mx-auto" data-testid="waitlist-form">
                              <input data-testid="wl-name" value={waitlistForm.name}
                                     onChange={(e) => setWaitlistForm({ ...waitlistForm, name: e.target.value })}
                                     placeholder={t("common.name")}
                                     className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                              <input data-testid="wl-email" type="email" value={waitlistForm.email}
                                     onChange={(e) => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                                     placeholder={t("common.email")}
                                     className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                              <input data-testid="wl-phone" value={waitlistForm.phone}
                                     onChange={(e) => setWaitlistForm({ ...waitlistForm, phone: e.target.value })}
                                     placeholder={t("common.phone")}
                                     className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                              <button data-testid="wl-submit" onClick={submitWaitlist} disabled={waitlistBusy}
                                      className="pill-btn w-full justify-center">
                                {waitlistBusy ? "…" : "Conferma iscrizione"}
                              </button>
                            </div>
                          )}
                          {waitlistDone && (
                            <div className="mt-4 text-emerald-400 text-sm" data-testid="waitlist-done">
                              <Check size={16} className="inline mr-1" />
                              Ti avviseremo appena un tavolo si libera.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 max-h-[280px] overflow-y-auto pr-1">
                          {slots.map((s) => (
                            <button key={s.time} data-testid={`slot-${s.time}`}
                                    disabled={!s.available}
                                    onClick={() => setSelectedTime(s.time)}
                                    className={`slot-chip ${selectedTime === s.time ? "selected" : ""}`}>
                              {s.time}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-10 flex justify-between">
                    <button data-testid="step3-back" onClick={() => setStep(2)} className="pill-ghost">
                      <ChevronLeft size={16} /> {t("book.back")}
                    </button>
                    <button data-testid="step3-next" onClick={() => setStep(4)} disabled={!selectedDate || !selectedTime} className="pill-btn">
                      {t("book.next")} <ChevronRight size={16} />
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="s4" {...stepAnim}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400 text-center">04 / 0{totalSteps}</div>
                  <h2 className="serif-title text-4xl md:text-5xl mt-3 text-center">{t("book.step_contact")}</h2>

                  <div className="mt-8 max-w-md mx-auto space-y-4">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-1 block">{t("common.name")}</label>
                      <input data-testid="contact-name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })}
                             className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-amber-600 transition-colors" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-1 block">{t("common.email")}</label>
                      <input data-testid="contact-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })}
                             className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-amber-600 transition-colors" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-1 block">{t("common.phone")}</label>
                      <input data-testid="contact-phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                             placeholder="+39 …"
                             className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-amber-600 transition-colors" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-1 block">{t("book.optional_message")}</label>
                      <textarea data-testid="contact-message" rows={3} value={contact.message}
                                onChange={(e) => setContact({ ...contact, message: e.target.value })}
                                placeholder={t("book.message_placeholder")}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:border-amber-600 transition-colors" />
                    </div>
                    <label className="flex items-start gap-2 text-sm text-white/70">
                      <input data-testid="contact-terms" type="checkbox" checked={contact.terms}
                             onChange={(e) => setContact({ ...contact, terms: e.target.checked })}
                             className="mt-1 accent-amber-600" />
                      <span>{t("book.terms")}</span>
                    </label>
                    <div className="text-xs font-mono text-white/50 pt-2 border-t border-white/10 space-y-1">
                      <div>{t(`book.service_${service}`)}</div>
                      <div>{selectedDate} · {selectedTime}</div>
                      <div>{persons} {t("book.persons_label").toLowerCase()}</div>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-between">
                    <button data-testid="step4-back" onClick={() => setStep(3)} className="pill-ghost">
                      <ChevronLeft size={16} /> {t("book.back")}
                    </button>
                    <button data-testid="step4-submit" onClick={submit} disabled={submitting || !contact.name || !contact.email || !contact.phone || !contact.terms}
                            className="pill-btn">
                      {submitting ? "…" : t("book.confirm")} <Check size={16} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {!embed && (
          <footer className="px-6 md:px-12 py-5 text-xs text-white/40 font-mono tracking-widest uppercase text-center">
            {t("app.name")} · {restaurant?.address || ""}
          </footer>
        )}
      </div>
    </div>
  );
}
