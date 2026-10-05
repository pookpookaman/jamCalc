/**
 * Notation splitting — how a name is *written* versus how it is *spelled*.
 *
 * `M_u` is one identifier to the engine and "M with subscript u" to a reader.
 * Splitting that is the smallest useful piece of math typesetting, and it
 * belongs in the engine rather than the shell because the desktop app, the web
 * viewer, the PDF exporter and the text projection all need the same answer.
 *
 * This does not attempt layout. It says what the parts are; a renderer decides
 * how they look.
 */

/** `f'_c` -> base `f`, primes `'`, subscript `c`. */
export interface NameParts {
  readonly base: string;
  readonly primes: string;
  readonly subscript?: string;
}

/**
 * Greek names spelled in ASCII render as the letter. Engineers type `phi`,
 * and a calc sheet that prints "phi" instead of φ reads as a programming
 * language, not a calculation.
 */
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

/**
 * A word written with a leading backtick is kept as written: `` `phi `` is the
 * word "phi", for when the word itself is what is meant (ADR-0015). The
 * backtick is part of the name, so a name draws the same way wherever it is
 * used; only the drawing drops it.
 */
export const LITERAL_MARK = "`";

function toSymbol(word: string): string {
  if (word.startsWith(LITERAL_MARK)) return word.slice(LITERAL_MARK.length);
  return GREEK[word] ?? word;
}

/**
 * Splits an identifier into renderable parts.
 *
 * Only the FIRST underscore starts the subscript; the rest belong to it, so
 * `phi_M_n` is φ with subscript "M_n" — matching how it is read aloud, and
 * matching the fact that the engine treats the whole thing as one name.
 */
export function splitName(name: string): NameParts {
  const firstUnderscore = name.indexOf("_");
  const head = firstUnderscore < 0 ? name : name.slice(0, firstUnderscore);
  const tail = firstUnderscore < 0 ? "" : name.slice(firstUnderscore + 1);

  const primeMatch = /'+$/.exec(head);
  const primes = primeMatch ? primeMatch[0] : "";
  const base = primes === "" ? head : head.slice(0, -primes.length);

  const subscript =
    tail === ""
      ? undefined
      : tail
          .split("_")
          .map((part) => toSymbol(part))
          .join(",");

  return subscript === undefined
    ? { base: toSymbol(base), primes }
    : { base: toSymbol(base), primes, subscript };
}

/** Plain-text form, for the projection and for anywhere without markup. */
export function renderNamePlain(name: string): string {
  const { base, primes, subscript } = splitName(name);
  return subscript === undefined
    ? `${base}${primes}`
    : `${base}${primes}_${subscript}`;
}
