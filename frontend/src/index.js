import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import "./index.css";
import "./App.css";

import { I18nProvider } from "./i18n";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider } from "./theme";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import BookingsList from "./pages/BookingsList";
import BookingsCalendar from "./pages/BookingsCalendar";
import BookingsTimeline from "./pages/BookingsTimeline";
import Tables from "./pages/Tables";
import FloorPlan from "./pages/FloorPlan";
import OpeningHours from "./pages/OpeningHours";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Waitlist from "./pages/Waitlist";
import PublicBooking from "./pages/PublicBooking";
import PublicCancel from "./pages/PublicCancel";
import PaymentResult from "./pages/PaymentResult";
import { AdminLayout, AdminClients, AdminClientNew, AdminClientDetail, RequireAgencyAdmin } from "./pages/AdminPortal";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Agency admin should live only under /admin; if they land on staff routes, kick them there.
  if (user.role === "agency_admin") return <Navigate to="/admin" replace />;
  return children;
}

function RequireAgencyAdminRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <RequireAgencyAdmin>{children}</RequireAgencyAdmin>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/book/:subdomain" element={<PublicBooking />} />
      <Route path="/cancel/:token" element={<PublicCancel />} />
      <Route path="/payment/success" element={<PaymentResult mode="success" />} />
      <Route path="/payment/cancel" element={<PaymentResult mode="cancel" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={
        <RequireAgencyAdminRoute><AdminLayout /></RequireAgencyAdminRoute>
      }>
        <Route index element={<AdminClients />} />
        <Route path="new" element={<AdminClientNew />} />
        <Route path=":id" element={<AdminClientDetail />} />
      </Route>
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="bookings/list" element={<BookingsList />} />
        <Route path="bookings/calendar" element={<BookingsCalendar />} />
        <Route path="bookings/timeline" element={<BookingsTimeline />} />
        <Route path="waitlist" element={<Waitlist />} />
        <Route path="tables" element={<Tables />} />
        <Route path="floorplan" element={<FloorPlan />} />
        <Route path="hours" element={<OpeningHours />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppRoutes />
              <Toaster position="top-right" richColors />
            </BrowserRouter>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
