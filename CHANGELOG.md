# stecknadel

## 0.1.1

### Patch Changes

- macOS no longer says the downloaded app "is damaged". The app is now signed ad hoc, so macOS shows its usual warning for apps from unidentified developers, which you can get past in System Settings → Privacy & Security. ([`9383fe9`](https://github.com/LekoArts/stecknadel/commit/9383fe953858ded0a95918b658676035af2fa318))

## 0.1.0

### Minor Changes

- Initial release: geotag photos from Dawarich tracks or GPX files. Load a folder of JPEG, HEIC and RAW photos, check each camera's time zone and clock, see every photo on a map exactly where ExifTool will put it, fix the ones that need it, then write the positions and get a report. Writes can be undone. ([`317d1f6`](https://github.com/LekoArts/stecknadel/commit/317d1f674db8d8f7bd35cb121344f48d11cf6ae4))
