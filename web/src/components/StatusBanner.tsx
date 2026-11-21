import { AlertTriangle, Info, RefreshCw, WifiOff } from "lucide-react";

type Props = {
  online: boolean;
  /** Minutos desde la última lectura correcta del canal por el servidor. */
  pipelineAgeMin: number;
  /** Minutos desde el último mensaje publicado en el canal. */
  channelAgeMin: number | null;
  error?: string;
  isValidating: boolean;
};

const age = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h`);

export default function StatusBanner({ online, pipelineAgeMin, channelAgeMin, error, isValidating }: Props) {
  if (!online) {
    return (
      <Bar tone="warn" icon={<WifiOff className="h-3.5 w-3.5" />}>
        Sin conexión · mostrando la última información guardada
      </Bar>
    );
  }
  if (error) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        No se pudo actualizar. Datos de hace {age(pipelineAgeMin)}
      </Bar>
    );
  }
  if (pipelineAgeMin > 30) {
    return (
      <Bar tone={pipelineAgeMin > 360 ? "bad" : "warn"} icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        No se pudo leer el canal desde hace {age(pipelineAgeMin)}. Los estados pueden haber cambiado.
      </Bar>
    );
  }
  if (channelAgeMin != null && channelAgeMin >= 360) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        El canal lleva {Math.floor(channelAgeMin / 60)} h sin publicar. Los estados pueden no estar al día.
      </Bar>
    );
  }
  if (channelAgeMin != null && channelAgeMin >= 90) {
    return (
      <Bar tone="info" icon={<Info className="h-3.5 w-3.5" />}>
        El canal no publica desde hace {age(channelAgeMin)}. SinLuz sigue consultando; puede haber cambios sin aviso.
      </Bar>
    );
  }
  if (isValidating) {
    return (
      <Bar tone="muted" icon={<RefreshCw className="h-3.5 w-3.5 animate-spin" />}>
        Actualizando…
      </Bar>
    );
  }
  return null;
}

function Bar({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: "info" | "warn" | "bad" | "muted";
  icon: React.ReactNode;
}) {
  const styles = {
    info: "bg-sky-50 text-sky-900 border-sky-200/70 dark:bg-sky-500/12 dark:text-sky-200 dark:border-sky-400/20",
    warn: "bg-amber-50 text-amber-900 border-amber-200/70 dark:bg-amber-500/12 dark:text-amber-200 dark:border-amber-400/20",
    bad: "bg-red-50 text-red-900 border-red-200/70 dark:bg-red-500/12 dark:text-red-200 dark:border-red-400/20",
    muted: "bg-muted text-ink/60 border-transparent",
  }[tone];

  return (
    <div role="status" className={`flex items-center gap-2 border-b px-4 py-2 text-[12px] ${styles}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
