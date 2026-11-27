export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' stecknadel-thumb: data: blob: https:",
  "connect-src 'self' https: stecknadel-pmtiles:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
].join('; ')

/** The Vite dev server needs an inline React-refresh preamble and a websocket for HMR. */
export const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' stecknadel-thumb: data: blob: https:",
  "connect-src 'self' https: ws: stecknadel-pmtiles:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
].join('; ')
