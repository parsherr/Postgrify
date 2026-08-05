/**
 * Auth hook'ları — geriye dönük uyumluluk için.
 *
 * useAdminLogin ve useLogout artık AuthContext'e delege eder.
 * useDbToken değişmedi (programatik API erişimi için hâlâ gerekli).
 */

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "./useAuthContext.js";
import { api } from "../lib/api.js";
import type { TokenResponse } from "../types/index.js";

export function useAdminLogin() {
  const { login } = useAuthContext();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      await login(email, password);
    },
    onSuccess: () => {
      navigate("/");
    },
  });
}

export function useDbToken() {
  return useMutation({
    mutationFn: ({
      database,
      secret,
      scope,
      expiresIn,
    }: {
      database: string;
      secret: string;
      scope?: string[];
      expiresIn?: string;
    }) =>
      api.post<TokenResponse>("/auth/token", {
        database,
        secret,
        ...(scope ? { scope } : {}),
        ...(expiresIn ? { expiresIn } : {}),
      }),
  });
}

export function useLogout() {
  const { logout } = useAuthContext();
  const navigate = useNavigate();
  return async () => {
    await logout();
    navigate("/login");
  };
}

export function useIsAuthenticated() {
  const { isAuthenticated } = useAuthContext();
  return isAuthenticated;
}