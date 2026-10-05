/**
 * Which property controls belong on screen.
 *
 * A bar that is always there with half its controls greyed out teaches people
 * to stop reading it. Worse, it implies things are possible that are not: a
 * decimals control beside a selected picture is a promise the app cannot keep.
 *
 * So the rule is: a control appears when it would do something. That is a
 * decision about capability, not a rendering, which is why it lives here and
 * is tested rather than being tangled into JSX.
 *
 * Capabilities are what each kind actually *honours* when drawn, not what the
 * model permits. A plot's tick labels come from the SVG's own styles, so a
 * font size would silently do nothing — and offering it would be a lie.
 */

export type Kind = "math" | "text" | "table" | "plot" | "image" | "pagebreak";

export interface Controls {
  /** Font size. */
  readonly size: boolean;
  /** The region's ink — in a math region, the equation. */
  readonly colour: boolean;
  /** Math only: the result's own colour, apart from the equation's. */
  readonly resultColour: boolean;
  /** Bold and italic. */
  readonly weight: boolean;
  /** Left, centre, right — prose only. */
  readonly align: boolean;
  /** How many decimals a computed number shows. */
  readonly decimals: boolean;
  /** The display-unit picker. */
  readonly units: boolean;
  /** True when nothing at all applies, so the group can be hidden entirely. */
  readonly none: boolean;
}

const NOTHING = {
  size: false,
  colour: false,
  resultColour: false,
  weight: false,
  align: false,
  decimals: false,
  units: false,
} as const;

/** What each kind does something useful with. */
const CAPABILITY: Record<Kind, Omit<Controls, "none" | "units">> = {
  math: { size: true, colour: true, resultColour: true, weight: true, align: false, decimals: true },
  text: { size: true, colour: true, resultColour: false, weight: true, align: true, decimals: false },
  // A table's numbers are typed, not computed: nothing to round, and no result.
  table: { size: true, colour: true, resultColour: false, weight: true, align: false, decimals: false },
  // A plot draws its own labels from the stylesheet; none of these reach it.
  plot: { ...NOTHING },
  image: { ...NOTHING },
  pagebreak: { ...NOTHING },
};

const withNone = (c: Omit<Controls, "none">): Controls => ({
  ...c,
  none: !c.size && !c.colour && !c.weight && !c.align && !c.decimals && !c.units,
});

/**
 * @param kinds        the kinds of every selected region
 * @param textRange    true when characters inside a text region are highlighted
 * @param unitsUsable  true when exactly one math region is selected and it
 *                     shows a result that a unit could be chosen for
 */
export function formatControls(
  kinds: readonly Kind[],
  textRange: boolean,
  unitsUsable = false,
): Controls {
  // A highlight inside prose is the most specific target there is: the
  // controls are the ones that can act on characters, plus alignment, which
  // acts on the block the characters are in.
  if (textRange) {
    return withNone({
      size: true,
      colour: true,
      resultColour: false,
      weight: true,
      align: true,
      decimals: false,
      units: false,
    });
  }

  if (kinds.length === 0) return withNone({ ...NOTHING, units: false });

  // Everything selected must honour a control for it to be offered; otherwise
  // pressing it would change some of the selection and quietly skip the rest.
  const every = (pick: (c: Omit<Controls, "none" | "units">) => boolean): boolean =>
    kinds.every((k) => pick(CAPABILITY[k]));

  return withNone({
    size: every((c) => c.size),
    colour: every((c) => c.colour),
    resultColour: every((c) => c.resultColour),
    weight: every((c) => c.weight),
    align: every((c) => c.align),
    decimals: every((c) => c.decimals),
    units: unitsUsable && kinds.length === 1 && kinds[0] === "math",
  });
}
