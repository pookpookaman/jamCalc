/**
 * The bar shown while a header or footer is being edited: what can be put in
 * (drag it onto the band, or click to add it to the header), and the
 * controls for whatever is selected.
 *
 * It takes the Format bar's place: while the bands are being edited the
 * sheet's regions are not, so the two never apply at once.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { FIELDS, type BandItem, type PageBand, type PageSetup } from "@jamcalc/engine";
import { removeItem, styleItem, changeItem, type NewItem } from "./bandEdit.js";
import { BAND_ITEM_MIME, type BandSelection, type Where } from "./Bands.js";
import { ColourRow } from "./ColourRow.js";
import { MenuButton } from "./MenuButton.js";
import {
  cleanName,
  defaultTemplateName,
  deleteTemplate,
  exportTemplate,
  listTemplates,
  readTemplate,
  saveTemplate,
  setDefaultTemplate,
  type Template,
} from "./templates.js";

export interface BandBarProps {
  readonly page: PageSetup;
  readonly selected: BandSelection | null;
  readonly onBand: (where: Where, band: PageBand | null, tag?: string) => void;
  readonly onSelect: (selection: BandSelection | null) => void;
  /** Adds to the header by clicking rather than dragging. */
  readonly onAdd: (what: NewItem) => void;
  readonly onDone: () => void;
  /** Replaces both bands with a template's, keeping the sheet's values. */
  readonly onApply: (template: Template) => void;
}

const SIZES = [7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
const ALIGNS = [
  { value: "left", label: "⯇", title: "align left" },
  { value: "center", label: "≡", title: "centre" },
  { value: "right", label: "⯈", title: "align right" },
] as const;

/** Makes a palette chip draggable onto a band. */
const chip = (what: NewItem) => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => {
    e.dataTransfer.setData(BAND_ITEM_MIME, JSON.stringify(what));
    e.dataTransfer.effectAllowed = "copy";
  },
});

export function BandBar({ page, selected, onBand, onSelect, onAdd, onDone, onApply }: BandBarProps): JSX.Element {
  const logoInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [chosenDefault, setChosenDefault] = useState<string | null>(() => defaultTemplateName());
  const reload = useCallback(() => {
    void listTemplates().then(setTemplates, () => setTemplates([]));
  }, []);
  useEffect(reload, [reload]);

  const current = (name: string): Template => ({
    name,
    ...(page.header ? { header: page.header } : {}),
    ...(page.footer ? { footer: page.footer } : {}),
  });
  const saveAs = async (): Promise<void> => {
    const name = cleanName(window.prompt("Save this header and footer as a template called:") ?? "");
    if (!name) return;
    if (
      templates.some((t) => t.name === name) &&
      !window.confirm(`There is already a template called ${name}. Replace it?`)
    ) {
      return;
    }
    try {
      await saveTemplate(current(name));
    } catch (e) {
      window.alert(`The template was not saved.\n\n${(e as Error).message}`);
    }
    reload();
  };
  const band = selected ? page[selected.where] : undefined;
  const item: BandItem | undefined = selected ? band?.items.find((i) => i.id === selected.id) : undefined;

  const set = (next: PageBand, tag?: string): void => {
    if (selected) onBand(selected.where, next, tag);
  };

  return (
    <div className="format band-bar">
      <span className="label">Header &amp; footer</span>

      <details className="band-fields">
        <summary title="drag a field onto the header or footer, or click to add it">Fields</summary>
        <div className="band-field-list">
          {FIELDS.map((f) => (
            <button
              key={f.name}
              className="band-chip"
              title={f.source === "sheet" ? "typed once per sheet" : "filled in automatically"}
              {...chip({ kind: "field", field: f.name })}
              onClick={() => onAdd({ kind: "field", field: f.name })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </details>
      <button className="band-chip" {...chip({ kind: "text" })} onClick={() => onAdd({ kind: "text" })}>
        Text
      </button>
      <button className="band-chip" {...chip({ kind: "line" })} onClick={() => onAdd({ kind: "line" })}>
        Line
      </button>
      <button className="band-chip" {...chip({ kind: "box" })} onClick={() => onAdd({ kind: "box" })}>
        Box
      </button>
      <button className="band-chip" onClick={() => logoInput.current?.click()}>
        Logo…
      </button>
      <input
        ref={logoInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void logoFromFile(file).then(
            (logo) => onAdd({ kind: "image", ...logo }),
            (err: Error) => window.alert(`That picture could not be used.\n\n${err.message}`),
          );
        }}
      />

      {item && selected ? (
        <span className="band-item-controls">
          <span className="sep" />
          {item.kind === "field" ? (
            <label className="check" title="show the field's name above its value">
              <input
                type="checkbox"
                checked={item.caption === true}
                onChange={(e) =>
                  set(changeItem(band as PageBand, item.id, { caption: e.target.checked } as Partial<BandItem>))
                }
              />
              caption
            </label>
          ) : null}
          {item.kind === "line" ? (
            <label className="check">
              <input
                type="checkbox"
                checked={item.vertical === true}
                onChange={(e) =>
                  set(
                    changeItem(band as PageBand, item.id, {
                      vertical: e.target.checked ? true : undefined,
                      width: e.target.checked ? 0 : Math.max(item.height, 40),
                      height: e.target.checked ? Math.max(item.width > 60 ? 40 : item.width, 16) : 0,
                    } as Partial<BandItem>),
                  )
                }
              />
              vertical
            </label>
          ) : null}
          {item.kind === "text" || item.kind === "field" ? (
            <>
              <select
                title="font size"
                value={item.style?.fontSize ?? 10}
                onChange={(e) => set(styleItem(band as PageBand, item.id, { fontSize: Number(e.target.value) }))}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </select>
              <button
                className={`toggle ${item.style?.bold ? "on" : ""}`}
                title="bold"
                onClick={() => set(styleItem(band as PageBand, item.id, { bold: item.style?.bold ? null : true }))}
              >
                <b>B</b>
              </button>
              <button
                className={`toggle ${item.style?.italic ? "on" : ""}`}
                title="italic"
                onClick={() => set(styleItem(band as PageBand, item.id, { italic: item.style?.italic ? null : true }))}
              >
                <i>I</i>
              </button>
              {ALIGNS.map((a) => (
                <button
                  key={a.value}
                  className={`toggle ${(item.style?.align ?? "left") === a.value ? "on" : ""}`}
                  title={a.title}
                  onClick={() =>
                    set(styleItem(band as PageBand, item.id, { align: a.value === "left" ? null : a.value }))
                  }
                >
                  {a.label}
                </button>
              ))}
            </>
          ) : null}
          {item.kind !== "image" ? (
            <ColourRow
              value={item.style?.color}
              onPick={(c) => set(styleItem(band as PageBand, item.id, { color: c }))}
            />
          ) : null}
          <button
            className="band-delete"
            title="remove (Delete)"
            onClick={() => {
              set(removeItem(band as PageBand, item.id));
              onSelect(null);
            }}
          >
            Remove
          </button>
        </span>
      ) : (
        <span className="muted band-hint">Drag fields onto the header or footer · double-click one to type its value</span>
      )}

      <MenuButton label="Templates" title="save this layout, or use a saved one">
        {(close) => (
          <>
            <button onClick={() => { close(); void saveAs(); }}>Save as template…</button>
            <span className="menu-rule" />
            {templates.length === 0 ? (
              <span className="menu-note">No templates yet</span>
            ) : (
              templates.map((t) => (
                <div className="menu-row template-row" key={t.name}>
                  <button
                    className="template-apply"
                    title="use this layout on this sheet; its values are kept"
                    onClick={() => {
                      close();
                      onApply(t);
                    }}
                  >
                    {t.name}
                  </button>
                  <button
                    className={`template-star ${chosenDefault === t.name ? "on" : ""}`}
                    title={chosenDefault === t.name ? "new sheets start with this (click to stop)" : "start every new sheet with this"}
                    aria-label={`${t.name}: default for new sheets`}
                    onClick={() => {
                      const next = chosenDefault === t.name ? null : t.name;
                      setDefaultTemplate(next);
                      setChosenDefault(next);
                    }}
                  >
                    {chosenDefault === t.name ? "\u2605" : "\u2606"}
                  </button>
                  <button
                    className="template-more"
                    title="save this template to a file"
                    aria-label={`${t.name}: export`}
                    onClick={() => exportTemplate(t)}
                  >
                    {"\u2913"}
                  </button>
                  <button
                    className="template-more"
                    title="delete this template"
                    aria-label={`${t.name}: delete`}
                    onClick={() => {
                      if (!window.confirm(`Delete the template ${t.name}?`)) return;
                      void deleteTemplate(t.name).then(() => {
                        setChosenDefault(defaultTemplateName());
                        reload();
                      });
                    }}
                  >
                    {"\u00d7"}
                  </button>
                </div>
              ))
            )}
            <span className="menu-rule" />
            <button onClick={() => { close(); importInput.current?.click(); }}>Import from a file…</button>
          </>
        )}
      </MenuButton>
      <input
        ref={importInput}
        type="file"
        accept=".jctemplate,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void file
            .text()
            .then(readTemplate)
            .then(saveTemplate)
            .then(reload, (err: Error) => window.alert(`That template could not be imported.\n\n${err.message}`));
        }}
      />

      <span className="band-bar-end">
        {(["header", "footer"] as const).map((where) => {
          const b = page[where];
          return (
            <label className="check" key={where} title={`hide the ${where} without deleting what is in it`}>
              <input
                type="checkbox"
                checked={b?.enabled !== false}
                onChange={(e) => {
                  const { enabled: _drop, ...rest } = b ?? { items: [] };
                  onBand(where, e.target.checked ? rest : { ...rest, enabled: false });
                }}
              />
              {where === "header" ? "Header" : "Footer"}
            </label>
          );
        })}
        <button className="band-done" onClick={onDone} title="back to the sheet (Esc)">
          Done
        </button>
      </span>
    </div>
  );
}

/** Largest a logo is kept at. A header logo does not need to be megabytes. */
const LOGO_MAX = { width: 600, height: 240 };
/** How big it is placed, before the user resizes it. */
const LOGO_PLACED = { width: 120, height: 48 };

/**
 * Reads a picture and redraws it no larger than it needs to be.
 *
 * Redrawing also turns an SVG into plain pixels, so nothing that could run
 * ends up stored in a sheet.
 */
async function logoFromFile(file: File): Promise<{ src: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 150;
    const scale = Math.min(1, LOGO_MAX.width / w, LOGO_MAX.height / h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser cannot redraw pictures");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const src =
      file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    const placed = Math.min(LOGO_PLACED.width / w, LOGO_PLACED.height / h);
    return { src, width: Math.round(w * placed), height: Math.round(h * placed) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
