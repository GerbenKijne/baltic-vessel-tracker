import { TopBar } from "../components/TopBar";

export function HistoryPage() {
  return (
    <>
      <TopBar title="History" />
      <div className="body">
        <div className="coming-soon">
          <p className="eyebrow">Not built yet</p>
          <p>
            A dedicated history query screen (gap table, static track review) isn't built yet — for
            now, track review lives on the Map screen's vessel drawer ("Show 24h track").
          </p>
        </div>
      </div>
    </>
  );
}
