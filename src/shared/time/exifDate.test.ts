import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import {
  formatGeotime,
  formatOffset,
  parseExifDateTime,
  parseOffset,
  secondsToInstant,
  wallAsUtcSeconds,
} from './exifDate'

describe('parseExifDateTime', () => {
  it.each([
    ['2026:11:07 13:28:21', null, '2026-11-07T13:28:21'],
    ['2026:11:07 13:28:21', '25', '2026-11-07T13:28:21.25'],
    ['2026:11:07 13:28:21', 7, '2026-11-07T13:28:21.7'],
    ['2026:11:07 13:28:21.123', null, '2026-11-07T13:28:21.123'],
    ['2026:11:07 13:28:21.123', '4', '2026-11-07T13:28:21.4'],
    ['2026:11:07 13:28:21-07:00', null, '2026-11-07T13:28:21'],
    [' 2026:11:07 13:28:21 ', '  ', '2026-11-07T13:28:21'],
  ])('%j + %j → %s', (value, sub, expected) => {
    expect(parseExifDateTime(value, sub)?.toString()).toBe(expected)
  })

  it.each([null, '', '0000:00:00 00:00:00', '2026:13:01 00:00:00', '2026-11-07 13:28:21', 'abc'])(
    'rejects %j',
    (value) => {
      expect(parseExifDateTime(value)).toBeNull()
    },
  )
})

describe('offsets', () => {
  it.each([
    ['-07:00', -25200],
    ['+05:45', 20700],
    ['+0100', 3600],
    ['+00:00', 0],
    ['+14:00', 50400],
  ])('%s → %i s', (text, seconds) => {
    expect(parseOffset(text)).toBe(seconds)
    expect(formatOffset(seconds)).toBe(
      text.length === 5 ? `${text.slice(0, 3)}:${text.slice(3)}` : text,
    )
  })

  it.each([null, '', 'Z', '7:00', '+07:60', '+19:00', '-07'])('rejects %j', (text) => {
    expect(parseOffset(text)).toBeNull()
  })
})

describe('formatGeotime', () => {
  it('matches ExifTool’s accepted format exactly', () => {
    expect(formatGeotime(Temporal.Instant.from('2026-11-06T22:34:00Z'))).toBe(
      '2026:11:06 22:34:00Z',
    )
    expect(formatGeotime(Temporal.Instant.from('2026-11-06T22:34:00.250Z'))).toBe(
      '2026:11:06 22:34:00.25Z',
    )
    expect(formatGeotime(Temporal.Instant.from('0999-01-02T03:04:05Z'))).toBe(
      '0999:01:02 03:04:05Z',
    )
    expect(formatGeotime(secondsToInstant(1.5))).toBe('1970:01:01 00:00:01.5Z')
  })

  it('wall times read as UTC', () => {
    expect(
      wallAsUtcSeconds(parseExifDateTime('1970:01:01 00:01:00.5') as Temporal.PlainDateTime),
    ).toBe(60.5)
  })
})
