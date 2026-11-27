# Stecknadel

Stecknadel puts the right GPS coordinates into travel photos. It takes the location history your phone already recorded and works out where each photo was taken. (Stecknadel is German for a pin.)

**This version does not write coordinates into your photos yet.** It shows you where every photo will go and lets you fix the ones that land in the wrong place.

## What you can do today

- Open a folder of photos and see them all in one place.
- Load a location track from a GPX file or from your Dawarich server.
- Check the time settings of every camera you used.
- See each photo on a map, placed by ExifTool from the track and the camera's clock.
- Fix a misplaced photo by finding its clock offset, by placing it on the map, or by copying another photo's position.
- Filter and sort photos to find the ones that still need attention.

## What you need

- **Your photos.** JPEG, HEIC, HEIF, CR3, NEF, NRW, ARW, SR2, RAF and DNG files.
- **A location track.** Either a GPX file exported from your phone or another app, or a Dawarich server with an API key. Dawarich is a self-hosted app that records where you have been; see [dawarich.app](https://dawarich.app).
- **The time zone each camera was set to.** Stecknadel suggests these from the track, and you can correct them.

## Install and run

There is no download yet. To run Stecknadel, build it from source.

You need Node.js 22 or newer, pnpm 11, and macOS or Windows.

```sh
pnpm install
pnpm dev
```

`pnpm dev` opens the app. Changes to the code reload it.

`pnpm build` compiles the app without starting it. `pnpm package:mac` makes a macOS disk image on a Mac. `pnpm package:win` makes Windows installers; run it on Windows for a clean result.

## Three things to understand first

Stecknadel works with three pieces of information.

1. **Your photos.** Each file records when it was taken, and the camera that took it. Most files record no location.
2. **Your track.** A track is a long list of points, each with a time, a latitude and a longitude. Your phone records one every few seconds or minutes while you travel.
3. **Your camera's clock.** To find a photo on the track, Stecknadel needs the exact UTC time of the photo. A camera stores local time and sometimes a time zone. If the camera's clock was wrong, the photo lands in the wrong place.

UTC is the world time standard. Stecknadel converts every photo's capture time to UTC before it looks for a matching track point.

Every position comes from ExifTool. Stecknadel does not calculate positions itself.

## Your first session

1. Open the app. The map shows a short introduction.
2. Click **Open folder** in the top left and choose a folder of photos. Stecknadel searches the folder and its subfolders, then shows the photos in the grid.
3. In the **Track** section at the bottom of the left sidebar, click **Open GPX file** and choose your track. If you use Dawarich, click **Dawarich** instead and enter the server address and an API key.
4. Look at the cameras in the left sidebar. Each camera shows the time zone Stecknadel believes it used, for example "America/Los_Angeles + 1 change". Click a camera to check or correct its settings.
5. Wait a moment. The map fills with coloured pins and the grid marks each photo with a status dot.
6. Click a photo to see it in the metadata panel on the right and to see its pin on the map.
7. Read the legend at the bottom left of the map. It counts the photos that matched, the ones that need attention, and the ones that already have a GPS position.
8. Find a photo that needs attention. Use the section below to fix it.

## Photo statuses

Every photo gets one status. The status appears in the photo grid, in the list view and on the map legend.

| Status                    | What it means                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Matched                   | The photo's time falls between two track points that are close together in time and place.                                                |
| Placed at stay location   | The photo's time falls in a long stop where the track barely moved, so the exact point is unknown.                                        |
| Placed by hand            | You clicked the map to choose the position.                                                                                               |
| Already has GPS           | The file already records a position. Stecknadel keeps it unless you turn on overwriting in Settings.                                      |
| Before the track          | The photo was taken before the first track point.                                                                                         |
| After the track           | The photo was taken after the last track point.                                                                                           |
| In a track gap            | The track has no points near the photo's time, and the two points around it are far apart.                                                |
| Outside the fetched range | The track covers only part of your trip. Fetch a wider range from Dawarich.                                                               |
| No capture time           | The file records no date and time, so no position can be found.                                                                           |
| Excluded                  | Stecknadel leaves this file alone. A common reason is two RAW files in one folder that share a name and would share one XMP sidecar file. |

## Fix a photo that landed in the wrong place

Select the photo first. Its actions appear on the map.

### Find the clock offset

Use this when the position looks roughly plausible but wrong, usually because the camera's clock or time zone was off.

1. Click **Find offset**.
2. Zoom in on the map and click the place where the photo was really taken.
3. Stecknadel compares that place with your track and lists the clock corrections that would move the photo there. Each suggestion names a time zone or a drift and shows how far the photo would move.
4. Click **Apply** on the suggestion that fits. The photo moves to its new place and the other photos from that camera move with it.

The suggestions only appear when the place you click is near the track. If the photo has no capture time, this action is not available.

### Place a photo by hand

Use this for photos that no clock correction can place, such as a photo taken during a flight.

1. Click **Place on map**.
2. Click the map where the photo was taken.

### Copy another photo's position

Use this when several photos were taken at the same place.

1. Select the photo that already sits in the right place and click **Copy location**.
2. Click the pin of the photo you want to move.

## Camera time settings

Click a camera in the left sidebar to open its time settings.

- **Time zone.** Choose the zone the camera's clock was set to. Stecknadel suggests zones from your track and lists the zones your trip touched first.
- **Fixed UTC offset.** If you know the offset but not the zone, choose a fixed offset such as UTC+02:00 instead.
- **Zone changes.** If you changed the camera's zone during the trip, add a second time zone and give the time of the first photo taken in the new zone. The sidebar then reads "America/Los_Angeles + 1 change".
- **Clock drift.** A camera clock often runs a little fast or slow. Enter the drift in seconds, and choose **Fast** or **Slow**. The offset finder fills this in for you.
- **Saved offsets in photos.** Some cameras record the UTC offset in the file. Turn this on to use that value instead of a zone. When every photo from a camera has one, the camera shows "Saved in photos" and the zone controls are hidden. If a saved offset disagrees with your setting, the photo is marked with a warning.
- **Copy from another camera.** If two camera bodies were set up the same way, click **Copy from camera** and choose the other camera. The zones and zone changes are copied, and the camera's own drift is kept.

Stecknadel marks a camera's settings as coming from your track, from you, or from the computer's time zone. Check the ones that come from the computer before you trust the map.

## The track

- **GPX file.** Click **Open GPX file**. Stecknadel reads track points and waypoints, ignores routes, and reports points it had to skip.
- **Dawarich.** Click **Dawarich**, enter your server address and an API key, then choose a start and end time in UTC. Stecknadel fetches the points page by page and reports progress. The key is stored encrypted by your operating system and is never shown again after you save it.
- **Fetch a wider range.** When photos fall outside the track's time span, a bar above the photos says so. Click **Fetch wider range** to fetch a longer range from Dawarich; the time fields are already filled in.

A long stay is treated as one place. When the track stays within a short distance for a long time, Stecknadel fills the gap with points at the same coordinates, so photos taken during a lunch stop are not treated as missing.

A flight is left as a gap. When the distance between two points is large, Stecknadel does not invent a position, and photos from that time need to be placed by hand.

## Find photos quickly

**The camera sidebar** lists every camera it found, with a photo count and its time settings. Hover over a camera name and click the pencil to rename it. Renamed cameras are remembered.

**The photos toolbar** above the grid lets you:

- Switch between the grid and the list view.
- Filter by camera. The choice follows the camera you pick in the sidebar, and the camera picker in the toolbar hides while the sidebar is open.
- Filter by status group: **Needs attention**, **Placed**, or **Already has GPS**, each with a count. A photo that needs attention is one without a position, or one with a time warning.

**The list view** shows a thumbnail, file name, camera, captured time, UTC time and status for every photo. Click a column heading to sort, and click it again to reverse the order. The camera column only appears when you view all cameras at once, because a single camera needs no column.

**The metadata panel** on the right shows every tag ExifTool can read from the selected photo, with a filter box and sticky group headings.

## Panels and keyboard

Drag the edge between two panels to resize them. When you drag a panel below its smallest usable size it snaps shut, and the next time you open it, it returns to the size you had.

| Action                                    | How                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Show or hide the cameras                  | Click the cameras button on the map toolbar, or press Cmd+1 (Ctrl+1 on Windows) |
| Show or hide the photos                   | Click the photos button, or press Cmd+2                                         |
| Show or hide the metadata                 | Click the metadata button, or press Cmd+3                                       |
| Show only the map, or restore your panels | Click the map-only button, or press Cmd+0                                       |
| Reset the map zoom                        | Press Cmd+Shift+0                                                               |

Stecknadel remembers which panels are open and how wide they are the next time you start it.

## Settings

Click the gear in the cameras sidebar to change these settings.

| Setting                                        | What it does                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Matching: interpolate between points up to     | How far apart in time two track points may be for Stecknadel to place a photo between them. Default: 30 minutes.               |
| Matching: use the nearest point up to          | How far in time a photo may sit outside the track and still take the position of the nearest track point. Default: 30 minutes. |
| Stationary gaps: distance and length           | How still and how long a stop must be before Stecknadel treats it as one place. Defaults: 250 metres and 24 hours.             |
| Writing: overwrite GPS                         | Whether a photo that already has a position should be moved. Off by default.                                                   |
| Writing: offset time, RAW target, backups      | Options for the writing step. Nothing is written in this version.                                                              |
| Map: OpenFreeMap, style address, local PMTiles | Where the map comes from. OpenFreeMap needs an internet connection. A local PMTiles file keeps the map data on your computer.  |

## What is saved on your computer

Stecknadel keeps its own files in the application data folder: `~/Library/Application Support/Stecknadel` on macOS and `%APPDATA%\Stecknadel` on Windows.

| File            | Contents                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `cameras.json`  | The names you gave your cameras.                                                                       |
| `settings.json` | The settings above, and your map choice.                                                               |
| `secrets.bin`   | Your Dawarich API key, encrypted by the operating system.                                              |
| `thumbs/`       | Small JPEG copies of your photos, so the grid scrolls quickly. You can delete this folder at any time. |

Camera time settings are kept for the current session only. A new trip starts again with track-based suggestions.

## Your privacy

- Your photos stay on your computer. Stecknadel reads them and writes small thumbnails into its own folder; it never uploads them.
- Stecknadel only contacts the Dawarich server you enter and the map servers you choose. It sends nothing else.
- The API key is stored with your operating system's keychain and is never sent to the app window.
- A plain HTTP Dawarich address is only accepted for a server on your own machine or local network.

## If something looks wrong

| What you see                                                      | What to try                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The map shows no track and every photo needs attention            | Load a track. Without a track there is nothing to match against.                                            |
| Every photo from one camera landed in the wrong part of the world | That camera's time zone is wrong. Open the camera and pick the right zone, or use **Find offset**.          |
| Photos from the middle of a trip have no position                 | The track may be incomplete, or the photos were taken during a flight or a long stop. Use **Place on map**. |
| A photo shows "Outside the fetched range"                         | Fetch a wider range from Dawarich.                                                                          |
| A photo shows "No capture time"                                   | The file has no date. Place it by hand.                                                                     |
| The grid shows no thumbnails                                      | Some HEIC files have no preview that Stecknadel can extract. The pin, status and metadata still work.       |

## Current limits

- Nothing is written into your photos yet. The map and the metadata panel show what a write would do.
- HEIC thumbnails may stay blank in the grid. The photos still work everywhere else.
- Very large folders take a while on first open. A folder of 5,000 photos loads in about 15 to 40 seconds depending on the machine, and working out the positions takes about 30 seconds more.

## Try it with sample data

The repository can build a made-up trip for you: a few days of photos with realistic camera settings, a GPX track, and cases for each status.

```sh
pnpm make-demo
```

The command writes the trip to `test/fixtures/demo` and prints the folder to open, along with its track and photo count. The trip includes an example for every photo status. It downloads the freely licensed sample photos it needs on the first run; later runs reuse them.

## Development

Stecknadel is an Electron app. The window uses React, TypeScript, Tailwind and shadcn/ui. The main process runs Node and calls ExifTool for all photo work. The map uses MapLibre.

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `pnpm dev`           | Start the app with live reload.                    |
| `pnpm lint`          | Check formatting and lint rules.                   |
| `pnpm typecheck`     | Check TypeScript types.                            |
| `pnpm test`          | Run the unit tests.                                |
| `pnpm test:native`   | Run the tests that call the real ExifTool binary.  |
| `pnpm test:e2e`      | Run the end-to-end tests against the packaged app. |
| `pnpm fixtures`      | Download the pinned test photos.                   |
| `pnpm make-fixtures` | Generate test JPEGs.                               |

## License

[MIT](LICENSE)
