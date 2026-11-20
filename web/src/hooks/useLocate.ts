import { useCallback, useState } from "react";

export type Position = { lat: number; lon: number; accuracy: number; at: number };

export type Locate = {
  state: "idle" | "loading" | "ok" | "denied" | "unavailable";
  position: Position | null;
  request: () => void;
};

/**
 * Ubicación del usuario. Se pide solo al pulsar el botón y se queda en el
 * dispositivo: nunca se envía a ningún servidor ni se guarda.
 */
export function useLocate(): Locate {
  const [state, setState] = useState<Locate["state"]>("idle");
  const [position, setPosition] = useState<Position | null>(null);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState("unavailable");
      return;
    }
    setState("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() });
        setState("ok");
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  return { state, position, request };
}
