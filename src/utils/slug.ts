// Marcas diacríticas que deja la normalización NFD ("á" -> "a" + U+0301).
const COMBINING_MARKS = /\p{M}/gu;

/**
 * "Sudadera Negra Ñandú" -> "sudadera-negra-nandu". Minúsculas, sin acentos,
 * solo [a-z0-9] separados por guiones.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

/** "Sudadera Ñandú" -> "sudadera nandu": para buscar sin acentos ni mayúsculas. */
export function normalizeSearch(input: string): string {
  return input.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Devuelve `base` o, si ya existe, `base-2`, `base-3`... La comprobación de
 * existencia la da el llamador (producto o categoría).
 */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  if (!(await exists(root))) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Etiqueta legible de una variante: "L", "Negro / L", "Única". */
export function variantLabel(v: { size: string; color?: string | null }): string {
  if (v.size === "GENERAL") return "Entrada general";
  return v.color ? `${v.color} / ${v.size}` : v.size;
}
