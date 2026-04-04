import { createContext, useCallback, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "clinic_rota_manager_v1_logged_in";
const MANAGER_USER = "admin";
const MANAGER_PASS = "clinic123";

/** Matches `/temp-date-availability/:staffId` (same rule as temp isolation redirect). */
export function isTempDateAvailabilityPath(pathname) {
  return /\/temp-date-availability\/\d+\/?$/.test(pathname);
}

const ManagerAuthContext = createContext(null);

export function ManagerAuthProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const tryLogin = useCallback((username, password) => {
    if (String(username) === MANAGER_USER && String(password) === MANAGER_PASS) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* private mode */
      }
      setLoggedIn(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setLoggedIn(false);
  }, []);

  const value = useMemo(
    () => ({ loggedIn, tryLogin, logout }),
    [loggedIn, tryLogin, logout]
  );

  return <ManagerAuthContext.Provider value={value}>{children}</ManagerAuthContext.Provider>;
}

export function useManagerAuth() {
  const ctx = useContext(ManagerAuthContext);
  if (!ctx) throw new Error("useManagerAuth must be used within ManagerAuthProvider");
  return ctx;
}

export function ManagerLoginScreen() {
  const { tryLogin } = useManagerAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!tryLogin(username, password)) {
      setError("Incorrect username or password.");
    }
  }

  return (
    <main className="main" style={{ maxWidth: "22rem", margin: "2rem auto" }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Manager login</h2>
        <p className="meta" style={{ fontSize: "0.85rem" }}>
          Internal testing only. Temp staff links do not require login.
        </p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
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
              style={{ width: "100%" }}
            />
          </div>
          {error ? (
            <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>{error}</p>
          ) : null}
          <button type="submit">Log in</button>
        </form>
      </div>
    </main>
  );
}
