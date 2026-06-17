import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  // true until the initial session check completes — prevents a flash of the login screen
  const [loading, setLoading] = useState(true);
  // Set when a valid Supabase session exists but the email is not in allowed_users
  const [accessError, setAccessError] = useState(null);
  // True when the active Supabase session is a PASSWORD_RECOVERY session.
  // Recovery sessions must NOT grant access to the main app.
  const [isRecovery, setIsRecovery] = useState(false);

  /**
   * Given a Supabase user object (or null on logout), check the allowed_users
   * allowlist and update all auth state accordingly. If the user is not allowed,
   * signs them out immediately and sets an access error message.
   */
  const applySession = useCallback(async (supabaseUser) => {
    if (!supabaseUser) {
      setUser(null);
      setRole(null);
      setAccessError(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("allowed_users")
        .select("role")
        .eq("email", supabaseUser.email)
        .single();

      if (error || !data) {
        // Email not in allowlist — sign out and show an access-denied message
        await supabase.auth.signOut();
        setUser(null);
        setRole(null);
        setAccessError("You do not have access to this app.");
        return;
      }
      setUser(supabaseUser);
      setRole(data.role);
      setAccessError(null);
    } catch {
      await supabase.auth.signOut();
      setUser(null);
      setRole(null);
      setAccessError("You do not have access to this app.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    // Restore existing session on page load
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      await applySession(session?.user ?? null);
      if (active) setLoading(false);
    });

    // React to subsequent auth events (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") {
        // Recovery sessions must not grant app access.
        // ResetPasswordPage uses supabase.auth.updateUser() directly with this session.
        setIsRecovery(true);
        return;
      }
      setIsRecovery(false);
      await applySession(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  /**
   * Sign in with email + password. Throws a Supabase AuthError on failure
   * (wrong credentials, unconfirmed email, etc.). The allowlist check runs
   * automatically via onAuthStateChange after a successful sign-in.
   */
  const signIn = useCallback(async (email, password) => {
    setAccessError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  /**
   * Sign out the current user. onAuthStateChange will clear user/role state.
   */
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ user, role, loading, accessError, isRecovery, signIn, signOut }),
    [user, role, loading, accessError, isRecovery, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
