import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient.js";

/**
 * Read error parameters from both the query string (PKCE flow) and the URL
 * hash (implicit flow). Supabase appends these when a reset link is invalid
 * or has expired, e.g. ?error=access_denied&error_code=otp_expired.
 */
function getURLError() {
  const qp = new URLSearchParams(window.location.search);
  const hp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = qp.get("error_code") ?? hp.get("error_code");
  const err  = qp.get("error")      ?? hp.get("error");
  if (code === "otp_expired" || err === "access_denied") {
    return "This reset link is invalid or has expired. Please request a new password reset email.";
  }
  return null;
}

/**
 * Detect a Supabase recovery token in the current URL.
 *
 * Called inside a useState lazy initializer so it runs synchronously on the
 * first render, before Supabase's detectSessionInUrl can remove the ?code
 * query param via history.replaceState.
 *
 * PKCE flow:    ?code=<pkce_code>
 * Implicit flow: #access_token=<token>&...&type=recovery
 */
function hasRecoveryTokenInURL() {
  if (new URLSearchParams(window.location.search).has("code")) return true;
  const hash = window.location.hash;
  return hash.includes("type=recovery") ||
    (hash.includes("access_token") && hash.includes("refresh_token"));
}

/**
 * Compute the initial page status synchronously from the URL.
 * Calling this in a useState lazy initializer captures the URL before any
 * async Supabase processing can modify it.
 *
 * "error"      — URL contains Supabase error params (expired / invalid link)
 * "no-session" — URL has no recovery token at all (direct visit / already logged in)
 * "loading"    — recovery token present, waiting for PASSWORD_RECOVERY event
 */
function computeInitialStatus() {
  if (getURLError()) return "error";
  if (!hasRecoveryTokenInURL()) return "no-session";
  return "loading";
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();

  // Derive initial status and error from URL synchronously — must use lazy
  // initializer so both run before Supabase processes (and potentially cleans) the URL.
  const [status, setStatus] = useState(computeInitialStatus);
  const [pageError, setPageError] = useState(() => getURLError() ?? "");
  const [recoveryEmail, setRecoveryEmail] = useState(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Only set up a listener when we detected a recovery token in the URL.
    // For "error" and "no-session" the status is already final.
    if (status !== "loading") return;

    let resolved = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (resolved) return;
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setRecoveryEmail(session?.user?.email ?? null);
        setStatus("ready");
      }
    });

    // Timeout fallback: if PASSWORD_RECOVERY has not fired within 5 s the
    // recovery token was likely already used or the PKCE exchange failed.
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setPageError(
          "This reset link is invalid or has expired. Please request a new password reset email."
        );
        setStatus("error");
      }
    }, 5000);

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
    // status is URL-derived and stable while "loading"; no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Sign out the recovery session so the user must log in fresh.
      await supabase.auth.signOut();
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setFormError(err.message ?? "Failed to update password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Expired / invalid link ──────────────────────────────────────────────────
  if (status === "error") {
    return (
      <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Link expired</h2>
          <p style={{ color: "#b91c1c", fontSize: "0.9rem", marginTop: 0 }}>{pageError}</p>
          <p style={{ fontSize: "0.85rem", marginTop: "1rem", marginBottom: 0 }}>
            <Link to="/forgot-password">Request a new reset link</Link>
          </p>
        </div>
      </main>
    );
  }

  // ── Direct visit with no recovery token ────────────────────────────────────
  if (status === "no-session") {
    return (
      <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No reset session</h2>
          <p style={{ color: "#b91c1c", fontSize: "0.9rem", marginTop: 0 }}>
            No valid password reset session. Please request a new password reset email.
          </p>
          <p style={{ fontSize: "0.85rem", marginTop: "1rem", marginBottom: 0 }}>
            <Link to="/forgot-password">Request a password reset</Link>
          </p>
        </div>
      </main>
    );
  }

  // ── Waiting for Supabase to process the recovery token ─────────────────────
  if (status === "loading") {
    return (
      <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
        <div className="card">
          <p style={{ color: "var(--muted)", margin: 0 }}>Verifying reset link…</p>
        </div>
      </main>
    );
  }

  // ── Valid recovery session — show the form ──────────────────────────────────
  return (
    <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Set new password</h2>
        {recoveryEmail ? (
          <p className="meta" style={{ marginTop: 0 }}>
            Resetting password for <strong>{recoveryEmail}</strong>
          </p>
        ) : null}
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={{ width: "100%" }}
            />
          </div>
          {formError ? (
            <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
              {formError}
            </p>
          ) : null}
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Saving…" : "Set new password"}
          </button>
        </form>
      </div>
    </main>
  );
}
