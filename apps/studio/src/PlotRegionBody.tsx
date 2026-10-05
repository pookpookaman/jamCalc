/**
 * Drawing a plot.
 *
 * Only the drawing. Axis ranges, ticks and point coordinates come from the
 * engine's `PlotModel` (`document/plot.ts`), for the same reason pagination
 * does: the screen and the print path must not be able to disagree about where
 * something sits.
 *
 * SVG rather than canvas — it prints at the printer's resolution instead of
 * the screen's, and a calc sheet exists to be printed.
 */

import { useCallback } from "react";
import type { PlotModel, PlotSeries, RegionStyle } from "@jamcalc/engine";

export interface PlotRegionBodyProps {
  readonly model?: PlotModel;
  readonly series: readonly PlotSeries[];
  readonly width: number;
  readonly height: number;
  readonly style?: RegionStyle;
  readonly problemText?: string;
  readonly onChange: (series: readonly PlotSeries[]) => void;
}

/** Room for tick labels and axis titles, in px. */
const PAD = { left: 52, right: 12, top: 10, bottom: 34 };

export function PlotRegionBody({
  model,
  series,
  width,
  height,
  style,
  problemText,
  onChange,
}: PlotRegionBodyProps) {
  const setSeries = useCallback(
    (index: number, patch: Partial<PlotSeries>) => {
      onChange(series.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    },
    [series, onChange],
  );

  const addSeries = useCallback(() => {
    onChange([...series, { x: "", y: "" }]);
  }, [series, onChange]);

  const removeSeries = useCallback(() => {
    onChange(series.slice(0, -1));
  }, [series, onChange]);

  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(30, height - PAD.top - PAD.bottom);

  const sx = (v: number): number =>
    model ? PAD.left + ((v - model.x.min) / (model.x.max - model.x.min)) * plotW : PAD.left;
  const sy = (v: number): number =>
    model
      ? PAD.top + plotH - ((v - model.y.min) / (model.y.max - model.y.min)) * plotH
      : PAD.top;

  return (
    <div className="plot-region" style={style?.color ? { color: style.color } : undefined}>
      {model ? (
        <svg width={width} height={height} className="plot-svg" role="img">
          {/* Grid first, so data draws over it. */}
          {model.x.ticks.map((t) => (
            <line
              key={`gx${t.value}`}
              className="plot-grid"
              x1={sx(t.value)}
              x2={sx(t.value)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
          ))}
          {model.y.ticks.map((t) => (
            <line
              key={`gy${t.value}`}
              className="plot-grid"
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={sy(t.value)}
              y2={sy(t.value)}
            />
          ))}

          <rect
            className="plot-frame"
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
          />

          {model.x.ticks.map((t) => (
            <text
              key={`tx${t.value}`}
              className="plot-tick"
              x={sx(t.value)}
              y={PAD.top + plotH + 13}
              textAnchor="middle"
            >
              {t.label}
            </text>
          ))}
          {model.y.ticks.map((t) => (
            <text
              key={`ty${t.value}`}
              className="plot-tick"
              x={PAD.left - 6}
              y={sy(t.value) + 3}
              textAnchor="end"
            >
              {t.label}
            </text>
          ))}

          <text
            className="plot-axis-label"
            x={PAD.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
          >
            {model.x.label ?? ""}
            {model.x.unit ? ` (${model.x.unit})` : ""}
          </text>
          <text
            className="plot-axis-label"
            transform={`translate(11, ${PAD.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {model.y.label ?? ""}
            {model.y.unit ? ` (${model.y.unit})` : ""}
          </text>

          {model.traces.map((trace, i) => (
            <g key={i}>
              <polyline
                className="plot-line"
                stroke={trace.color}
                points={trace.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
              />
              {trace.points.map((p, k) => (
                <circle
                  key={k}
                  className="plot-point"
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={2}
                  fill={trace.color}
                />
              ))}
            </g>
          ))}

          {model.traces.length > 1
            ? model.traces.map((trace, i) => (
                <g key={`k${i}`}>
                  <line
                    className="plot-line"
                    stroke={trace.color}
                    x1={PAD.left + 8}
                    x2={PAD.left + 24}
                    y1={PAD.top + 12 + i * 14}
                    y2={PAD.top + 12 + i * 14}
                  />
                  <text
                    className="plot-tick"
                    x={PAD.left + 28}
                    y={PAD.top + 15 + i * 14}
                  >
                    {trace.label}
                  </text>
                </g>
              ))
            : null}
        </svg>
      ) : (
        <div className="plot-empty" style={{ width, height }}>
          {problemText || "name an x and a y to draw"}
        </div>
      )}

      <div className="plot-controls">
        {series.map((s, i) => (
          <span key={i} className="plot-series">
            <input
              value={s.y}
              placeholder="y"
              spellCheck={false}
              onChange={(e) => setSeries(i, { y: e.target.value })}
              title="the name of the values up the side"
            />
            <span className="vs">vs</span>
            <input
              value={s.x}
              placeholder="x"
              spellCheck={false}
              onChange={(e) => setSeries(i, { x: e.target.value })}
              title="the name of the values along the bottom"
            />
          </span>
        ))}
        <button onClick={addSeries} title="add a trace">+ series</button>
        {series.length > 0 ? (
          <button onClick={removeSeries} title="remove the last trace">−</button>
        ) : null}
      </div>

      {model && problemText ? <p className="plot-problem">{problemText}</p> : null}
    </div>
  );
}
