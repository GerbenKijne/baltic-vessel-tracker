import type { ReactNode } from "react";

import { useAuth } from "../AuthContext";

interface Props {
  title: string;
  crumb?: string;
  /** Right-aligned content before the operator tag (status text, actions). */
  right?: ReactNode;
}

// Sign-out lives in the nav rail (see App.tsx), not here -- the design's
// topbar mockups only ever show the operator tag, and the nav rail is the
// one shell element present on every screen, including the full-bleed Map.
export function TopBar({ title, crumb, right }: Props) {
  const { email } = useAuth();
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {crumb && (
        <span className="crumb mono" style={{ fontSize: 11 }}>
          {crumb}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {right}
      <span className="tag">{email}</span>
    </div>
  );
}
