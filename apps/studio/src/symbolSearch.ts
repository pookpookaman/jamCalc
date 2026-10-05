/**
 * Whether a name answers a search in the values list.
 *
 * People search for what they see on the page as often as for what they typed,
 * so a name matches on either spelling: `phi_M_n` is found by `phi`, by `φ`,
 * and by `M_n`. Case, underscores, the comma a nested subscript is drawn with,
 * and the backtick that keeps a word as written are all ignored — `Mn` finds
 * `M_n`, and `pi` finds both `pi` and `` `pi ``, which is exactly when being
 * shown both matters.
 */

import { renderNamePlain } from "@jamcalc/engine";

const fold = (text: string): string => text.toLowerCase().replace(/[`_,\s]/g, "");

export function matchesSymbol(name: string, query: string): boolean {
  const q = fold(query);
  if (q === "") return true;
  return fold(name).includes(q) || fold(renderNamePlain(name)).includes(q);
}
