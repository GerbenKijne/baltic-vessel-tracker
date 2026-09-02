import { TopBar } from "../components/TopBar";

export function AlertsPage() {
  return (
    <>
      <TopBar title="Alerts" />
      <div className="body">
        <div className="coming-soon">
          <p className="eyebrow">Not built yet</p>
          <p>
            The event inbox and geofence rule builder are Phase 4 scope — see the design handoff
            and docs/adr for what's designed but not yet backed by real alert rules or geofences.
          </p>
        </div>
      </div>
    </>
  );
}
