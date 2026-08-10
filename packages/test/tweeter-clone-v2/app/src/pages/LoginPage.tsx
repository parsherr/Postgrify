/**
 * LoginPage — email + şifre ile giriş
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Feather } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Feather className="w-10 h-10 text-sky-400" />
        </div>

        <h1 className="text-3xl font-bold text-white text-center mb-8">Tweeter'a Giriş Yap</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-posta adresi"
              required
              className="input"
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre"
              required
              className="input"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center bg-red-950/40 rounded-lg p-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-gray-500">
            Hesabın yok mu?{" "}
            <Link to="/register" className="text-sky-400 hover:underline font-medium">
              Kayıt Ol
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}