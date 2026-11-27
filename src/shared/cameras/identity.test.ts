import { describe, expect, it } from 'vitest'
import { cameraIdentity } from './identity'

const grIv = {
  Make: 'RICOH IMAGING COMPANY, LTD.',
  Model: 'RICOH GR IV',
  Software: 'RICOH GR IV Ver. 1.11',
}

describe('cameraIdentity', () => {
  it('keys two GR IV bodies by their maker-note serial into two cameras', () => {
    // GR IV DNGs have no EXIF serial; ExifTool reports [Pentax] SerialNumber / InternalSerialNumber.
    const a = cameraIdentity({ ...grIv, SerialNumber: '0012345', InternalSerialNumber: 3000001 })
    const b = cameraIdentity({ ...grIv, SerialNumber: '0029999', InternalSerialNumber: 3100000 })
    expect(a.key).toBe('serial:RICOH IMAGING COMPANY, LTD.|0012345')
    expect(b.key).toBe('serial:RICOH IMAGING COMPANY, LTD.|0029999')
    expect(a.key).not.toBe(b.key)
    expect(a.defaultName).toBe('RICOH GR IV (…2345)')
  })

  it('uses the X-T5 ExifIFD serial', () => {
    const id = cameraIdentity({
      Make: 'FUJIFILM',
      Model: 'X-T5',
      SerialNumber: '3A000042',
      InternalSerialNumber: 'FF02B7285521     593536383831230203F84310113C65',
    })
    expect(id).toMatchObject({
      key: 'serial:FUJIFILM|3A000042',
      serial: '3A000042',
      defaultName: 'X-T5 (…0042)',
    })
  })

  it('keys the Sony maker-note byte-string serial, ignoring its spaces for display', () => {
    const id = cameraIdentity({
      Make: 'SONY',
      Model: 'ILCE-7M3',
      InternalSerialNumber: '110 255 0 0 170 9',
    })
    expect(id).toMatchObject({
      key: 'serial:SONY|110 255 0 0 170 9',
      defaultName: 'ILCE-7M3 (…1709)',
    })
  })

  it('falls back through the serial tags in order', () => {
    expect(
      cameraIdentity({ Make: 'Canon', Model: 'EOS', SerialNumber: '  ', BodySerialNumber: 'B1' })
        .serial,
    ).toBe('B1')
    expect(cameraIdentity({ Make: 'Canon', Model: 'EOS', CameraSerialNumber: 12345 }).serial).toBe(
      '12345',
    )
  })

  it('falls back to a model key without any serial', () => {
    const id = cameraIdentity({
      Make: 'Apple',
      Model: 'iPhone 15',
      LensModel: 'back camera',
      Software: '18.1',
    })
    expect(id).toMatchObject({
      key: 'model:Apple|iPhone 15|back camera|18.1',
      serial: null,
      defaultName: 'iPhone 15',
    })
    expect(cameraIdentity({ Make: 'Apple', Model: 'iPhone 15', Software: '18.2' }).key).not.toBe(
      id.key,
    )
  })

  it('groups files without camera tags as unknown', () => {
    expect(cameraIdentity({})).toMatchObject({ key: 'unknown', defaultName: 'Unknown camera' })
  })
})
