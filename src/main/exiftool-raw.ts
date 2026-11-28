import { type ExifTool, ExifToolTask } from 'exiftool-vendored'

export interface RawResult {
  stdout: string
  /** ExifTool's stderr lines (warnings and per-file errors). */
  messages: string[]
}

/** An ExifTool command with exactly the given arguments. */
class RawTask extends ExifToolTask<RawResult> {
  constructor(
    args: string[],
    private readonly lenient: boolean,
  ) {
    super(args)
  }

  protected parse(input: string, error?: Error): RawResult {
    if (error && !this.lenient) throw error
    return { stdout: input, messages: [...this.errors, ...this.warnings] }
  }
}

/** Runs the command; an `Error:` line on stderr rejects. */
export function runRaw(et: ExifTool, args: string[]): Promise<RawResult> {
  return et.enqueueTask(() => new RawTask(args, false), false)
}

/**
 * Runs a batch over many files where one file's error must not hide the others: errors come
 * back in `messages` (`Error: … - <file>`), only a dead process rejects.
 */
export function runBatch(et: ExifTool, args: string[]): Promise<RawResult> {
  return et.enqueueTask(() => new RawTask(args, true), false)
}
