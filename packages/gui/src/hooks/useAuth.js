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
export function useAdminLogin() {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async ({ email, password }) => {
            await login(email, password);
        },
        onSuccess: () => {
            navigate("/");
        },
    });
}
export function useDbToken() {
    return useMutation({
        mutationFn: ({ database, secret, scope, expiresIn, }) => api.post("/auth/token", {
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
