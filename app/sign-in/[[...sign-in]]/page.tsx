import { SignIn } from "@clerk/nextjs";
import { EmbeddedSignInPage } from "@/app/auth/EmbeddedSignInPage";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      {embeddedWalletAuthEnabled() ? <EmbeddedSignInPage /> : <SignIn />}
    </main>
  );
}
