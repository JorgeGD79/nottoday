/** Etiqueta legible de una variante: "L", "Negro / L", "Única". */
export function variantLabel(v: { size: string; color?: string | null }): string {
  if (v.size === "GENERAL") return "Entrada general";
  return v.color ? `${v.color} / ${v.size}` : v.size;
}
