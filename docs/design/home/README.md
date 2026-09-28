# Home screen design reference

Igal Tal Merom

These two files are the approved Home screen design for Revive Host
(desktop 1440 x 1024, phone 390 x 844). They were made in a design
canvas tool, so they are NOT runnable app code:

- Markup uses `{{holes}}` bound by a `renderVals()` method at the bottom
  of each file, `<sc-for>` for lists, and a `support.js` runtime that is
  not included. Read them as a precise visual spec.
- Everything that matters is inline: layout, sizes, colors, glass
  values, typography, icons (SVG paths), and sample data.

What to reuse directly:

- `buildScene(kind)` in the script: plain JavaScript that generates the
  landscape (sky gradients, mountains, lake, pines, stars) as SVG path
  data, plus the dusk and night palettes. Port it to TypeScript as the
  scene engine and add dawn and day palettes in the same shape.
- The glass recipe: `rgba(14, 20, 34, 0.42 to 0.55)` background,
  `1px solid rgba(255, 255, 255, 0.13)` border,
  `backdrop-filter: blur(22px) saturate(140%)`.
- Status colors: working `#5fd38d`, waiting `#ffa552`,
  review `#7fb8ff`, idle `rgba(242, 245, 250, 0.5)`.
- Project tile icons: single SVG path per project, color gradients per
  project.

Sample data in the files (project names, CPU numbers, uptime) is
placeholder. The real screen reads everything from the Host.
