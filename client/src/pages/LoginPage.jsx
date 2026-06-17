import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

export default function LoginPage() {
  const { signIn, accessError } = useAuth();
  const location = useLocation();
  const justReset = location.state?.passwordReset === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      // On success: App.jsx re-renders with user set, which navigates away from /login
    } catch (err) {
      setFormError(err.message ?? "Incorrect email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  // accessError is set by AuthContext when email is not in allowed_users
  const displayError = accessError || formError;

  return (
    <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Log in</h2>
        {justReset ? (
          <p style={{ color: "#16a34a", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
            Password updated. Please log in with your new password.
          </p>
        ) : null}
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
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ width: "100%" }}
            />
          </div>
          {displayError ? (
            <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
              {displayError}
            </p>
          ) : null}
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "1rem", marginBottom: 0 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </main>
  );
}
