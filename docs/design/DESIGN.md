---
name: Lingan Darkroom
colors:
  surface: '#fef9f0'
  surface-dim: '#ded9d1'
  surface-bright: '#fef9f0'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f3ea'
  surface-container: '#f2ede4'
  surface-container-high: '#ece8df'
  surface-container-highest: '#e7e2d9'
  on-surface: '#1d1c16'
  on-surface-variant: '#5a413b'
  inverse-surface: '#32302a'
  inverse-on-surface: '#f5f0e7'
  outline: '#8e706a'
  outline-variant: '#e3beb7'
  surface-tint: '#b42810'
  primary: '#a51c05'
  on-primary: '#ffffff'
  primary-container: '#c8361d'
  on-primary-container: '#ffeae6'
  inverse-primary: '#ffb4a5'
  secondary: '#615e5b'
  on-secondary: '#ffffff'
  secondary-container: '#e8e1dd'
  on-secondary-container: '#676461'
  tertiary: '#57534f'
  on-tertiary: '#ffffff'
  tertiary-container: '#706b67'
  on-tertiary-container: '#f4ede8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad3'
  primary-fixed-dim: '#ffb4a5'
  on-primary-fixed: '#3f0400'
  on-primary-fixed-variant: '#8f1200'
  secondary-fixed: '#e8e1dd'
  secondary-fixed-dim: '#cbc5c2'
  on-secondary-fixed: '#1d1b19'
  on-secondary-fixed-variant: '#494643'
  tertiary-fixed: '#e8e1dc'
  tertiary-fixed-dim: '#ccc5c1'
  on-tertiary-fixed: '#1e1b18'
  on-tertiary-fixed-variant: '#4a4643'
  background: '#fef9f0'
  on-background: '#1d1c16'
  surface-variant: '#e7e2d9'
typography:
  headline-xl:
    fontFamily: Noto Serif
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Noto Serif
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Noto Serif
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 36px
  headline-lg-mobile:
    fontFamily: Noto Serif
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Noto Serif
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Source Sans 3
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Source Sans 3
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Source Sans 3
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.08em
  label-editorial:
    fontFamily: Noto Serif
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.15em
spacing:
  gutter: 0.75rem
  margin: 1rem
  gutter-desktop: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style
The brand personality bridges the contemplative ritual of analog film processing with the rigorous discipline of archival art publication. Designed for photographers, writers, curators, and visual artists, this design system evokes sensory patience, archival permanence, and deliberate curation. The interface treats captured ideas not as ephemeral feeds, but as contact sheets and negatives emerging under red safelight.

The design movement combines **Editorial Modernism** with **Tactile Industrial Archival**:
- **Tactile Paper & Emulsion**: Surface textures reference archival rag paper, photographic gel emulsions, and contact print glass.
- **Instrumental Precision**: Heavy reliance on frame indexing, edge codes, technical stamps, and optical measurement marks.
- **Zero Decorative Fluff**: Excludes generic soft gradients, bubbly radiuses, and floating synthetic dropshadows in favor of razor-sharp hairline dividers, precise optical kerning, and stark tonal plates.

## Colors
The palette is rooted in classical chemical development: warm base stock, carbon-black typography, and monochromatic silver haloid tones punctuated by darkroom safelight red.

- **Primary (`#C8361D`) — Safelight Amber-Red**: Used strictly for active selection states, critical focal points, status indicators, recording pulses, and primary action triggers. Never overused as a background wash.
- **Secondary (`#141210`) — Deep Ink Black**: Represents dense silver density. Used for foundational borders, structural dividers, prominent display titles, and tactile inverted key moments.
- **Tertiary (`#2A2724`) — Darkroom Charcoal**: Represents the unexposed emulsion and film border masks. Used for negative preview envelopes, metadata badge fills, and deep-toned inset containers.
- **Neutral (`#F4EFE6`) — Archival Paper**: The default canvas base. Provides high legibility with an organic warmth that prevents clinical eye fatigue.
- **Supporting Surface Tone (`#E8E1D5`) — Aged Contact Paper**: Used for card containers, structured cell fields, and metadata callouts.
- **Hairline Rule Tone (`#D5CDC0`) — Plate Divider**: A low-contrast structural tone for secondary cell grids and framing lines.

## Typography
The system maintains a tripartite typographic hierarchy:

1. **Serif (Noto Serif / Songti fallback)**: Serves literary headlines, collection narratives, chapter headers, and longform Chinese reading notes. It anchors the interface with classic publication dignity.
2. **Technical Monospace (JetBrains Mono)**: Handles all metadata, frame indexing, date/time timestamps, camera settings (f-stop, shutter, ISO), archive taxonomy markers, and structural labels (`EXP 24-A`, `№ 042`).
3. **Clean Grotesque (Source Sans 3)**: Delivers rapid scanning, dense note-taking, system alerts, and primary form inputs with neutral clarity.

All Latin metadata letters paired with Chinese text must maintain aligned vertical centers and uppercase-dominant styles for technical tokens.

## Layout & Spacing
The layout follows an archival sheet grid inspired by 120mm and 35mm contact sheets.

- **Grid Model**: A 4-column layout on mobile devices (`<640px`) shifting to a 12-column layout on desktop and tablet workspaces.
- **Rhythm & Rules**: Structural elements align directly to 1px hairline horizontal and vertical dividers. Gutter gaps represent physical sheet separation rather than floating voids.
- **Edge Framing**: The master viewport incorporates outer bounding margins that mimic photographic paper margins (minimum 16px on mobile), enclosed with an outer 1px structural framing line where appropriate.
- **Breakpoints**:
  - `Mobile` (`320px - 639px`): Compact contact rows, single-column detail sheets, vertical continuous film rolls.
  - `Tablet` (`640px - 1023px`): 2-up contact sheets with side-panel metadata inspectors.
  - `Desktop` (`1024px+`): Multitrack light table layout with synchronized metadata and archival index trees.

## Elevation & Depth
This design system avoids blurry drop shadows, soft lighting projections, and ambient ambient elevation tiers. Depth is expressed purely through **plate layering, tonal contrast, and optical framing**:

- **Ground Plate**: Base canvas rendered in `#F4EFE6` Archival Paper.
- **Card Plate**: Recessed or mounted contact cards rendered in `#E8E1D5` with an explicit `1px solid #141210` or `1px solid #D5CDC0` hairline border.
- **Negative Envelope (Inverted Tier)**: Darkroom film modules and negative preview plates sit on `#2A2724` Darkroom Charcoal, creating extreme visual focus for captured image assets.
- **Registration Crosshairs**: Visual overlap is punctuated using precise structural glyphs (`+`, `┌ ┐`, `└ ┘`) in corners instead of elevation shadows.
- **Active Focus**: Indicated by a hairline shift to Safelight Amber-Red (`#C8361D`) or a solid inverted fill of Deep Ink Black (`#141210`).

## Shapes
Geometry is strictly **sharp and unrounded (0px radius)**.

- **Clipped & Guillotined Corners**: Surfaces recall industrial paper trimmers, plate holders, slide mounts, and continuous film strips. Rounded pills and soft card corners are forbidden.
- **Negative Perforations**: Film strip components use rectangular 3:2 perforations etched directly into dark margins.
- **Notches and Stamps**: Corner cutouts, ticket notches, and registration slits provide decorative variety while adhering strictly to 90-degree orthogonal geometry.

## Components

### Buttons
- **Primary Action (Safelight Button)**: Solid `#C8361D` background with `#F4EFE6` text. 0px border radius, 1px solid `#141210` outline. Text set in uppercase `label-code-lg`. On press: shifts to solid `#141210` with `#F4EFE6` text.
- **Secondary (Archival Plate)**: `#E8E1D5` background with 1px hairline `#141210` border and `#141210` text.
- **Tertiary (Frame Link)**: Borderless text button in JetBrains Mono enclosed in bracket marks: `[ + ADD NOTE ]` or `[ VIEW NEGATIVE ]`.

### Chips & Metadata Tags
- **Style**: Monospaced tags (`label-code-sm`) set in compact frames.
- **Variants**:
  - *Film Stock Tag*: `#2A2724` background with `#F4EFE6` text (`ISO 400`, `PORTRA 160`).
  - *Taxonomy Tag*: Transparent background with `1px solid #D5CDC0` border and `#141210` text (`#URBAN`, `#SHADOW`).
  - *Selected State*: Inverted `#141210` background with `#F4EFE6` text and amber-red dot indicator.

### Cards & Contact Sheet Frames
- **Contact Card**: Solid `#E8E1D5` surface bordered by 1px `#141210`. The top margin features an index band featuring an exposure code (`EXP 18A`) and frame timestamp.
- **Negative Card**: Solid `#2A2724` container with sprocket perforation marks along top and bottom edges. Housing images in high-contrast optical white borders (`#F4EFE6`).

### Input Fields
- **Editorial Text Field**: Flat bottom hairline rule `1px solid #141210` on archival paper. No container box. Floating label set in `label-code-sm`.
- **Archival Box Input**: Boxed input with `#E8E1D5` background, `1px solid #D5CDC0` hairline, focusing to `1px solid #C8361D`.

### Checkboxes & Selection Controls
- **Checkbox**: Precise square `14px x 14px` with `1px solid #141210`. Checked state renders as a solid cross mark (`✕`) or filled center square in `#C8361D`.
- **Radio Button**: Square inside a square (`16px x 16px` outer, `8px x 8px` centered solid square when selected), strictly avoiding circular round geometry.

### Specialized Components
- **Index Stamp (№ Stamp)**: Red or black bordered stamp placed in upper right of longform entries (`№ 00294-B`).
- **Exposure Ruler**: Horizontal ruler indicator rendered with variable-height hairline ticks for organizing timeline archives.
- **Film Roll Header**: Fixed sticky header designed as an analog film canister canister margin with frame counter readout (`FRAME 24 / 36`).