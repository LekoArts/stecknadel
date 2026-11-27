# DESIGN.md

Rules for how Stecknadel's UI looks, reads and behaves. Each rule comes from a correction by the user.

## Surfaces

- **All scrollbars use the global theme styles in `src/renderer/src/assets/main.css`; components never override them.**
  Why (inferred): OS scrollbars look out of place in the app.
  <!-- 2026-11-27: "style all scrollbars" -->

## Spacing & layout

- **Fixed-height cards and tiles are sized for their longest possible content, with at least 8 px padding on every side.**
  Why (inferred): text touching a border looks broken.
  <!-- 2026-11-27: "on these cards the dates go right up to the edge. it seems they need better spacing" -->

## Interaction

- **Never use native `<select>`, checkbox, radio or date/time/number inputs; use the components in `src/renderer/src/components/ui/`.**
  Why (inferred): native controls clash with the app's look.
  <!-- 2026-11-27: time selectors and checkboxes "still look partly like native Chrome controls" -->
- **Any list or grid with a selection clears it on a click in its empty area and on Escape.**
  Why: the user expects to be able to get back to "nothing selected".
  <!-- 2026-11-27: "once i selected an image I have no way of deselecting it. I'd expect that if i click inside the area where the images are shown (but not on an image) i deselect" -->

## Copy

- **Button and menu-item labels never end in "…", even when they open a dialog or menu.**
  Why: "that's weird."
  <!-- 2026-11-27: "Do not add ... to buttons. that's weird." -->
- **Button labels are a verb plus what it acts on ("Add zone change", "Open GPX file"), never a state or event ("Clock changed").**
  Why (inferred): a state name doesn't say what clicking does.
  <!-- 2026-11-27: "'Clock changed' is also a bad button name" -->
- **Button labels fit without truncating at the narrowest panel width; detail goes into the form the button opens.**
  Why (inferred): a cut-off label hides the action.
  <!-- 2026-11-27: "Add time change at…" was too long and truncated awkwardly -->
