import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Info, WifiOff, X } from "lucide-react";
import { hhmm } from "../lib/time";

type Props = {
  online: boolean;
  /** Minutos desde la última lectura correcta del canal por el servidor. */
  pipelineAgeMin: number;
  /** Minutos desde el último mensaje publicado en el canal. */
  channelAgeMin: number | null;
  error?: string;
  isValidating: boolean;
  /** Último error de la ingesta en el servidor (si lo hay). */
  lastError?: string | null;
  /** Segundos unix hasta los que la ingesta está en espera (backoff). */
  backoffUntil?: number | null;
  /** Hora actual en segundos unix. */
  now: number;
};

type Tone = "info" | "warn" | "bad";

type Alert = {
  key: string;
  tone: Tone;
  title: string;
  message: string;
  icon: React.ReactNode;
};

const age = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h`);

export default function StatusBanner({
  online,
  pipelineAgeMin,
  channelAgeMin,
  error,
  isValidating: _isValidating,
  lastError,
  backoffUntil,
  now,
}: Props) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  const alert = useMemo<Alert | null>(() => {
    const backoffActive = !!(backoffUntil && backoffUntil > now);
    const backoffInfo = backoffActive ? ` · reintento ~${hhmm(backoffUntil!)}` : "";
    const detail = lastError ? ` (${lastError})` : "";

    if (!online) {
      return {
        key: "offline",
        tone: "warn",
        title: "Sin conexión",
        message: "Mostrando la última información guardada en este dispositivo.",
        icon: <WifiOff className="h-4 w-4" />,
      };
    }
    if (error) {
      return {
        key: `error:${Math.floor(pipelineAgeMin / 10)}`,
        tone: "warn",
        title: "No se pudo actualizar",
        message: `Datos de hace ${age(pipelineAgeMin)}. Se volverá a intentar automáticamente.`,
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }
    if (pipelineAgeMin > 30) {
      return {
        key: `pipeline:${pipelineAgeMin > 360 ? "stale" : "warn"}:${lastError ?? ""}:${backoffActive ? "b" : "n"}`,
        tone: pipelineAgeMin > 360 ? "bad" : "warn",
        title: `Sin lectura del canal desde hace ${age(pipelineAgeMin)}`,
        message: `${detail ? `Aviso:${detail}${backoffInfo}. ` : backoffInfo ? `Reintento${backoffInfo}. ` : ""}Los estados pueden haber cambiado.`,
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }
    if (backoffActive && lastError) {
      return {
        key: `backoff:${backoffUntil}:${lastError}`,
        tone: "info",
        title: "Lectura del canal en espera",
        message: `Aviso:${detail}${backoffInfo}. Se reintentará automáticamente.`,
        icon: <Clock className="h-4 w-4" />,
      };
    }
    if (channelAgeMin != null && channelAgeMin >= 360) {
      return {
        key: `channel:${Math.floor(channelAgeMin / 60)}`,
        tone: "warn",
        title: `El canal lleva ${Math.floor(channelAgeMin / 60)} h sin publicar`,
        message: "Los estados pueden no estar al día hasta que haya nuevos avisos.",
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }
    if (channelAgeMin != null && channelAgeMin >= 90) {
      return {
        key: `channel-quiet:${Math.floor(channelAgeMin / 30)}`,
        tone: "info",
        title: `El canal no publica desde hace ${age(channelAgeMin)}`,
        message: "SinLuz sigue consultando; puede haber cambios sin aviso.",
        icon: <Info className="h-4 w-4" />,
      };
    }
    if (lastError) {
      return {
        key: `lasterror:${lastError}`,
        tone: "info",
        title: "Último intento con aviso",
        message: `Aviso:${detail}. Se volverá a intentar pronto.`,
        icon: <Info className="h-4 w-4" />,
      };
    }
    return null;
  }, [online, pipelineAgeMin, channelAgeMin, error, lastError, backoffUntil, now]);

  useEffect(() => {
    if (alert && dismissed && dismissed !== alert.key) setDismissed(null);
  }, [alert, dismissed]);

  if (!alert || dismissed === alert.key) return null;

  const styles = {
    info: "border-sky-200/70 bg-surface/98 text-sky-950 dark:border-sky-400/20 dark:text-sky-100",
    warn: "border-amber-200/70 bg-surface/98 text-amber-950 dark:border-amber-400/20 dark:text-amber-100",
    bad: "border-red-200/70 bg-surface/98 text-red-950 dark:border-red-400/20 dark:text-red-100",
  }[alert.tone];

  const iconStyles = {
    info: "text-sky-600 dark:text-sky-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[alert.tone];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1200] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div
        role="alert"
        className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border p-3 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-md dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] ${styles}`}
      >
        <span className={`mt-0.5 shrink-0 ${iconStyles}`}>{alert.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{alert.title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink/70 dark:text-inherit/80">{alert.message}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(alert.key)}
          aria-label="Cerrar aviso"
          className="shrink-0 rounded-full p-1.5 text-ink/45 transition hover:bg-muted hover:text-ink/75"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
