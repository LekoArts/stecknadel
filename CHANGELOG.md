# stecknadel

## 0.1.3

### Patch Changes

- On macOS, Stecknadel now asks for local network access the first time it connects to a Dawarich server at home. Before, macOS could mix it up with other Electron apps and block the connection without asking. ([`fbcc73a`](https://github.com/LekoArts/stecknadel/commit/fbcc73a3fa089e993473944c89782bb05d8cf35d))

## 0.1.2

### Patch Changes

- On macOS, a Dawarich server on your local network can be reached again. macOS now asks to allow Stecknadel on the local network, and if access is off, the error says where to turn it on. ([`625e94f`](https://github.com/LekoArts/stecknadel/commit/625e94f7705dfb55e4134c9bd55ee630ab69d745))

## 0.1.1

### Patch Changes

- macOS no longer says the downloaded app "is damaged". The app is now signed ad hoc, so macOS shows its usual warning for apps from unidentified developers, which you can get past in System Settings → Privacy & Security. ([`9383fe9`](https://github.com/LekoArts/stecknadel/commit/9383fe953858ded0a95918b658676035af2fa318))

## 0.1.0

### Minor Changes

- Initial release: geotag photos from Dawarich tracks or GPX files. Load a folder of JPEG, HEIC and RAW photos, check each camera's time zone and clock, see every photo on a map exactly where ExifTool will put it, fix the ones that need it, then write the positions and get a report. Writes can be undone. ([`317d1f6`](https://github.com/LekoArts/stecknadel/commit/317d1f674db8d8f7bd35cb121344f48d11cf6ae4))
