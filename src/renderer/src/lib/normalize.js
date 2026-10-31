// Subject codes appear as "BCS-501" and "BCS501" in the department files.
// Store and display the second form: uppercase, no dash or space.
export function normalizeSubjectCode(value) {
  return String(value ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

