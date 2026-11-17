import type { CatalogCircuit } from "@sinluz/shared";

/**
 * Normalización y emparejamiento de nombres de circuitos.
 *
 * El canal escribe el mismo circuito de formas muy distintas:
 *   "Línea 4395Contramaestre(5175)", "LI 5395-San Luis", "ll Frente", "3+2".
 * En vez de partir el mensaje en segmentos (frágil), se busca cada alias del
 * catálogo dentro del texto canónico, de más largo a más corto y sin solapes.
 */

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

/** Quita tildes, mayúsculas, signos; colapsa espacios. */
export function canonical(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+de santiago$/, "")
    .replace(/\blll\b/g, "iii")
    .replace(/\bll\b/g, "ii");
}

export function canonicalAlias(alias: string): string {
  return canonical(alias).replace(/^li\s+/, "linea ");
}

/** "22 horas y 08 minutos" → 1328 */
export function parseDurationMinutes(s: string): number | null {
  const m = s.match(/(\d+)\s*h(?:oras?)?(?:\s*y\s*(\d+)\s*min(?:utos?)?)?/i);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

export type AliasEntry = { id: string; tokens: string[]; alias: string };

export type AliasIndex = {
  /** primera palabra → alias candidatos, de más largo a más corto */
  byFirst: Map<string, AliasEntry[]>;
  all: AliasEntry[];
};

export function buildAliasIndex(circuits: CatalogCircuit[]): AliasIndex {
  const byFirst = new Map<string, AliasEntry[]>();
  const all: AliasEntry[] = [];
  const seen = new Set<string>();

  for (const c of circuits) {
    for (const alias of [c.name, ...c.aliases]) {
      const key = canonicalAlias(alias);
      if (!key) continue;
      const dedupe = `${c.id}:${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const entry: AliasEntry = { id: c.id, tokens: key.split(" "), alias };
      all.push(entry);
      // índice por primera palabra para el escaneo
      const first = entry.tokens[0];
      const list = byFirst.get(first) ?? [];
      list.push(entry);
      byFirst.set(first, list);
    }
  }

  for (const list of byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  all.sort((a, b) => b.tokens.length - a.tokens.length);

  // conflicto real: dos circuitos distintos con el mismo alias
  const owner = new Map<string, string>();
  for (const e of all) {
    const key = e.tokens.join(" ");
    const prev = owner.get(key);
    if (prev && prev !== e.id) {
      throw new Error(`alias duplicado "${key}": ${prev} vs ${e.id}. Corrige circuits.csv.`);
    }
    owner.set(key, e.id);
  }

  return { byFirst, all };
}

export type Hit = {
  id: string;
  alias: string;
  confidence: number;
  minutes: number | null;
  /** posición del match en el texto canónico, para depurar */
  at: number;
};

/** Divide el mensaje en líneas y quita emojis y duraciones. */
function lines(text: string): { line: string; minutes: number | null }[] {
  return decode(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .split("\n")
    .map((raw) => {
      const minutes = parseDurationMinutes(raw);
      const line = raw
        .replace(/➡️?/g, " ")
        .replace(/[:,;]?\s*\d+\s*h(?:oras?)?(?:\s*y\s*\d+\s*min(?:utos?)?)?\.?$/i, " ")
        .replace(EMOJI, " ")
        .replace(/\uFE0F|\u20E3/g, " ");
      return { line, minutes };
    });
}

/** "1 y 2 de Contramaestre" → "1 de Contramaestre y 2 de Contramaestre". */
function expandCoordinated(line: string): string {
  return line
    .replace(/(\d+)\s+y\s+(\d+)\s+de\s+([a-z]+)/g, "$1 de $3 y $2 de $3")
    .replace(/(\d+)\s+y\s+(\d+)\s+(contramaestre|palma|santiago)/g, "$1 $3 y $2 $3");
}

/**
 * Busca todos los circuitos mencionados en un mensaje, sin solapes.
 * Devuelve solo coincidencias de alias: nunca adivina por parecido.
 */
export function findHits(text: string, index: AliasIndex): Hit[] {
  const hits: Hit[] = [];

  for (const { line, minutes } of lines(text)) {
    const words = expandCoordinated(canonical(line)).split(" ").filter(Boolean);
    let i = 0;

    while (i < words.length) {
      const candidates = index.byFirst.get(words[i]) ?? [];
      let matched: AliasEntry | null = null;

      for (const cand of candidates) {
        if (i + cand.tokens.length > words.length) continue;
        const window = words.slice(i, i + cand.tokens.length).join(" ");
        if (window === cand.tokens.join(" ")) {
          matched = cand;
          break;
        }
      }

      if (matched) {
        hits.push({
          id: matched.id,
          alias: matched.alias,
          confidence: score(matched),
          minutes,
          at: i,
        });
        i += matched.tokens.length;
      } else {
        i++;
      }
    }
  }

  return hits;
}

/** Un alias de una sola palabra o un número suelto es menos fiable. */
function score(e: AliasEntry): number {
  if (e.tokens.length >= 2) return 1;
  return /^\d+$/.test(e.tokens[0]) ? 0.85 : 0.7;
}

export type Matched = Map<string, Hit>;

export function groupHits(hits: Hit[]): Matched {
  const map = new Map<string, Hit>();
  for (const h of hits) {
    const prev = map.get(h.id);
    if (!prev || h.confidence > prev.confidence || (h.minutes && !prev.minutes)) {
      map.set(h.id, h);
    }
  }
  return map;
}

/** Segmentos sin coincidencia, para el informe de cobertura. */
export function unmatchedSegments(text: string, index: AliasIndex): string[] {
  const out: string[] = [];
  for (const { line } of lines(text)) {
    const clean = canonical(line);
    if (!clean || clean.length < 2 || BOILERPLATE.test(clean)) continue;
    if (/\b\d{5,}\b/.test(clean)) continue; // teléfonos y cifras largas
    const hits = findHits(line, index);
    if (hits.length > 0) continue;
    // solo interesan líneas que parezcan listas de circuitos
    const circuitish = /^(circuito|linea|ramal|hospital|subestacion|seccionalizado|sd|si)\b/.test(clean);
    if (!circuitish && !/^\d{1,2}(\s|$)/.test(clean)) continue;
    out.push(clean);
  }
  return out;
}

const BOILERPLATE =
  /^(actualizacion|se afecta|se afectan|se restablece|se restablecen|se incorporan|se les informa|se encuentra|se encuentran|estimados|si usted|el tiempo|continuaremos|en estos momentos|provincia|con servicio|mw|deficit|por deficit|los siguientes|las siguientes|a la siguiente|el servicio|servicio electrico|nota|reitera|actualmente|santiago|guama|palma|pendientes|transformadores|barriadas|averias|limitaciones|la produccion|la disponibilidad|las limitaciones|se trabaja|si presenta)|mw\b|mwh\b|quejas|%/;
