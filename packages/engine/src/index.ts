export { Rational } from "./rational.js";
export {
  BASE_DIMENSIONS,
  DIM,
  Dimension,
  type BaseDimension,
} from "./dimension.js";
export { Quantity, UnitMismatchError } from "./quantity.js";
export {
  AMBIGUITY_HINTS,
  allUnits,
  lookupUnit,
  M_PER_INCH,
  N_PER_LBF,
  STANDARD_GRAVITY,
  type Unit,
} from "./units/registry.js";
export {
  parseUnit,
  quantityFrom,
  UnitParseError,
  valueIn,
  type ParsedUnit,
} from "./units/parse.js";
export { assertNever, CalcError, type ErrorCode, type Span } from "./errors.js";
export type * from "./ast.js";
export { tokenize, type Token, type TokenKind } from "./lexer.js";
export { parseExpression, parseStatement } from "./parser.js";
export {
  BUILTINS,
  evaluateExpr,
  evaluateStatement,
  getValue,
  setValue,
  valueBinding,
  type Binding,
  type UserFunction,
  type BuiltinFunction,
  type Environment,
  type StatementResult,
} from "./eval.js";
export {
  apiAuthorship,
  humanAuthorship,
  type Authorship,
  type MathRegion,
  type Position,
  type Region,
  type RegionId,
  type Size,
  type RegionResult,
  type PageBreakRegion,
  type TextRegion,
} from "./document/region.js";
export {
  bandOf,
  DEFAULT_BAND_HEIGHT,
  evaluationOrder,
  orderedIds,
  type OrderOptions,
} from "./document/order.js";
export {
  buildGraph,
  collectReferences,
  transitiveDependents,
  type Graph,
  type RegionAnalysis,
} from "./document/graph.js";
export {
  Worksheet,
  type RecomputeStats,
  type SymbolInfo,
} from "./document/worksheet.js";
export {
  DEFAULT_MARGINS,
  DEFAULT_PAGE,
  pageBox,
  PAGE_SIZES,
  type Margins,
  emptySheet,
  nextRegionId,
  parseSheet,
  SCHEMA_VERSION,
  serializeSheet,
  SheetFormatError,
  type ChangeEntry,
  type PageSetup,
  type Sheet,
} from "./document/sheet.js";
export {
  formatResult,
  formatResultParts,
  parseProjection,
  project,
  roundTrips,
  type ParsedProjection,
  type ProjectionEntry,
  type ProjectionOptions,
  type ResultParts,
} from "./document/projection.js";
export {
  hasUnitSettings,
  preferredUnit,
  QUANTITIES,
  sheetUnitTable,
  SYSTEM_UNITS,
  unitFitsQuantity,
  type QuantityKey,
  type SheetUnits,
  type UnitSystem,
} from "./units/prefer.js";
export {
  DEFAULT_SIZE,
  FONT_STACKS,
  TEXT_FONTS,
  type SheetTextStyle,
  type TextFont,
} from "./document/settings.js";
export { MatrixValue } from "./matrix.js";
export {
  asScalar,
  isMatrix,
  isScalar,
  requireMatrix,
  requireScalar,
  type Value,
} from "./value.js";
export { formatMatrix } from "./document/projection.js";
export {
  applyFormatPatch,
  formatNumber,
  NOTATIONS,
  resolveFormat,
  type Notation,
  type NumberFormat,
  type NumberFormatPatch,
} from "./document/format.js";
export { displayUnitOf, setDisplayUnit } from "./document/source.js";
export { unitsForDimension } from "./units/registry.js";
export { displayUnitsFor, type DisplayUnit } from "./units/display.js";
export type { TitleBlock } from "./document/sheet.js";
export {
  contentBox,
  documentY,
  offsetForPage,
  paginate,
  placePoint,
  pointAt,
  type BreakStop,
  type Layout,
  type Placement,
  type TableFragment,
  type TableMetrics,
} from "./document/layout.js";
export {
  evaluateTable,
  isBlankTable,
  isValidColumnName,
  tableProvides,
} from "./document/table.js";
export {
  MIGRATIONS,
  SheetVersionError,
  migrateRaw,
  type Migration,
} from "./document/migrate.js";
export { PAGE_BREAK_LINE, tableLines } from "./document/projection.js";
export {
  latexToSource,
  sourceToLatex,
  statementToLatex,
} from "./latex.js";
export {
  applyStyleToRange,
  normalize as normalizeRuns,
  plainText,
  replaceRange,
  renderedText,
  resolveReferences,
  runsFromText,
  sliceRuns,
  textReads,
  styleOfRange,
  textLength,
  type TextRun,
} from "./document/text.js";
export {
  EMPTY_BAND,
  FIELDS,
  TITLE_BLOCK_KEYS,
  fieldInfo,
  fieldValue,
  fillBandText,
  isEmptyBand,
  isFieldName,
  nextItemId,
  readBand,
  type BandBox,
  type BandField,
  type BandImage,
  type BandItem,
  type BandItemStyle,
  type BandLine,
  type BandText,
  type FieldInfo,
  type FieldName,
  type PageBand,
  type PageFields,
} from "./document/bands.js";
export { bandHeight, contentMargins, isSheetNumber } from "./document/sheet.js";
export type {
  ImageRegion,
  PlotSeries,
  PlotRegion,
  RegionStyle,
  StylePatch,
  TableColumn,
  TableRegion,
  TextAlign,
} from "./document/region.js";
export {
  buildPlot,
  isBlankPlot,
  plotReads,
  type PlotAxis,
  type PlotModel,
  type PlotPoint,
  type PlotTick,
  type PlotTrace,
} from "./document/plot.js";
export { renderNamePlain, splitName, type NameParts } from "./notation.js";

// --- document API ---------------------------------------------
export { ApiError, type ApiErrorCode } from "./api/errors.js";
export {
  applyPatch,
  type PatchContext,
  type PatchOperation,
  type PatchResult,
} from "./api/patch.js";
export {
  checkUnit,
  evaluate,
  exportSheet,
  getRegion,
  getSheet,
  listRegions,
  listSymbols as listSymbolReports,
  setInputs,
  trace as traceRegion,
  type EvaluateOptions,
  type EvaluateReport,
  type ExportFormat,
  type RegionReport,
  type SheetReport,
  type SymbolReport,
  type ValueReport,
} from "./api/operations.js";
export { compareVersions, isNewerVersion } from "./version.js";
export { formatValueParts, readableUnit, unitFits, writtenUnitOf } from "./document/valueUnits.js";
