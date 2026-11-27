import type { LibrarySnapshot } from '@shared/library'
import type { Position, PreviewSnapshot } from '@shared/preview'
import type { CameraTimeSettings } from '@shared/time/cameraSettings'
import type { TrackSummary } from '@shared/track/types'
import { useEffect, useRef, useState } from 'react'
import { ipcErrorMessage } from './ipc-error'

const DEBOUNCE_MS = 400

export interface PreviewState {
  snapshot: PreviewSnapshot | null
  /** A run is pending or in flight. */
  running: boolean
  error: string | null
}

/**
 * Runs the ExifTool preview in main whenever settings, placements, photos or the track change,
 * debounced. Each run gets a new generation; main answers superseded runs with null, and only
 * the newest generation's result is kept here.
 */
export function usePreview(
  library: LibrarySnapshot | null,
  track: TrackSummary | null,
  cameras: Record<string, CameraTimeSettings>,
  manual: Record<string, Position>,
): PreviewState {
  const [state, setState] = useState<PreviewState>({ snapshot: null, running: false, error: null })
  const generation = useRef(0)

  useEffect(() => {
    if (!library || !track || track.count === 0) {
      generation.current += 1
      setState({ snapshot: null, running: false, error: null })
      return
    }
    setState((s) => ({ ...s, running: true }))
    const timer = setTimeout(() => {
      const gen = ++generation.current
      window.stecknadel.runPreview({ generation: gen, cameras, manual }).then(
        (snapshot) => {
          if (gen !== generation.current || !snapshot) return
          setState({ snapshot, running: false, error: null })
        },
        (error) => {
          if (gen !== generation.current) return
          setState((s) => ({ ...s, running: false, error: ipcErrorMessage(error) }))
        },
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [library, track, cameras, manual])

  return state
}
