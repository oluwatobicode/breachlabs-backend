const PUNCTUATION_REGEX = /["'`’“”.,!?;:()[\]{}]/g;

export const normalize = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
