# DESIGN.md

Rules for how Stecknadel's UI looks, reads and behaves. Each rule comes from a correction by the user.

Review UI work against the `ux-rules`, `emil-design-eng` and `craft-design-engineering` skills.
<!-- 2026-11-27: "use the ux-rules skill, the emil-eng- skill and the craft skill to review all of the UI" -->

`pnpm check:design` enforces the rules marked *(checked)*.

## Surfaces

- **All scrollbars use the global theme styles in `src/renderer/src/assets/main.css`; components never override them.**
  Why (inferred): OS scrollbars look out of place in the app.
  <!-- 2026-11-27: "you need to style all the scrollbars" -->
- **In long grouped lists (such as the metadata tags), the current group's header stays pinned at the top with a filled `bg-muted` background and top and bottom borders, so it stands out from the rows.**
  Why: the user liked the pinned header but couldn't see it clearly.
  <!-- 2026-11-27: "when you scroll in the tags i like the sticky header position of the section I'm on but it doesn't show clearly" -->

## Spacing & layout

- **Fixed-height cards and tiles are sized for their longest possible content, with at least 8 px padding on every side.**
  Why (inferred): text touching a border looks broken.
  <!-- 2026-11-27: "on these cards the dates go right up to the edge. it seems they need better spacing" -->

## Interaction

- **Never use native `<select>`, checkbox, radio or date/time/number inputs; use the components in `src/renderer/src/components/ui/`.** *(checked)*
  Why (inferred): native controls clash with the app's look.
  <!-- 2026-11-27: "the time select and checkboxes look a bit unstyled (they show their native chrome styling still in some areas)" -->
- **Any list or grid with a selection clears it on a click in its empty area and on Escape.**
  Why: the user expects to be able to get back to "nothing selected".
- **When a photo's metadata already holds a value the app would otherwise ask for (a time offset, GPS), show it as known and say where it came from ("Saved in photos: UTC−07:00"), and hide the control for it.**
  Why (inferred): asking for something the file already says makes the user doubt the app read it.
  <!-- 2026-11-27: "see the xt5 alreay has the correct offset? show that" -->
- **Read a value from the photos or the track before asking for it. Anything the app guessed is labelled as a guess and says what it was based on ("Guessed from this computer").**
  Why (inferred): a confident default that's wrong is worse than an honest guess.
  <!-- 2026-11-27: "why for the ricoh and fujifilm is not the "from the start" set correctly? … can we read that?" -->
- **Per-camera settings that take several steps to fill in (time zones and zone changes) offer "Copy from camera".**
  Why (inferred): cameras on one trip share zones, and re-entering them is tedious and error-prone.
  <!-- 2026-11-27: "i now filled out the two jumps for the ricoh, I'd like to easily copy that and paste that onto the fuji" -->
  <!-- 2026-11-27: "once i selected an image I have no way of deselecting it. I'd expect that if i click inside the area where the images are shown (but not on an image) i deselect" -->

## Copy

- **Button and menu-item labels never end in "…", even when they open a dialog or menu.** *(checked)* Progress text ("Fetching…") is not a label.
  Why: "that's weird."
  <!-- 2026-11-27: "Do not add ... to buttons. that's weird." -->
- **Button labels are a verb plus what it acts on ("Add zone change", "Open GPX file"), never a state or event ("Clock changed").**
  Why (inferred): a state name doesn't say what clicking does.
  <!-- 2026-11-27: "'Clock changed' is also a bad button name" -->
- **Button labels fit without truncating at the narrowest panel width; detail goes into the form the button opens.**
  Why (inferred): a cut-off label hides the action.
  <!-- 2026-11-27: "the "add time change at..." button text is too long and the ... is weird" -->
- **A control whose meaning isn't obvious from its label (time offsets, clock drift, matching limits) gets one short line saying what it changes. No other explanatory copy.**
  Why: the user found the offsets unexplained; the UI review removed every other hint as noise.
  <!-- 2026-11-27: "the offsets are not really explained" -->
