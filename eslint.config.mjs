import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const signingImports = [
  {
    name: "@coinbase/cdp-hooks",
    importNames: [
      "useSendEvmTransaction",
      "useSignEvmHash",
      "useSignEvmMessage",
      "useSignEvmTypedData",
    ],
    message: "Submit typed intents through app/lib/embeddedWallet/sign.ts.",
  },
  {
    name: "@coinbase/cdp-core",
    importNames: [
      "sendEvmTransaction",
      "signEvmHash",
      "signEvmMessage",
      "signEvmTypedData",
    ],
    message: "Submit typed intents through app/lib/embeddedWallet/sign.ts.",
  },
  {
    name: "@coinbase/cdp-react",
    importNames: ["SendEvmTransactionButton"],
    message: "Submit typed intents through app/lib/embeddedWallet/sign.ts.",
  },
  {
    name: "@coinbase/cdp-react/components/SendEvmTransactionButton",
    message: "Submit typed intents through app/lib/embeddedWallet/sign.ts.",
  },
];

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
            ...signingImports,
            {
              name: "@clerk/nextjs/server",
              message: "Read server identity through lib/viewer.ts.",
            },
          ],
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
      "no-restricted-imports": ["error", { paths: signingImports }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
