export type { BookingAdapter, BookingInput, NormalizeResult, ServiceInput } from './types'
export { manualAdapter, emptyManualForm, formFromBooking, type ManualBookingForm } from './manual'
export {
  countDays,
  createTabularAdapter,
  PLATE_CHECK_NOTE,
  TEMPLATE_SHEET,
  guessMapping,
  mappingProblems,
  parseCsv,
  readTable,
  TARGET_FIELDS,
  type ColumnMapping,
  type Table,
  type TargetField,
} from './tabular'
