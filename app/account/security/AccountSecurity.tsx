"use client";

import { useCurrentUser, useGetAccessToken } from "@coinbase/cdp-hooks";
import {
  EnrollMfaModal,
  LinkAuthModal,
} from "@coinbase/cdp-react";
import { useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import {
  createApplicationSession,
  deleteAllApplicationSessions,
} from "@/app/lib/authSession";

async function recordSecurityEvent(event: string) {
  await fetch("/api/account/security-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  });
}

function CdpSecurityControls() {
  const { currentUser } = useCurrentUser();
  const { getAccessToken } = useGetAccessToken();
  const { signOut } = useAppAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = currentUser?.authenticationMethods;
  const linked = [
    methods?.email ? "Email" : null,
    methods?.google ? "Google" : null,
    methods?.apple ? "Apple" : null,
  ].filter((value): value is string => Boolean(value));

  const rotateAfterSensitiveChange = async (event: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Could not refresh authentication.");
    await createApplicationSession(token);
    await recordSecurityEvent(event);
    setNotice("Security settings updated.");
  };

  const revokeAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await recordSecurityEvent("session.revoke_all_requested");
      await deleteAllApplicationSessions();
      await signOut();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not revoke sessions.");
      setBusy(false);
    }
  };

  return (
    <div className="wallet-sheet-form">
      <section>
        <h2>Sign-in and recovery</h2>
        <p className="wallet-card-copy">
          Linked methods: {linked.length ? linked.join(", ") : "none detected"}.
          Add at least two methods before relying on this wallet for recovery.
        </p>
        <LinkAuthModal onLinkSuccess={() => void rotateAfterSensitiveChange("auth.method_linked").catch((cause: unknown) => {
          setNotice(cause instanceof Error ? cause.message : "Could not finish linking.");
        })}>
          <button type="button" className="wallet-secondary-button">Link another method</button>
        </LinkAuthModal>
      </section>

      <section>
        <h2>Multi-factor authentication</h2>
        <p className="wallet-card-copy">Enroll a supported second factor for sensitive wallet actions.</p>
        <EnrollMfaModal
          resetOnSuccess
          onEnrollSuccess={() => void rotateAfterSensitiveChange("mfa.enrolled").catch((cause: unknown) => {
            setNotice(cause instanceof Error ? cause.message : "Could not finish MFA enrollment.");
          })}
        >
          <button type="button" className="wallet-secondary-button">Manage MFA</button>
        </EnrollMfaModal>
      </section>

      <section>
        <h2>Wallet export</h2>
        <p className="wallet-card-copy">
          Export is disabled until a credentialed test proves which owner key is exported and how it recovers control of the smart account.
        </p>
      </section>

      <section>
        <h2>Sessions</h2>
        <p className="wallet-card-copy">Sign out every Prophecy application session, including this device.</p>
        <button type="button" className="wallet-secondary-button" disabled={busy} onClick={() => void revokeAll()}>
          {busy ? "Revoking…" : "Sign out all sessions"}
        </button>
      </section>

      <section>
        <h2>Delete account</h2>
        <p className="wallet-card-copy">
          Account deletion is unavailable until Coinbase exposes a verified end-user deletion/revocation flow and wallet/export consequences pass review.
        </p>
      </section>
      {notice && <p className="wallet-notice" role="status">{notice}</p>}
    </div>
  );
}

export function AccountSecurity() {
  const { isLoaded, isSignedIn, provider } = useAppAuth();
  if (!isLoaded) return <p className="wallet-card-copy">Loading…</p>;
  if (!isSignedIn) return <p className="wallet-card-copy">Sign in to manage account security.</p>;
  if (provider !== "cdp") {
    return <p className="wallet-card-copy">Account security moves here when embedded-wallet authentication is enabled.</p>;
  }
  return <CdpSecurityControls />;
}
