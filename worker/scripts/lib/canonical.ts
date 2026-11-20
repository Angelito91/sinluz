/**
 * Normalización de alias para construir el catálogo.
 *
 * Ya no se usa en tiempo de ejecución: el modelo recibe los alias y decide.
 * Se conserva para validar y deduplicar `circuits.csv`.
 */

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
