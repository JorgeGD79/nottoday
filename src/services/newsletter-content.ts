// ============================================================================
// Formato del cuerpo de las newsletters. El panel escribe texto con un formato
// mínimo y aquí se convierte a HTML de email (estilos inline) y a texto plano:
//
//   Párrafos separados por una línea en blanco (un salto simple = <br>)
//   ## Subtítulo
//   - elemento de lista        (todas las líneas del bloque empiezan por "- ")
//   **negrita**
//   [texto del enlace](https://...)   (solo http/https)
//
// Todo el texto se escapa antes de aplicar el formato: no admite HTML propio.
// ============================================================================

const ACCENT = "#ff8a00";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;

function inlineHtml(line: string): string {
  return escapeHtml(line)
    .replace(LINK, (_m, label: string, url: string) =>
      `<a href="${url}" style="color:${ACCENT};text-decoration:underline;">${label}</a>`)
    .replace(BOLD, (_m, text: string) => `<strong style="color:#e5e2e1;">${text}</strong>`);
}

function inlineText(line: string): string {
  return line.replace(LINK, (_m, label: string, url: string) => `${label} (${url})`).replace(BOLD, "$1");
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; lines: string[] };

function parseBlocks(body: string): Block[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== ""))
    .filter((lines) => lines.length > 0)
    .flatMap((lines): Block[] => {
      if (lines.length === 1 && lines[0].startsWith("## ")) {
        return [{ kind: "heading", text: lines[0].slice(3).trim() }];
      }
      if (lines.every((l) => /^\s*- /.test(l))) {
        return [{ kind: "list", items: lines.map((l) => l.replace(/^\s*- /, "")) }];
      }
      return [{ kind: "paragraph", lines }];
    });
}

/** Cuerpo de la newsletter en HTML para email (estilos inline). */
export function renderNewsletterBodyHtml(body: string): string {
  return parseBlocks(body)
    .map((block) => {
      if (block.kind === "heading") {
        return `<h2 style="margin:28px 0 8px;font-size:18px;line-height:1.2;text-transform:uppercase;color:#e5e2e1;">${inlineHtml(block.text)}</h2>`;
      }
      if (block.kind === "list") {
        return `<ul style="margin:0 0 16px;padding-left:20px;">${block.items
          .map((item) => `<li style="margin:0 0 6px;">${inlineHtml(item)}</li>`)
          .join("")}</ul>`;
      }
      return `<p style="margin:0 0 16px;">${block.lines.map(inlineHtml).join("<br>")}</p>`;
    })
    .join("\n");
}

/** Cuerpo de la newsletter en texto plano (parte text/plain del email). */
export function renderNewsletterBodyText(body: string): string {
  return parseBlocks(body)
    .map((block) => {
      if (block.kind === "heading") return inlineText(block.text).toUpperCase();
      if (block.kind === "list") return block.items.map((i) => `- ${inlineText(i)}`).join("\n");
      return block.lines.map(inlineText).join("\n");
    })
    .join("\n\n");
}
