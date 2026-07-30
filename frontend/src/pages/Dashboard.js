import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  CalendarDays, List, LayoutGrid, Users, Clock, BarChart3, Table2, LogOut, ExternalLink,
} from "lucide-react";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import LanguageToggle from "../LanguageToggle";

function NavItem({ to, icon: Icon, label, testId }) {
  return (
    <NavLink
      to={to}
      data-testid={testId}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
          isActive
            ? "bg-zinc-900 text-white"
            : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
        }`
      }
    >
      <Icon size={16} strokeWidth={2} />
      <span className="text-sm">{label}</span>
    </NavLink>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { user, restaurant, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen w-full flex bg-[#F8F9FA] font-sans-ui">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-zinc-200 bg-white flex flex-col">
        <div className="p-5 border-b border-zinc-200">
          <div className="label-eyebrow">{t("app.name")}</div>
          <div className="font-serif-display text-2xl mt-1 truncate" title={restaurant?.name}>
            {restaurant?.name || "—"}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="label-eyebrow px-3 py-2">{t("nav.bookings")}</div>
          <NavItem to="/bookings/list" testId="nav-list" icon={List} label={t("nav.list")} />
          <NavItem to="/bookings/calendar" testId="nav-calendar" icon={CalendarDays} label={t("nav.calendar")} />
          <NavItem to="/bookings/timeline" testId="nav-timeline" icon={LayoutGrid} label={t("nav.timeline")} />
          <div className="label-eyebrow px-3 py-2 mt-4">Config</div>
          <NavItem to="/tables" testId="nav-tables" icon={Table2} label={t("nav.tables")} />
          <NavItem to="/hours" testId="nav-hours" icon={Clock} label={t("nav.hours")} />
          <NavItem to="/customers" testId="nav-customers" icon={Users} label={t("nav.customers")} />
          <NavItem to="/reports" testId="nav-reports" icon={BarChart3} label={t("nav.reports")} />
        </nav>

        <div className="p-3 border-t border-zinc-200 space-y-2">
          <a
            data-testid="link-public-booking"
            href={`/book/${restaurant?.subdomain || "demo"}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 rounded-md hover:bg-zinc-100 transition-colors"
          >
            <ExternalLink size={16} />
            {t("nav.public")}
          </a>
          <div className="flex items-center justify-between px-2">
            <div className="text-xs text-zinc-500 truncate" title={user?.email}>{user?.email}</div>
            <LanguageToggle />
          </div>
          <button
            data-testid="btn-logout"
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
          >
            <LogOut size={16} /> {t("nav.logout")}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
