/**
 * A picture on the sheet.
 *
 * Sketches, details, a screenshot of a model — the things a calc sheet carries
 * that are not arithmetic. The image is embedded in the document as a `data:`
 * URI, so a `.jc` stays one file that survives being emailed.
 *
 * A remote URL is deliberately not accepted: a sheet that fetches its own
 * illustration depends on a network it may not have when it is printed and a
 * server that may not exist when it is checked.
 */

import { useCallback, useRef, useState } from "react";

export interface ImageRegionBodyProps {
  readonly src: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly onChange: (src: string, alt?: string) => void;
}

/**
 * Above this, an embedded picture starts to make the document unwieldy to
 * open, diff and email. A sibling folder for large images is the plan;
 * until that exists, saying so is better than quietly bloating a file.
 */
const WARN_BYTES = 2 * 1024 * 1024;

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

export function ImageRegionBody({
  src,
  alt,
  width,
  height,
  onChange,
}: ImageRegionBodyProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const take = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setNote(`${file.name} is not an image`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        setNote(
          url.length > WARN_BYTES
            ? "This picture is large; the sheet file will be too."
            : null,
        );
        onChange(url, file.name);
      };
      reader.onerror = () => setNote(`could not read ${file.name}`);
      reader.readAsDataURL(file);
    },
    [onChange],
  );

  return (
    <div
      className="image-region"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        // The sheet behind this also takes dropped pictures, and would make a
        // second region out of the one meant to replace this picture.
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) take(file);
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          style={{
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
          }}
        />
      ) : (
        <button
          type="button"
          className="image-empty"
          style={{ width: width ?? 220, height: height ?? 140 }}
          onClick={() => fileRef.current?.click()}
        >
          drop a picture here, or click to choose
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) take(file);
          // Cleared so choosing the same file twice fires again.
          e.target.value = "";
        }}
      />

      {src ? (
        <div className="image-controls">
          <button onClick={() => fileRef.current?.click()}>replace</button>
        </div>
      ) : null}

      {note ? <p className="image-note">{note}</p> : null}
    </div>
  );
}
