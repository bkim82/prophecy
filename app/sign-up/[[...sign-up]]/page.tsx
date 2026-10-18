import { SignUp } from "@clerk/nextjs";
import { EmbeddedSignInPage } from "@/app/auth/EmbeddedSignInPage";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";

export default function Page() {
  // CDP has no separate sign-up step: the sign-in modal creates the account.
  return (
    <main className="flex min-h-screen items-center justify-center">
      {embeddedWalletAuthEnabled() ? <EmbeddedSignInPage /> : <SignUp />}
    </main>
  );
}
