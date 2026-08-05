/**
 * Auth hook'ları — login, logout, token yönetimi.
 */
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
const TOKEN_KEY = "postgrify_token";
export function useAdminLogin() {
    const navigate = useNavigate();
    return useMutation({
        mutationFn: (adminSecret) => api.post("/auth/token/admin", { adminSecret }),
        onSuccess: (data) => {
            localStorage.setItem(TOKEN_KEY, data.token);
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
    const navigate = useNavigate();
    return () => {
        localStorage.removeItem(TOKEN_KEY);
        navigate("/login");
    };
}
export function useIsAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
}
