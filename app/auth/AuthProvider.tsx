"use client";

import {
  ClerkProvider,
  useClerk,
  useUser,
} from "@clerk/nextjs";
import {
  useCurrentUser,
  useGetAccessToken,
  useIsInitialized,
  useIsSignedIn,
  useSignOut,
} from "@coinbase/cdp-hooks";
import { CDPReactProvider, SignInModal, SignInModalContent } from "@coinbase/cdp-react";
import { useRouter } from "next/navigation";
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { needsOnboarding } from "@/app/welcome/actions";
import {
  applicationSessionMatches,
  createApplicationSession,
  deleteApplicationSession,
  type ApplicationSession,
} from "@/app/lib/authSession";
import { WALLET_SIGNED_OUT_EVENT } from "@/app/lib/embeddedWallet/client";

export type AuthConfiguration =
  | { provider: "clerk" }
  | { provider: "cdp"; projectId: string };

type AppAuthUser = {
  userId: string;
  firstName: string | null;
  username: string | null;
  imageUrl: string | null;
  smartAccountAddress: string | null;
  walletChainId: number | null;
};

type AppAuthContext = {
  provider: AuthConfiguration["provider"];
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AppAuthUser | null;
  error: string | null;
  openSignIn: () => void;
  signOut: () => Promise<void>;
  openAccountSettings: (() => void) | null;
  setProfileImage: ((file: File | null) => Promise<void>) | null;
};

const AuthContext = createContext<AppAuthContext | null>(null);

export function AuthProvider({
  config,
  children,
}: {
  config: AuthConfiguration;
  children: ReactNode;
}) {
  if (config.provider === "cdp") {
    return (
      <CDPReactProvider
        config={{
          projectId: config.projectId,
          appName: "Prophecy",
          authMethods: ["email", "oauth:google", "oauth:apple"],
          ethereum: { createOnLogin: "smart" },
        }}
      >
        <CdpAuthBridge>{children}</CdpAuthBridge>
      </CDPReactProvider>
    );
  }

  return (
    // Every new account goes through /welcome (profile + a short survey) first.
    <ClerkProvider signUpForceRedirectUrl="/welcome">
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const value = useMemo<AppAuthContext>(() => ({
    provider: "clerk",
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    user: user
      ? {
          userId: user.id,
          firstName: user.firstName,
          username: user.username,
          imageUrl: user.hasImage ? user.imageUrl : null,
          smartAccountAddress: null,
          walletChainId: null,
        }
      : null,
    error: null,
    openSignIn: () => clerk.openSignIn(),
    signOut: async () => {
      await clerk.signOut();
    },
    openAccountSettings: () => clerk.openUserProfile(),
    setProfileImage: user
      ? async (file) => {
          await user.setProfileImage({ file });
        }
      : null,
  }), [clerk, isLoaded, isSignedIn, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type SessionSync = {
  userId: string;
  promise: Promise<ApplicationSession>;
};

type SessionResult = {
  userId: string;
  status: "ready" | "error";
  error: string | null;
  session: ApplicationSession | null;
};

function CdpAuthBridge({ children }: { children: ReactNode }) {
  const { currentUser } = useCurrentUser();
  const { getAccessToken } = useGetAccessToken();
  const { isInitialized } = useIsInitialized();
  const { isSignedIn: providerSignedIn } = useIsSignedIn();
  const { signOut: cdpSignOut } = useSignOut();
  const [signInOpen, setSignInOpen] = useState(false);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const syncRef = useRef<SessionSync | null>(null);
  const clearedSignedOutRef = useRef(false);
  // Set by the sign-in modal so only a fresh sign-in, not a restored session,
  // can send a not-yet-onboarded user to /welcome.
  const justSignedInRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!isInitialized) return;

    if (!providerSignedIn || !currentUser) {
      syncRef.current = null;
      // A later sign-in by the same provider user must perform a fresh
      // access-token exchange instead of reusing this ready result.
      queueMicrotask(() => setSessionResult(null));
      if (!clearedSignedOutRef.current) {
        clearedSignedOutRef.current = true;
        void deleteApplicationSession().catch(() => undefined);
      }
      return;
    }

    clearedSignedOutRef.current = false;

    if (!syncRef.current || syncRef.current.userId !== currentUser.userId) {
      const promise = (async () => {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("The authentication token is unavailable.");
        return createApplicationSession(accessToken);
      })();
      syncRef.current = { userId: currentUser.userId, promise };
    }

    let active = true;
    void syncRef.current.promise.then(async (session) => {
      if (!active) return;
      const smartAccounts = (currentUser.evmSmartAccountObjects ?? []).map(({ address }) => address);
      if (!applicationSessionMatches(session, currentUser.userId, smartAccounts)) {
        throw new Error("The wallet session did not match the signed-in account.");
      }
      setSessionResult({
        userId: currentUser.userId,
        status: "ready",
        error: null,
        session,
      });
    }).catch(async (cause: unknown) => {
      if (!active) return;
      setSessionResult({
        userId: currentUser.userId,
        status: "error",
        error: cause instanceof Error ? cause.message : "Could not finish signing in.",
        session: null,
      });
      await Promise.allSettled([deleteApplicationSession(), cdpSignOut()]);
    });

    return () => {
      active = false;
    };
  }, [cdpSignOut, currentUser, getAccessToken, isInitialized, providerSignedIn]);

  const signOut = useCallback(async () => {
    setSessionResult(null);
    syncRef.current = null;
    const results = await Promise.allSettled([deleteApplicationSession(), cdpSignOut()]);
    const providerResult = results[1];
    if (providerResult.status === "rejected") throw providerResult.reason;
  }, [cdpSignOut]);

  // The server session can end while this page still looks signed in (a
  // sign-in elsewhere revokes it, or it expires). Silently re-exchanging the
  // CDP token would undo "sign out everywhere", so sign out and let the user
  // sign in again.
  useEffect(() => {
    const onSignedOut = () => { void signOut().catch(() => undefined); };
    window.addEventListener(WALLET_SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(WALLET_SIGNED_OUT_EVENT, onSignedOut);
  }, [signOut]);

  const email = currentUser?.authenticationMethods.email?.email
    ?? currentUser?.authenticationMethods.google?.email
    ?? currentUser?.authenticationMethods.apple?.email
    ?? null;
  const currentSession = sessionResult?.userId === currentUser?.userId ? sessionResult : null;
  const sessionReady = currentSession?.status === "ready";

  useEffect(() => {
    if (!sessionReady || !justSignedInRef.current) return;
    justSignedInRef.current = false;
    void needsOnboarding()
      .then((needed) => { if (needed) router.push("/welcome"); })
      .catch(() => undefined);
  }, [router, sessionReady]);
  const value = useMemo<AppAuthContext>(() => ({
    provider: "cdp",
    isLoaded: isInitialized && (!providerSignedIn || currentSession !== null),
    isSignedIn: providerSignedIn && sessionReady,
    user: currentUser && sessionReady
      ? {
          userId: currentUser.userId,
          firstName: email?.split("@")[0] ?? null,
          username: email?.split("@")[0] ?? null,
          imageUrl: null,
          smartAccountAddress: currentSession?.session?.user.smartAccountAddress ?? null,
          walletChainId: currentSession?.session?.user.chainId ?? null,
        }
      : null,
    error: currentSession?.error ?? null,
    openSignIn: () => setSignInOpen(true),
    signOut,
    // This control stays hidden until linked-auth management is implemented.
    openAccountSettings: null,
    setProfileImage: null,
  }), [currentSession, currentUser, email, isInitialized, providerSignedIn, sessionReady, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignInModal
        open={signInOpen}
        setIsOpen={setSignInOpen}
        onSuccess={() => {
          justSignedInRef.current = true;
          setSignInOpen(false);
        }}
      >
        {/* Content only: without children the SDK also renders its own trigger
            button, duplicating the header's SignInAction. */}
        <SignInModalContent />
      </SignInModal>
    </AuthContext.Provider>
  );
}

export function useAppAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAppAuth must be used within AuthProvider");
  return value;
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAppAuth();
  return isSignedIn ? children : null;
}

export function SignInAction({
  children,
}: {
  children: ReactElement<{ onClick?: (event: React.MouseEvent) => void }>;
}) {
  const { openSignIn } = useAppAuth();
  return cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) openSignIn();
    },
  });
}
