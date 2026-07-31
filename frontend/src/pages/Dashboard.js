import React, { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import {
  CalendarDays, List, LayoutGrid, Users, Clock, BarChart3, Table2, LogOut,
  ExternalLink, Grid3x3, Settings as SettingsIcon, Menu, X, Home as HomeIcon, ClipboardList,
  Moon, Sun,
} from "lucide-react";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import { useTheme } from "../theme";
import LanguageToggle from "../LanguageToggle";

function NavItem({ to, icon: Icon, label, testId, onClick }) {
  return (
    <NavLink
      to={to}
      data-testid={testId}
      onClick={onClick}
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
  const { dark, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeMobile = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen w-full flex bg-[#F8F9FA] dark:bg-zinc-950 font-sans-ui text-zinc-900 dark:text-zinc-100 transition-colors">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4 h-14">
        <button data-testid="mobile-menu-toggle" onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md">
          <Menu size={18} />
        </button>
        <div className="font-serif-display text-lg truncate">{restaurant?.name || "—"}</div>
        <LanguageToggle />
      </div>

      {sidebarOpen && (
        <div data-testid="sidebar-backdrop" className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={closeMobile} />
      )}

      <aside
        data-testid="sidebar"
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
                    fixed lg:relative inset-y-0 left-0 z-50 lg:z-0
                    w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col
                    transition-transform duration-200 ease-out`}
      >
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between">
          <div className="min-w-0">
            <div className="label-eyebrow">{t("app.name")}</div>
            <div className="font-serif-display text-2xl mt-1 truncate" title={restaurant?.name}>
              {restaurant?.name || "—"}
            </div>
          </div>
          <button data-testid="sidebar-close" onClick={closeMobile} className="lg:hidden p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md">
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavItem to="/" testId="nav-home" icon={HomeIcon} label="Home" onClick={closeMobile} />
          <div className="label-eyebrow px-3 py-2 mt-3">{t("nav.bookings")}</div>
          <NavItem to="/bookings/list" testId="nav-list" icon={List} label={t("nav.list")} onClick={closeMobile} />
          <NavItem to="/bookings/calendar" testId="nav-calendar" icon={CalendarDays} label={t("nav.calendar")} onClick={closeMobile} />
          <NavItem to="/bookings/timeline" testId="nav-timeline" icon={LayoutGrid} label={t("nav.timeline")} onClick={closeMobile} />
          <NavItem to="/waitlist" testId="nav-waitlist" icon={ClipboardList} label="Lista d'attesa" onClick={closeMobile} />
          <div className="label-eyebrow px-3 py-2 mt-4">Config</div>
          <NavItem to="/tables" testId="nav-tables" icon={Table2} label={t("nav.tables")} onClick={closeMobile} />
          <NavItem to="/floorplan" testId="nav-floorplan" icon={Grid3x3} label="Planimetria" onClick={closeMobile} />
          <NavItem to="/hours" testId="nav-hours" icon={Clock} label={t("nav.hours")} onClick={closeMobile} />
          <NavItem to="/customers" testId="nav-customers" icon={Users} label={t("nav.customers")} onClick={closeMobile} />
          <NavItem to="/reports" testId="nav-reports" icon={BarChart3} label={t("nav.reports")} onClick={closeMobile} />
          {user?.role === "owner" && (
            <NavItem to="/settings" testId="nav-settings" icon={SettingsIcon} label="Impostazioni" onClick={closeMobile} />
          )}
        </nav>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
          <a
            data-testid="link-public-booking"
            href={`/book/${restaurant?.subdomain || "demo"}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ExternalLink size={16} />
            {t("nav.public")}
          </a>
          <div className="flex items-center justify-between px-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate" title={user?.email}>{user?.email}</div>
            <LanguageToggle />
          </div>
          <button
            data-testid="theme-toggle"
            onClick={toggle}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? "Tema chiaro" : "Tema scuro"}
          </button>
          <button
            data-testid="btn-logout"
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 dark:hover:text-red-400 rounded-md transition-colors"
          >
            <LogOut size={16} /> {t("nav.logout")}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
