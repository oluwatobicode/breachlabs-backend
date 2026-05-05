export const sanitizeSearchTerm = (term: string) =>
  term.trim().replace(/[%_]/g, "");
