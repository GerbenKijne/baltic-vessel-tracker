import { TopBar } from "../components/TopBar";

export function AdminPage() {
  return (
    <>
      <TopBar title="Admin" />
      <div className="body">
        <div className="coming-soon">
          <p className="eyebrow">Not built yet</p>
          <p>
            Source configuration, retention/backup controls, and account settings aren't built
            yet — see docs/data-source-register.md and docs/runbooks for what's configured via
            .env and the deploy runbook today instead.
          </p>
        </div>
      </div>
    </>
  );
}
