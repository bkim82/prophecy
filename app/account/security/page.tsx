import { AccountSecurity } from "./AccountSecurity";

export default function AccountSecurityPage() {
  return (
    <main className="profile-page">
      <section className="panel wallet-card">
        <span className="eyebrow">Account</span>
        <h1 className="display-font">Security</h1>
        <AccountSecurity />
      </section>
    </main>
  );
}
