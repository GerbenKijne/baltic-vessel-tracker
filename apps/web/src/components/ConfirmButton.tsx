import { useEffect, useRef, useState } from "react";

interface Props {
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

const AUTO_CANCEL_MS = 4000;

// Replaces the browser's native confirm() for every destructive action in
// the app: swaps itself for a Confirm/Cancel pair on first click instead
// of a jarring unstyled OS dialog, and reverts on its own after a few
// seconds so an abandoned click doesn't leave a stray "Confirm" button
// armed indefinitely. Defaulting to "btn sm danger" also means every
// caller gets the same destructive styling for free.
export function ConfirmButton({
  onConfirm,
  disabled,
  className = "btn sm danger",
  title,
  children,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!confirming) return;
    timeoutRef.current = window.setTimeout(() => setConfirming(false), AUTO_CANCEL_MS);
    return () => window.clearTimeout(timeoutRef.current);
  }, [confirming]);

  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 5 }}>
        <button
          type="button"
          className={className}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          Confirm
        </button>
        <button type="button" className="btn sm" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={disabled}
      onClick={() => setConfirming(true)}
    >
      {children}
    </button>
  );
}
