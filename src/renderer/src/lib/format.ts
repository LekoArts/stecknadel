/** `2026:11:14 12:05:39` (+ offset) → `2026-11-14 12:05:39 −07:00`. */
export function formatCaptureTime(captureTime: string, offset: string | null): string {
  const [date, time] = captureTime.split(' ')
  const text = `${date.replaceAll(':', '-')} ${time}`
  return offset ? `${text} ${offset.replace('-', '−')}` : text
}
