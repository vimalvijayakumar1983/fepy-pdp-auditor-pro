"use client";
import { useState } from "react";
import { ArrowRight, ShieldCheck, Layers3 } from "lucide-react";
export default function Login({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      window.location.assign("/workspace");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-story">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          FEPY<span className="brand-sub">PRODUCT INTELLIGENCE</span>
        </div>
        <div>
          <p className="eyebrow">BETTER PRODUCTS. BETTER DECISIONS.</p>
          <h1>
            Every product page.
            <br />A better experience.
          </h1>
          <p>
            From the first audit to the next improvement. One workspace for your
            catalog, evidence and content decisions.
          </p>
        </div>
        <p className="login-foot">Built for the team behind the storefront.</p>
      </div>
      <section className="login-form">
        <ShieldCheck size={32} className="text-emerald-700" />
        <h2>Welcome to your workspace</h2>
        <p>Sign in to manage product quality across your catalog.</p>
        {configured ? (
          <form onSubmit={submit}>
            <label htmlFor="password">Workspace password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Enter workspace"}
              <ArrowRight size={17} />
            </button>
          </form>
        ) : (
          <div className="notice">
            Private workspace access needs setup. The administrator must
            configure the app password and session secret before the workspace
            can open.
          </div>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <p className="muted small">
          Shared team access · evidence and drafts stay private.
        </p>
      </section>
    </main>
  );
}
