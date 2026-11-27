import { type ExifTool, ExifToolTask } from 'exiftool-vendored'

export interface RawResult {
  stdout: string
  /** ExifTool's stderr lines (warnings and per-file errors). */
  messages: string[]
}

/** An ExifTool command with exactly the given arguments; stderr is returned, not thrown. */
class RawTask extends ExifToolTask<RawResult> {
  protected parse(input: string, error?: Error): RawResult {
    if (error) throw error
    return { stdout: input, messages: [...this.errors, ...this.warnings] }
  }
}

export function runRaw(et: ExifTool, args: string[]): Promise<RawResult> {
  return et.enqueueTask(() => new RawTask(args), false)
}
