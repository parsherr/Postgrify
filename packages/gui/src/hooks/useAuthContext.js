/**
 * useAuthContext — AuthContext için tüketici hook.
 * Provider dışında çağrılırsa hata fırlatır.
 */
import { useContext } from "react";
import { AuthContext } from "../contexts/AuthContext.js";
export function useAuthContext() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuthContext must be used within <AuthProvider>");
    }
    return ctx;
}
