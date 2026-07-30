import React, { createContext, useContext, useEffect, useState } from "react";
import api from "./api";

const AuthContext = createContext({ user: null, restaurant: null, login: async () => {}, logout: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("21r_user") || "null"); } catch { return null; }
  });
  const [restaurant, setRestaurant] = useState(() => {
    try { return JSON.parse(localStorage.getItem("21r_restaurant") || "null"); } catch { return null; }
  });

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("21r_token", data.access_token);
    localStorage.setItem("21r_user", JSON.stringify(data.user));
    localStorage.setItem("21r_restaurant", JSON.stringify(data.restaurant));
    setUser(data.user);
    setRestaurant(data.restaurant);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("21r_token");
    localStorage.removeItem("21r_user");
    localStorage.removeItem("21r_restaurant");
    setUser(null);
    setRestaurant(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, restaurant, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
