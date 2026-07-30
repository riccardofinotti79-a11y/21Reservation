import React from "react";
import { useI18n } from "./i18n";

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  accepted: "bg-emerald-50 text-emerald-800 border-emerald-200",
  seated: "bg-blue-50 text-blue-800 border-blue-200",
  declined: "bg-red-50 text-red-800 border-red-200",
  no_show: "bg-slate-100 text-slate-700 border-slate-300",
  cancelled: "bg-rose-50 text-rose-800 border-rose-200",
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
