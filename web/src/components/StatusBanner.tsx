import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

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
  if (channelAgeMin != null && channelAgeMin > 360) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        El canal lleva {Math.floor(channelAgeMin / 60)} h sin publicar. Los estados pueden no estar al día.
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
  tone: "warn" | "bad" | "muted";
  icon: React.ReactNode;
}) {
  const styles = {
    warn: "bg-amber-50 text-amber-900 border-amber-200",
    bad: "bg-red-50 text-red-900 border-red-200",
    muted: "bg-black/[0.03] text-ink/60 border-transparent",
  }[tone];

  return (
    <div role="status" className={`flex items-center gap-2 border-b px-4 py-2 text-[12px] ${styles}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
