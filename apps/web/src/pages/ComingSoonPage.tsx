export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="coming-soon">
      <h1>{title}</h1>
      <p>Not built yet — see the PRD's phased plan in docs/adr/0001-architecture-baseline.md.</p>
    </div>
  );
}
