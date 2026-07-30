import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import "./index.css";
import "./App.css";

import { I18nProvider } from "./i18n";
import { AuthProvider, useAuth } from "./auth";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BookingsList from "./pages/BookingsList";
import BookingsCalendar from "./pages/BookingsCalendar";
import BookingsTimeline from "./pages/BookingsTimeline";
import Tables from "./pages/Tables";
import OpeningHours from "./pages/OpeningHours";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Reports from "./pages/Reports";
import PublicBooking from "./pages/PublicBooking";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/book/:subdomain" element={<PublicBooking />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/bookings/list" replace />} />
        <Route path="bookings/list" element={<BookingsList />} />
        <Route path="bookings/calendar" element={<BookingsCalendar />} />
        <Route path="bookings/timeline" element={<BookingsTimeline />} />
        <Route path="tables" element={<Tables />} />
        <Route path="hours" element={<OpeningHours />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
