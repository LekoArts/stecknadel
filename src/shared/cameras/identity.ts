export interface CameraTags {
  Make?: unknown
  Model?: unknown
  LensModel?: unknown
  Software?: unknown
  SerialNumber?: unknown
  InternalSerialNumber?: unknown
  BodySerialNumber?: unknown
  CameraSerialNumber?: unknown
}

export interface CameraIdentity {
  key: string
  make: string | null
  model: string | null
  serial: string | null
  defaultName: string
}

const SERIAL_TAGS = [
  'SerialNumber',
  'InternalSerialNumber',
  'BodySerialNumber',
  'CameraSerialNumber',
] as const

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * Identifies the camera body that took a photo: by serial number (including maker-note serials)
 * when there is one, else by Make + Model + LensModel + Software. Photos whose file
 * carries no camera information at all are grouped as "Unknown camera".
 */
export function cameraIdentity(tags: CameraTags): CameraIdentity {
  const make = text(tags.Make)
  const model = text(tags.Model)
  let serial: string | null = null
  for (const tag of SERIAL_TAGS) {
    serial = text(tags[tag])
    if (serial) break
  }

  if (serial) {
    const label = model ?? make ?? 'Camera'
    return {
      key: `serial:${make ?? ''}|${serial}`,
      make,
      model,
      serial,
      defaultName: `${label} (…${serial.replace(/\s+/g, '').slice(-4)})`,
    }
  }

  const lens = text(tags.LensModel)
  const software = text(tags.Software)
  if (!make && !model && !lens && !software) {
    return { key: 'unknown', make, model, serial: null, defaultName: 'Unknown camera' }
  }
  return {
    key: `model:${make ?? ''}|${model ?? ''}|${lens ?? ''}|${software ?? ''}`,
    make,
    model,
    serial: null,
    defaultName: model ?? make ?? 'Unknown camera',
  }
}
