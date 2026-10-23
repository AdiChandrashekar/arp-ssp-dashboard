# DESIGN.md

Scope: the ARP form study pages in `web/public/study/` (story, explore, FLN deep dive). The main dashboard in `web/src` keeps its own style.

**Catalogue version:** 1.0
**References:** The Pudding-like visual essay
**Preset:** none
**Medium:** website (scrolling data story plus two exploration pages)
**Audience and job:** programme team and officials reading how ARPs fill in observation forms, then exploring individual ARPs themselves.

## Resolved decisions

| Layer | Decision |
|---|---|
| Structure | 1240px max content width, 16px gutters; story = sticky graphic beside step cards (stacked under the graphic on phones); exploration pages = full-width sections separated by space, not rules |
| Typography | Bricolage Grotesque 700/800 for headlines, step titles and big numbers; Inter 400/500/600 for body, labels and data (tabular figures). Body 17px / 1.6. Paragraphs run the full container width unless they sit in a card |
| Colour | page cream `#FBF8F3`, card white `#FFFFFF`, sunk panel `#F3EEE6`, rule `#E4DDD1`, gridline `#ECE6DC`, ink `#1E1B2E`, secondary text `#4A4658`, muted `#6E6A7C`, highlighter `#FFD66B`. Styles: Uniform coral `#E8553F`, Mixed grey-violet `#8C8798`, Varied blue `#2E6FD8`, too-little-data `#CFCAD6` |
| Surface | flat; white cards on the cream page with a 1px rule and a soft 0 2px 0 rule-coloured bottom edge; no gradients |
| Shape | cards 18px, controls and chips 999px pills, tooltips 12px, bars 4px ends |
| Density | airy; 8px spacing base, sections 96px apart |
| Components | nav = pills (active pill filled ink); buttons/selects = white pills with a rule border; badges = pale highlighter pills; tables = white, sticky header on sunk panel |
| Icons | none |
| Charts | dots large (4–6px) with a white ring; style colours only for the three styles; everything else ink or grey; sequential = cream → coral → deep red; diverging = blue ← cream-grey → coral; gridlines `#ECE6DC`; annotations in ink with a white halo; every chart title states the finding |
| Imagery | none; the hero is a field of drifting style-coloured dots |
| Motion | expressive but purposeful: dots morph between layouts (1.1s cubic), highlighter sweep on key phrases as they enter, step cards rise in, counters roll up; all off under prefers-reduced-motion |

## Project rules

- Light mode only (`color-scheme: light`); no dark-mode overrides.
- Style colours encode recording style and nothing else. Subject, grade and comparison colours come from the separate sets in `common.js`.
- Text never sits in a style colour; values and labels stay ink or secondary.

## Token source

`web/public/study/common.css` (CSS variables) and the `PAL` object in `web/public/study/common.js` (chart colours).

## Change log

- 2026-10-23 — created from The Pudding-like visual essay; replaces the earlier dark theme.
