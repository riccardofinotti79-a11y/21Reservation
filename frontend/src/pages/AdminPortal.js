import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Plus, ArrowLeft, LogOut, Trash2, Copy } from "lucide-react";
import api from "../api";
import { useAuth } from "../auth";
import { useTheme } from "../theme";

/** Guard: only agency_admin allowed. */
export function RequireAgencyAdmin({ children }) {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== "agency_admin") {
    return <div className="p-8 max-w-md mx-auto text-center">
      <h2 className="font-serif-display text-3xl mb-2 text-zinc-900 dark:text-zinc-100">Accesso negato</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Questa sezione è riservata all'agenzia.</p>
      <Link to="/" className="text-amber-700 dark:text-amber-400 underline">Torna alla dashboard</Link>
    </div>;
  }
  return children;
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  return (
    <div className="min-h-screen w-full flex bg-[#F8F9FA] dark:bg-zinc-950 font-sans-ui text-zinc-900 dark:text-zinc-100">
      <aside className="hidden lg:flex fixed lg:relative inset-y-0 left-0 z-30 w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-col">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="label-eyebrow">21Reservation</div>
          <div className="font-serif-display text-2xl mt-1 text-zinc-900 dark:text-zinc-100">Portale Agenzia</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono">{user?.email}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink to="/admin" end data-testid="admin-nav-clients"
                   className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
            <Building2 size={16} /> Clienti
          </NavLink>
          <NavLink to="/admin/new" data-testid="admin-nav-new"
                   className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
            <Plus size={16} /> Nuovo cliente
          </NavLink>
        </nav>
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1">
          <button data-testid="admin-theme-toggle" onClick={toggle} className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {dark ? "Tema chiaro" : "Tema scuro"}
          </button>
          <button data-testid="admin-logout" onClick={logout} className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 rounded-md hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-400">
            <LogOut size={16} /> Esci
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto"><Outlet /></main>
    </div>
  );
}

export function AdminClients() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("bookings_30d"); // bookings_30d | bookings_total | name
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/metrics");
      setMetrics(data);
    } catch (e) { toast.error("Errore caricamento"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = metrics?.per_restaurant || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = s ? rows.filter((r) => r.name.toLowerCase().includes(s) || r.subdomain.toLowerCase().includes(s)) : rows.slice();
    if (sortBy === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
    return list;
  }, [rows, q, sortBy]);
  const totals = metrics?.totals;

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6 sm:mb-8 flex-wrap gap-3">
        <div>
          <div className="label-eyebrow">Agenzia</div>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-zinc-900 dark:text-zinc-100">Panoramica</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">Attività aggregata di tutti i clienti dell'agenzia.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <input data-testid="admin-search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Cerca per nome o subdomain…"
                 className="flex-1 sm:w-64 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
          <Link data-testid="admin-btn-new" to="/admin/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-white">
            <Plus size={16} /> Nuovo cliente
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6" data-testid="admin-metrics-cards">
        <MetricCard label="Clienti totali" value={totals?.restaurants_total ?? "—"} testId="metric-restaurants-total" />
        <MetricCard label="Attivi" value={totals?.restaurants_active ?? "—"} testId="metric-restaurants-active" />
        <MetricCard label="Prenotazioni totali" value={totals?.bookings_total ?? "—"} testId="metric-bookings-total" />
        <MetricCard label="Ultimi 30 giorni" value={totals?.bookings_30d ?? "—"} testId="metric-bookings-30d" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{filtered.length} clienti</div>
        <select data-testid="admin-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                className="border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
          <option value="bookings_30d">Ordina: ultimi 30gg</option>
          <option value="bookings_total">Ordina: totali</option>
          <option value="name">Ordina: nome</option>
        </select>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden" data-testid="admin-clients-list">
        {loading && <div className="p-12 text-center text-zinc-400 dark:text-zinc-500">…</div>}
        {!loading && filtered.length === 0 && (
          <div className="p-12 text-center text-zinc-400 dark:text-zinc-500">Nessun cliente</div>
        )}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {filtered.map((r) => (
            <Link key={r.id} to={`/admin/${r.id}`} data-testid={`admin-client-row-${r.subdomain}`}
                  className="flex flex-wrap items-center gap-3 sm:gap-6 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <div className="font-medium text-zinc-900 dark:text-zinc-100 break-words">{r.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">/{r.subdomain}</div>
              </div>
              <MiniStat label="Totali" value={r.bookings_total} />
              <MiniStat label="30gg" value={r.bookings_30d} highlight />
              <MiniStat label="7gg" value={r.bookings_7d} />
              <MiniStat label="Ospiti" value={r.guests_total} />
              <MiniStat label="CRM" value={r.customers_count} />
              <span className={`status-pill ${r.status === "active" ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60" : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60"}`}>
                {r.status === "active" ? "Attivo" : "Sospeso"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, testId }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 sm:p-5">
      <div className="label-eyebrow">{label}</div>
      <div className="text-3xl sm:text-4xl font-serif-display mt-2 text-zinc-900 dark:text-zinc-100" data-testid={testId}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, highlight }) {
  return (
    <div className="flex flex-col items-start sm:items-end min-w-[64px]">
      <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className={`font-mono text-sm ${highlight ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}>{value}</div>
    </div>
  );
}

export function AdminClientNew() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    restaurant_name: "", subdomain: "",
    owner_name: "", owner_email: "", owner_password: "", language: "it",
  });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/admin/restaurants", form);
      setCreated(data);
      toast.success("Cliente creato");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    } finally { setBusy(false); }
  };

  if (created) {
    return (
      <div className="p-4 sm:p-8 max-w-lg mx-auto">
        <h1 className="font-serif-display text-3xl sm:text-4xl text-zinc-900 dark:text-zinc-100 mb-2">Cliente creato ✓</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Consegna queste credenziali all'owner del ristorante.</p>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-3 mb-4">
          <div><div className="label-eyebrow">Ristorante</div><div className="font-medium text-zinc-900 dark:text-zinc-100">{created.restaurant.name}</div></div>
          <div><div className="label-eyebrow">Subdomain</div><div className="font-mono text-sm text-zinc-900 dark:text-zinc-100">/{created.restaurant.subdomain}</div></div>
          <div><div className="label-eyebrow">Email owner</div><div className="font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all">{created.credentials.email}</div></div>
          <div><div className="label-eyebrow">Password</div>
            <div className="flex items-center gap-2">
              <div data-testid="admin-created-password" className="font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all flex-1">{created.credentials.password}</div>
              <button onClick={() => { navigator.clipboard.writeText(created.credentials.password); toast.success("Copiato"); }}
                      className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"><Copy size={14} /></button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => nav("/admin")} className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200">Torna ai clienti</button>
          <button data-testid="admin-goto-detail" onClick={() => nav(`/admin/${created.restaurant.id}`)}
                  className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">Apri dettaglio</button>
        </div>
      </div>
    );
  }

  const cls = "w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100";
  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <Link to="/admin" className="text-sm text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Clienti</Link>
      <h1 className="font-serif-display text-3xl sm:text-4xl text-zinc-900 dark:text-zinc-100 mb-2">Nuovo cliente</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Crea un ristorante e il suo utente owner. Le credenziali verranno mostrate dopo il salvataggio.</p>
      <form onSubmit={submit} className="space-y-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <div>
          <label className="label-eyebrow block mb-1">Nome ristorante</label>
          <input data-testid="admin-new-restaurant-name" value={form.restaurant_name} onChange={(e) => set("restaurant_name", e.target.value)} required className={cls} />
        </div>
        <div>
          <label className="label-eyebrow block mb-1">Subdomain</label>
          <input data-testid="admin-new-subdomain" value={form.subdomain} onChange={(e) => set("subdomain", e.target.value.toLowerCase().replace(/\s+/g, ""))} required className={cls} placeholder="es. villa-rosa" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label-eyebrow block mb-1">Nome owner</label>
            <input data-testid="admin-new-owner-name" value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} required className={cls} />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Email owner</label>
            <input data-testid="admin-new-owner-email" type="email" value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} required className={cls} />
          </div>
        </div>
        <div>
          <label className="label-eyebrow block mb-1">Password owner</label>
          <input data-testid="admin-new-owner-password" type="text" value={form.owner_password} onChange={(e) => set("owner_password", e.target.value)} required minLength={6} className={cls} />
        </div>
        <button data-testid="admin-new-submit" disabled={busy} className="w-full py-2.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold disabled:opacity-50">
          {busy ? "…" : "Crea cliente"}
        </button>
      </form>
    </div>
  );
}

export function AdminClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "staff" });
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/restaurants/${id}`);
      setData(data);
    } catch (e) { toast.error("Errore"); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const toggleStatus = async () => {
    const newStatus = data.restaurant.status === "active" ? "suspended" : "active";
    try {
      const { data: r } = await api.patch(`/admin/restaurants/${id}`, { status: newStatus });
      setData((s) => ({ ...s, restaurant: r }));
      toast.success(newStatus === "active" ? "Riattivato" : "Sospeso");
    } catch (e) { toast.error("Errore"); }
  };

  const addUser = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/admin/restaurants/${id}/users`, newUser);
      setNewUser({ name: "", email: "", password: "", role: "staff" });
      setShowAdd(false);
      toast.success("Utente aggiunto");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  const removeUser = async (uid) => {
    if (!window.confirm("Rimuovere questo utente?")) return;
    try {
      await api.delete(`/admin/users/${uid}`);
      toast.success("Rimosso");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  if (loading) return <div className="p-8 text-zinc-400 dark:text-zinc-500">…</div>;
  if (!data) return <div className="p-8 text-zinc-400 dark:text-zinc-500">Non trovato</div>;
  const cls = "w-full border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100";

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <Link to="/admin" className="text-sm text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Clienti</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <div className="label-eyebrow">Cliente</div>
          <h1 className="font-serif-display text-3xl sm:text-4xl text-zinc-900 dark:text-zinc-100 break-words" data-testid="admin-client-name">{data.restaurant.name}</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">/{data.restaurant.subdomain}</div>
        </div>
        <button data-testid="admin-toggle-status" onClick={toggleStatus}
                className={`px-3 py-2 rounded-md text-sm border ${data.restaurant.status === "active" ? "border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60" : "border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/60"}`}>
          {data.restaurant.status === "active" ? "Attivo — sospendi" : "Sospeso — riattiva"}
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden mb-6">
        <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="font-serif-display text-xl text-zinc-900 dark:text-zinc-100">Utenti ({data.users.length})</div>
          <button data-testid="admin-add-user" onClick={() => setShowAdd((v) => !v)}
                  className="text-sm inline-flex items-center gap-1 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Plus size={14} /> Aggiungi
          </button>
        </div>
        {showAdd && (
          <form onSubmit={addUser} className="p-4 border-b border-zinc-100 dark:border-zinc-800 space-y-3 bg-zinc-50 dark:bg-zinc-800/40">
            <input data-testid="admin-new-user-name" required placeholder="Nome" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className={cls} />
            <input data-testid="admin-new-user-email" required type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={cls} />
            <input data-testid="admin-new-user-password" required minLength={6} placeholder="Password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className={cls} />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className={cls}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
            <div className="flex gap-2">
              <button data-testid="admin-new-user-submit" className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm">Crea</button>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm">Annulla</button>
            </div>
          </form>
        )}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.users.map((u) => (
            <div key={u.id} className="p-4 flex items-center gap-3" data-testid={`admin-user-row-${u.email}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100 break-words">{u.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono break-all">{u.email}</div>
              </div>
              <span className="text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200">{u.role}</span>
              <button data-testid={`admin-delete-user-${u.email}`} onClick={() => removeUser(u.id)}
                      className="p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-950 text-red-700 dark:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
          {data.users.length === 0 && <div className="p-8 text-center text-zinc-400 dark:text-zinc-500 text-sm">Nessun utente</div>}
        </div>
      </div>
    </div>
  );
}
