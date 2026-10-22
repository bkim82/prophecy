import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Outside sign.ts, CDP browser packages are allowlisted to read-only/auth
// names: a denylist misses new signing, spend-permission, delegation, and
// borrow APIs as the SDK grows. Add a name here only after checking it can't
// sign or grant control of funds.
const CDP_BOUNDARY = "Only read-only/auth CDP imports are allowed outside app/lib/embeddedWallet/sign.ts; submit typed intents through it, or allowlist a reviewed name in eslint.config.mjs.";

const signingRestrictions = {
  paths: [
    {
      name: "@coinbase/cdp-hooks",
      allowImportNames: ["useCurrentUser", "useGetAccessToken", "useIsInitialized", "useIsSignedIn", "useSignOut"],
      message: CDP_BOUNDARY,
    },
    { name: "@coinbase/cdp-core", message: CDP_BOUNDARY },
    {
      name: "@coinbase/cdp-react",
      allowImportNames: ["CDPReactProvider", "SignInModal", "SignInModalContent", "EnrollMfaModal", "LinkAuthModal"],
      message: CDP_BOUNDARY,
    },
  ],
  patterns: [
    { group: ["@coinbase/cdp-hooks/*", "@coinbase/cdp-core/*", "@coinbase/cdp-react/*"], message: CDP_BOUNDARY },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The existing React 19 UI predates this lint baseline. Keep these
    // compiler-oriented findings visible without blocking the wallet work;
    // new security/import-boundary rules remain errors.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...signingRestrictions.paths,
            {
              name: "@clerk/nextjs/server",
              message: "Read server identity through lib/viewer.ts.",
            },
          ],
          patterns: signingRestrictions.patterns,
        },
      ],
    },
  },
  {
    files: ["app/lib/embeddedWallet/sign.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["lib/viewer.ts"],
    rules: {
      "no-restricted-imports": ["error", signingRestrictions],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
