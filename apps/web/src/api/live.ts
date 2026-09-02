import { useEffect, useRef, useState } from "react";

import type { Bbox } from "@contracts/canonical";

export interface LiveVessel {
  mmsi: string;
  name: string | null;
  lon: number;
  lat: number;
  sogKn: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  navStatus: string | null;
  observedAt: string | null;
  receivedAt: string;
  qualityFlags: string[];
  source: string | null;
}

interface LiveState {
  vessels: Map<string, LiveVessel>;
  connected: boolean;
}

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/live`;
}

function toLiveVessel(msg: Record<string, unknown>): LiveVessel | null {
  const position = msg.position as { lon: number; lat: number } | null;
  if (!position) return null;
  return {
    mmsi: msg.mmsi as string,
    name: (msg.name as string | null) ?? null,
    lon: position.lon,
    lat: position.lat,
    sogKn: (msg.sog_kn as number | null) ?? null,
    cogDeg: (msg.cog_deg as number | null) ?? null,
    headingDeg: (msg.heading_deg as number | null) ?? null,
    navStatus: (msg.nav_status as string | null) ?? null,
    observedAt: (msg.observed_at as string | null) ?? null,
    receivedAt: msg.received_at as string,
    qualityFlags: (msg.quality_flags as string[]) ?? [],
    source: (msg.source as string | null) ?? null,
  };
}

/** Connects once and keeps the socket open across viewport changes,
 * re-sending subscription.replace on the same connection (PRD SS11.1). */
export function useLiveVessels(bbox: Bbox): LiveState {
  const [vessels, setVessels] = useState<Map<string, LiveVessel>>(new Map());
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const socket = new WebSocket(wsUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        socket.send(JSON.stringify({ type: "subscription.replace", bbox }));
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        if (msg.type === "snapshot.begin") {
          setVessels(new Map());
        } else if (msg.type === "vessel.snapshot" || msg.type === "vessel.upsert") {
          const vessel = toLiveVessel(msg);
          if (vessel) {
            setVessels((prev) => {
              const next = new Map(prev);
              next.set(vessel.mmsi, vessel);
              return next;
            });
          }
        }
      };

      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (!closedByEffect) {
          const jitterMs = 1000 + Math.random() * 2000;
          reconnectTimer = setTimeout(connect, jitterMs);
        }
      };
    }

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
    // Only reconnect on mount/unmount; the effect below handles bbox changes
    // on the already-open socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "subscription.replace", bbox }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat]);

  return { vessels, connected };
}
