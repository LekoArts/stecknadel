import type { StecknadelApi } from '../shared/ipc'

declare global {
  interface Window {
    stecknadel: StecknadelApi
  }
}
