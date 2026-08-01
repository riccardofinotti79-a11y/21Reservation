import React from "react";
import { useI18n } from "./i18n";

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60",
  accepted: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60",
  seated: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800/60",
  declined: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800/60",
  no_show: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700",
  cancelled: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60",
};

export default function StatusBadge({ status }) {
  const { t } = useI18n();
  const cls = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span data-testid={`status-badge-${status}`} className={`status-pill ${cls}`}>
      {t(`status.${status}`)}
    </span>
  );
}

export const STATUS_HEX = {
  pending: "#F59E0B",
  accepted: "#059669",
  seated: "#2563EB",
  declined: "#DC2626",
  no_show: "#64748B",
  cancelled: "#E11D48",
};
