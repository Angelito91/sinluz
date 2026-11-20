/** Todas las marcas de tiempo de la app están en segundos unix (como Telegram). */

export function elapsed(since: number | null, now: number): string {
  if (!since) return "—";
  const secs = Math.max(0, Math.floor(now - since));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d} d ${h} h ${m} min`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export function ago(ts: number | null, now: number): string {
  if (!ts) return "sin datos";
  const min = Math.max(0, Math.round((now - ts) / 60));
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function hhmm(ts: number | null): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("es-CU", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Havana",
  }).format(new Date(ts * 1000));
}
