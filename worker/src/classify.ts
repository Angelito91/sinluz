import type { Intent } from "@sinluz/shared";

/**
 * Clasificación de intención.
 *
 * El orden importa: un mensaje de restablecimiento puede contener la palabra
 * "circuitos" y un top-N puede parecer un snapshot. Las reglas están ordenadas
 * de la más específica a la más general.
 *
 * Además de los mensajes largos con lista, el canal publica avisos de una línea
 * ("Se encuentra afectado por Déficit el circuito 3 de Santiago",
 * "Se encuentran con servicio: Circuito 21…"). Se tratan como add y restore:
 * son cambios de estado reales, no simple información.
 */
export function classify(text: string): Intent {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const flat = t.replace(/<br\s*\/?>/g, " ").replace(/\s+/g, " ");

  // 1. Restablecimientos explícitos. Se excluye el aviso genérico
  //    ("el restablecimiento estará en dependencia..."), que no cambia estado.
  if (/restablec(e|en|idos?|imiento)\b/.test(flat) && !/dependencia/.test(flat)) {
    return "restore";
  }

  // 1b. "Se encuentran con servicio: …", "Con servicio el circuito 2 de Palma".
  //     Se exige que hable de circuitos para no confundirlo con "con servicio
  //     40 MW", que es una cifra de la provincia.
  if (
    /\b(con servicio)\b(?!\s*\d)/.test(flat) &&
    /(circuito|linea|ramal|hospital)/.test(flat) &&
    !/mw\s*servid|servidos?\s*[-:.]?\s*\d/.test(flat)
  ) {
    return "restore";
  }

  // 2. Lista parcial: solo los que llevan más tiempo. NUNCA borra estado.
  if (/mayor tiempo|mayor afectacion|mas afectad/.test(flat)) {
    return "top_n";
  }

  // 2b. "Actualización de los circuitos que se encuentran afectados" sin
  //     "se afecta el servicio": el canal suele listar solo los más críticos.
  //     Se trata como parcial para no borrar estado por una lista incompleta.
  if (/circuitos que se encuentran afectados/.test(flat) && !/se afecta el servicio/.test(flat)) {
    return "top_n";
  }

  // 3. Altas incrementales: listas cortas y avisos de una línea.
  if (
    /se incorporan|incorporan a la afectacion|se suma|entran en afectacion|entra en afectacion/.test(
      flat,
    ) ||
    /se encuentra(n)? afectad[oa]s? por deficit|est[aá] afectad[oa] por deficit/.test(flat) ||
    /se encuentra(n)? disparad[oa]s?/.test(flat)
  ) {
    return "add";
  }

  // 4. Snapshot: el mensaje afirma explícitamente que esta es la lista actual.
  if (
    /se afecta el servicio|se afectan los siguientes|siguientes circuitos|siguientes lineas/.test(
      flat,
    )
  ) {
    return "snapshot";
  }

  // 5. Solo cifras de la provincia.
  if (/mw\s*afectad|mw\s*servid|mw afectados|mw servidos/.test(flat)) {
    return "metrics";
  }

  return "info";
}

export type Metrics = { deficit_mw: number | null; served_mw: number | null };

/** Extrae "100 MW afectados" y "MW Servidos- 40". */
export function parseMetrics(text: string): Metrics {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const deficit =
    t.match(/(\d+)\s*mw\s*afectad/) ??
    t.match(/mw\s*afectados?\s*[-:.]?\s*(\d+)/) ??
    t.match(/afectados?\s*[-:.]?\s*(\d+)\s*mw/);

  const served =
    t.match(/mw\s*servidos?\s*[-:.]?\s*(\d+)/) ??
    t.match(/con servicio\s*(\d+)\s*mw/) ??
    t.match(/servidos?\s*[-:.]?\s*(\d+)\s*mw/) ??
    t.match(/(\d+)\s*mw\s*servidos/);

  return {
    deficit_mw: deficit ? Number(deficit[1]) : null,
    served_mw: served ? Number(served[1]) : null,
  };
}
