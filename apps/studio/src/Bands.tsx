/**
 * The header and footer on a page, drawn and — in edit mode — edited in place.
 *
 * docs/headers.md. The same band is drawn on every page with that page's
 * numbers; editing it on any page edits it everywhere. Outside edit mode the
 * items are pictures and nothing in them can be clicked; double-clicking the
 * band is the way in.
 *
 * Every change is computed from the band as it was when the gesture began
 * (`bandEdit.ts`), so a drag delivering several moves between renders cannot
 * compound them, and each gesture is one undo step.
 */

import { useRef, useState, type JSX } from "react";
import {
  bandHeight,
  fieldInfo,
  fieldValue,
  fillBandText,
  isEmptyBand,
  type BandItem,
  type FieldName,
  type PageBand,
  type PageFields,
  type PageSetup,
} from "@jamcalc/engine";
import {
  addItem,
  changeItem,
  moveItem,
  resizeBand,
  resizeItem,
  type Bounds,
  type NewItem,
} from "./bandEdit.js";

export type Where = "header" | "footer";

export interface BandSelection {
  readonly where: Where;
  readonly id: string;
}

/** What a palette chip carries when dragged onto a band. */
export const BAND_ITEM_MIME = "application/x-jamcalc-band-item";

/** Fields whose value is typed once per sheet, and so can be typed here. */
const TYPED: ReadonlySet<FieldName> = new Set([
  "title",
  "project",
  "job",
  "subject",
  "client",
  "by",
  "date",
  "checkedBy",
  "checkedDate",
  "rev",
]);

export interface PageBandsProps {
  readonly page: PageSetup;
  readonly paper: { readonly width: number; readonly height: number };
  readonly fields: PageFields;
  readonly editing: boolean;
  readonly selected: BandSelection | null;
  readonly onSelect: (selection: BandSelection | null) => void;
  readonly onBand: (where: Where, band: PageBand, tag?: string) => void;
  readonly onValue: (field: FieldName, value: string) => void;
  readonly onStartEditing: () => void;
}

/** Movement under this is a click, not a drag. */
const DRAG_THRESHOLD = 3;
let gestures = 0;

export function PageBands(props: PageBandsProps): JSX.Element {
  return (
    <>
      <BandZone {...props} where="header" />
      <BandZone {...props} where="footer" />
    </>
  );
}

function BandZone({
  where,
  page,
  paper,
  fields,
  editing,
  selected,
  onSelect,
  onBand,
  onValue,
  onStartEditing,
}: PageBandsProps & { where: Where }): JSX.Element | null {
  const band = page[where];
  const height = bandHeight(page, where);
  const bounds: Bounds = { width: paper.width, height };
  const zone = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const hidden = band?.enabled === false;
  const empty = isEmptyBand(band);

  /**
   * A drag on an item or on the band's edge. Movement is measured from where
   * the press began and applied to the band as it was then.
   */
  const startDrag = (
    e: React.PointerEvent,
    apply: (dx: number, dy: number) => PageBand,
    onClick?: () => void,
  ): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    const tag = `band-drag-${(gestures += 1)}`;
    let moved = false;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      onBand(where, apply(dx, dy), tag);
    };
    const up = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (!moved) onClick?.();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const zoneClass = [
    "band-zone",
    `band-${where}`,
    editing ? "is-editing" : "",
    empty ? "is-empty" : "",
    hidden ? "is-hidden" : "",
    dropping ? "is-dropping" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Hidden, and not being edited: nothing drawn at all.
  if (hidden && !editing) return null;

  return (
    <div
      ref={zone}
      className={zoneClass}
      data-band={where}
      data-hint={where === "header" ? "Double-click to add a header" : "Double-click to add a footer"}
      style={{ height, [where === "header" ? "top" : "bottom"]: 0, width: paper.width }}
      onDoubleClick={(e) => {
        if (editing) return;
        e.stopPropagation();
        onStartEditing();
      }}
      onPointerDown={(e) => {
        if (!editing || e.target !== e.currentTarget) return;
        e.stopPropagation();
        onSelect(null);
      }}
      onDragOver={(e) => {
        if (!editing || !e.dataTransfer.types.includes(BAND_ITEM_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const raw = e.dataTransfer.getData(BAND_ITEM_MIME);
        if (!editing || !raw || !zone.current) return;
        e.preventDefault();
        let what: NewItem;
        try {
          what = JSON.parse(raw) as NewItem;
        } catch {
          return;
        }
        const r = zone.current.getBoundingClientRect();
        const added = addItem(band, what, { x: e.clientX - r.left - 8, y: e.clientY - r.top - 8 }, bounds);
        onBand(where, added.band);
        onSelect({ where, id: added.id });
      }}
    >
      {(band?.items ?? []).map((item) => {
        const isSelected = editing && selected?.where === where && selected.id === item.id;
        const isTyping = editing && typing === item.id;
        return (
          <div
            key={item.id}
            className={`band-item kind-${item.kind} ${item.kind === "line" && item.vertical ? "is-vertical" : ""} ${
              isSelected ? "is-selected" : ""
            }`}
            data-item={item.id}
            style={itemStyle(item)}
            onPointerDown={(e) => {
              if (!editing || isTyping) return;
              const snapshot = band as PageBand;
              onSelect({ where, id: item.id });
              startDrag(e, (dx, dy) => moveItem(snapshot, item.id, dx, dy, bounds));
            }}
            onDoubleClick={(e) => {
              if (!editing) return;
              e.stopPropagation();
              if (item.kind === "text" || (item.kind === "field" && TYPED.has(item.field))) {
                setTyping(item.id);
              }
            }}
          >
            {isTyping ? (
              <InlineInput
                initial={item.kind === "text" ? item.text : item.kind === "field" ? rawValue(item.field, fields) : ""}
                label={item.kind === "field" ? fieldInfo(item.field).label : "Text"}
                onDone={(value) => {
                  setTyping(null);
                  if (value === null) return;
                  if (item.kind === "text") onBand(where, changeItem(band as PageBand, item.id, { text: value }));
                  else if (item.kind === "field") onValue(item.field, value);
                }}
              />
            ) : (
              <ItemContent item={item} fields={fields} editing={editing} />
            )}
            {isSelected && !isTyping && item.kind !== "line" ? (
              <span
                className="band-resize"
                title="drag to resize"
                onPointerDown={(e) => {
                  const snapshot = band as PageBand;
                  startDrag(e, (dx, dy) => resizeItem(snapshot, item.id, dx, dy, bounds));
                }}
              />
            ) : null}
            {isSelected && !isTyping && item.kind === "line" ? (
              <span
                className="band-resize"
                title="drag to lengthen"
                onPointerDown={(e) => {
                  const snapshot = band as PageBand;
                  startDrag(e, (dx, dy) =>
                    resizeItem(snapshot, item.id, item.vertical ? 0 : dx, item.vertical ? dy : 0, bounds),
                  );
                }}
              />
            ) : null}
          </div>
        );
      })}

      {editing ? (
        <span
          className="band-edge"
          title={where === "header" ? "drag to make the header taller or shorter" : "drag to make the footer taller or shorter"}
          onPointerDown={(e) =>
            startDrag(e, (_dx, dy) => resizeBand(band, height, where === "header" ? dy : -dy, paper.height))
          }
        />
      ) : null}
      {editing ? <span className="band-name">{where === "header" ? "Header" : "Footer"}</span> : null}
    </div>
  );
}

/** A typed field's value as stored, not as filled — the title included. */
function rawValue(field: FieldName, fields: PageFields): string {
  return field === "title" ? fields.title : (fields.titleBlock[field as keyof typeof fields.titleBlock] ?? "");
}

function itemStyle(item: BandItem): React.CSSProperties {
  const s = item.style ?? {};
  const isLine = item.kind === "line";
  return {
    left: item.x,
    // A line's box is widened around it so it can be grabbed; the stroke sits
    // exactly at the stored position.
    top: isLine && !item.vertical ? item.y - 3 : item.y,
    width: isLine && item.vertical ? 7 : item.width,
    height: isLine && !item.vertical ? 7 : item.height,
    ...(isLine && item.vertical ? { marginLeft: -3 } : {}),
    ...(s.fontSize ? { fontSize: s.fontSize } : {}),
    ...(s.bold ? { fontWeight: 700 } : {}),
    ...(s.italic ? { fontStyle: "italic" } : {}),
    ...(s.color ? { color: s.color, borderColor: s.color } : {}),
    // Items stack caption over value, so across the item is the cross axis.
    ...(s.align ? { textAlign: s.align, alignItems: ACROSS[s.align] } : {}),
  };
}

const ACROSS = { left: "flex-start", center: "center", right: "flex-end" } as const;

function ItemContent({
  item,
  fields,
  editing,
}: {
  item: BandItem;
  fields: PageFields;
  editing: boolean;
}): JSX.Element | null {
  switch (item.kind) {
    case "text":
      return <span className="band-text">{fillBandText(item.text, fields)}</span>;
    case "field": {
      const value = fieldValue(item.field, fields);
      const label = fieldInfo(item.field).label;
      return (
        <>
          {item.caption ? <span className="band-caption">{label}</span> : null}
          {value ? (
            <span className="band-value">{value}</span>
          ) : editing ? (
            // Where a value will go, shown only while editing: an empty field
            // prints nothing rather than its own name.
            <span className="band-value is-placeholder">{label}</span>
          ) : null}
        </>
      );
    }
    case "image":
      return <img src={item.src} alt={item.alt ?? ""} draggable={false} />;
    default:
      return null;
  }
}

/** Typing a field's value or a text item's words, in place. */
function InlineInput({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (value: string | null) => void;
}): JSX.Element {
  const done = useRef(false);
  const finish = (value: string | null): void => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      className="band-input"
      aria-label={label}
      defaultValue={initial}
      placeholder={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
