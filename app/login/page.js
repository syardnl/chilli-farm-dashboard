"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const COLORS = {
  bg: "#1C1410",
  bgRaised: "#251C16",
  hairline: "#3A2E24",
  chilli: "#C1121F",
  cream: "#F2E9DC",
  muted: "#948573",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div
      style={{ background: COLORS.bg, color: COLORS.cream }}
      className="min-h-screen flex items-center justify-center px-4"
    >
      <form
        onSubmit={handleLogin}
        style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
        className="w-full max-w-sm rounded-xl border p-6 space-y-4"
      >
        <div>
          <p
            className="text-xs tracking-[0.2em] uppercase font-mono"
            style={{ color: COLORS.muted }}
          >
            Chilli Farm IoT
          </p>
          <h1 className="text-xl font-semibold mt-1">Sign in</h1>
        </div>

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              background: COLORS.bg,
              borderColor: COLORS.hairline,
              color: COLORS.cream,
            }}
            className="w-full rounded-lg border px-3 py-2 outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              background: COLORS.bg,
              borderColor: COLORS.hairline,
              color: COLORS.cream,
            }}
            className="w-full rounded-lg border px-3 py-2 outline-none"
          />
        </div>

        {error && (
          <p style={{ color: COLORS.chilli }} className="text-sm font-mono">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{ background: COLORS.chilli }}
          className="w-full rounded-lg px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
