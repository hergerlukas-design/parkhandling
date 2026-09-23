export type { BookingAdapter, BookingInput, NormalizeResult } from './types'
export { manualAdapter, emptyManualForm, type ManualBookingForm } from './manual'
export {
  createTabularAdapter,
  guessMapping,
  mappingProblems,
  parseCsv,
  readTable,
  TARGET_FIELDS,
  type ColumnMapping,
  type Table,
  type TargetField,
} from './tabular'
