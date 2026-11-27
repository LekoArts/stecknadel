import { availableParallelism } from 'node:os'
import { ExifTool } from 'exiftool-vendored'

/**
 * The single ExifTool process pool used by main. Ended on `before-quit`. Geotag and metadata
 * reads scale linearly with processes, and the library default (a quarter of the CPUs, spawned
 * 1.5 s apart) leaves 3–4-core machines on one process.
 */
export const exiftool = new ExifTool({
  taskTimeoutMillis: 120_000,
  maxProcs: Math.min(8, Math.max(2, availableParallelism() - 1)),
  minDelayBetweenSpawnMillis: 0,
})
