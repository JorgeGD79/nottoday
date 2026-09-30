// ============================================================================
// Documento de identidad de los asistentes con entrada nominativa.
//
// Se acepta DNI, NIE (ambos con su letra de control comprobada) o, para quien
// no tenga documento español, un pasaporte u otro documento alfanumérico.
// ============================================================================

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const DNI = /^(\d{8})([A-Z])$/;
const NIE = /^([XYZ])(\d{7})([A-Z])$/;
const OTHER = /^[A-Z0-9]{5,20}$/;

/** Mayúsculas y sin espacios, puntos ni guiones: "12.345.678-z" -> "12345678Z". */
export function normalizeIdDocument(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-/]/g, "");
}

export type IdDocumentCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkIdDocument(raw: string): IdDocumentCheck {
  const value = normalizeIdDocument(raw);
  const dni = DNI.exec(value);
  if (dni) {
    return DNI_LETTERS[Number(dni[1]) % 23] === dni[2]
      ? { ok: true, value }
      : { ok: false, error: `El DNI ${value} no es válido (revisa la letra)` };
  }
  const nie = NIE.exec(value);
  if (nie) {
    const number = Number(`${"XYZ".indexOf(nie[1])}${nie[2]}`);
    return DNI_LETTERS[number % 23] === nie[3]
      ? { ok: true, value }
      : { ok: false, error: `El NIE ${value} no es válido (revisa la letra)` };
  }
  // Parece un DNI/NIE mal escrito (p. ej. le falta la letra): mejor avisar que
  // aceptarlo como "otro documento".
  if (/^\d{7,8}$/.test(value) || /^[XYZ]\d{6,7}$/.test(value)) {
    return { ok: false, error: `Al documento ${value} le falta la letra` };
  }
  return OTHER.test(value)
    ? { ok: true, value }
    : { ok: false, error: "Documento no válido: indica DNI, NIE o pasaporte" };
}

/** Para mostrárselo al comprador (email, seguimiento): solo los 4 últimos caracteres. */
export function maskIdDocument(value: string | null): string | null {
  if (!value) return null;
  return `•••••${value.slice(-4)}`;
}
