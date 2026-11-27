import { ExifTool } from 'exiftool-vendored'

/** The single ExifTool process pool used by main. Ended on `before-quit`. */
export const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 })
