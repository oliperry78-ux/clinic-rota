import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient.js";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // redirectTo must match a URL in Supabase Auth → URL Configuration → Redirect URLs
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (err) throw err;
      setSubmitted(true);
    } catch (err) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Check your email</h2>
          <p className="meta">
            If that address is registered, a password reset link has been sent. Check your inbox
            (and spam folder).
          </p>
          <p style={{ fontSize: "0.85rem", marginTop: "1rem", marginBottom: 0 }}>
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Forgot password</h2>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              style={{ width: "100%" }}
            />
          </div>
          {error ? (
            <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>{error}</p>
          ) : null}
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "1rem", marginBottom: 0 }}>
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </main>
  );
}
