import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

type Props = {
  online: boolean;
  ageMin: number;
  error?: string;
  isValidating: boolean;
};

export default function StatusBanner({ online, ageMin, error, isValidating }: Props) {
  if (!online) {
    return (
      <Bar tone="warn" icon={<WifiOff className="h-3.5 w-3.5" />}>
        Sin conexión · mostrando la última información guardada
      </Bar>
    );
  }
  if (error && ageMin > 90) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        No se pudo actualizar. Datos de hace {Math.round(ageMin / 60)} h
      </Bar>
    );
  }
  if (ageMin > 360) {
    return (
      <Bar tone="bad" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        El canal lleva {Math.floor(ageMin / 60)} h sin publicar. No hay datos fiables.
      </Bar>
    );
  }
  if (ageMin > 90) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        Última actualización hace {Math.floor(ageMin / 60)} h. Puede haber cambiado.
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
    <div className={`flex items-center gap-2 border-b px-4 py-2 text-[12px] ${styles}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
