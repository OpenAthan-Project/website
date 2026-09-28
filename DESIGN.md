---
name: OpenAthan
description: A welcoming community bulletin for an open-source Athan project.
colors:
  ink: '#202c3a'
  text: '#38434f'
  muted: '#526171'
  paper: '#ffffff'
  accent: '#355e83'
  accent-hover: '#254764'
  panel: '#eff3f7'
  line: '#d6dee6'
  field-border: '#7b8896'
  warning-bg: '#fff5e6'
  warning-text: '#805719'
  error-bg: '#fff0ec'
  error-text: '#8a3426'
  selection: '#dce8f4'
typography:
  display:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: 'clamp(2.4rem, 7vw, 4.55rem)'
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: '-0.025em'
  page-title:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '3.5rem'
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: '-0.025em'
  heading:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '1.8rem'
    fontWeight: 700
    lineHeight: 1.12
  subheading:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '1.35rem'
    fontWeight: 700
    lineHeight: 1.12
  body:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '20px'
    fontWeight: 400
    lineHeight: 1.45
  lede:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '20px'
    fontWeight: 700
    lineHeight: 1.45
  button:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '1.35rem'
    fontWeight: 700
    lineHeight: 1.35
  small:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.45
  wordmark:
    fontFamily: 'Mukta Malar, sans-serif'
    fontSize: '2.9rem'
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: '-0.035em'
rounded:
  control: '4px'
spacing:
  compact: '8px'
  small: '12px'
  body: '16px'
  inset: '20px'
  section: '24px'
  wide: '28px'
  heading: '32px'
  column: '36px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.paper}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '10px 30px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
    textColor: '{colors.paper}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.accent}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '10px 30px'
  button-secondary-hover:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.accent-hover}'
  button-disabled:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.muted}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '10px 30px'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '10px 14px'
    width: '100%'
  supporting-panel:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    padding: '24px'
  notice:
    backgroundColor: '{colors.warning-bg}'
    textColor: '{colors.warning-text}'
    rounded: '{rounded.control}'
    padding: '16px 20px'
  feedback:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: '14px 18px'
  feedback-error:
    backgroundColor: '{colors.error-bg}'
    textColor: '{colors.error-text}'
  feedback-uncertain:
    backgroundColor: '{colors.warning-bg}'
    textColor: '{colors.warning-text}'
---

# Design System: OpenAthan

## Overview

**Creative North Star: "The Community Bulletin"**

OpenAthan is a welcoming, practical open-source project. Its website uses generous humanist type, a white canvas and quiet rules to make project information, documentation and setup tasks easy to find. The text-only wordmark gives the project a clear identity without a separate symbol or decorative imagery.

Charcoal carries the reading hierarchy; slate blue identifies links and actions. Pale blue panels group supporting information, while amber calls attention to availability and uncertain outcomes. Pages remain flat and direct, with visible contribution paths and space for useful explanations.

**Key Characteristics:**

- A text-only OpenAthan wordmark and one humanist sans-serif family.
- Charcoal reading text, slate-blue actions and a white canvas.
- Fine rules and pale supporting panels instead of shadows.
- Explicit page, section and task headings with narrow-screen layouts.

This system describes the public website. Its implementation sources are [the shared stylesheet](site/styles.css), [page layout](site/layouts/Layout.astro), [homepage](site/pages/index.astro), [documentation index](site/pages/docs/index.astro), [USB entry page](site/pages/install/index.astro) and [installer presentation](installer/ui.ts). Product boundaries live in [PRODUCT.md](PRODUCT.md).

## Colors

The palette combines restrained slate blue with neutral charcoal and warm, purposeful notices. The frontmatter values are normative; names below explain their use. The sidecar’s generated tonal strips are preview aids, not additional application colors.

### Primary

- **Slate blue** (`accent`) identifies links, primary actions, checkbox accents, progress and keyboard focus. **Deep slate** (`accent-hover`) marks interactive hover states.
- **Pale blue** (`panel`) groups help, supporting content, neutral feedback and disabled controls.

### Secondary

- **Warm amber** (`warning-bg` and `warning-text`) identifies development availability, caution and uncertain outcomes. Notice paragraphs use ordinary reading text.
- **Muted red** (`error-bg` and `error-text`) identifies error feedback. Always include an explanatory message; color alone does not explain a result.

### Neutral

- **Charcoal ink** (`ink`) anchors headings and the wordmark; **reading charcoal** (`text`) carries body copy; **muted slate** (`muted`) supports helper text.
- **White paper** (`paper`) is the canvas and control surface. **Quiet rule** (`line`) separates sections; **field outline** (`field-border`) identifies interactive field boundaries.
- **Blue selection** (`selection`) pairs with charcoal ink for selected text.

**The Contrast Rule.** Use the darker field outline for controls and the lighter rule for noninteractive separators.

Calculated contrast for the implemented solid color pairs is 10.08:1 for body text on white, 6.35:1 for muted text on white, 6.82:1 for slate-blue links on white and white text on primary buttons, 5.69:1 for muted text on pale panels, 5.90:1 for amber text on its notice fill, and 7.28:1 for error text on its fill. Field outlines against white are 3.62:1. These values describe the palette; they do not replace testing complete pages and interactive states.

## Typography

Display, body and controls use **Mukta Malar**, with `sans-serif` fallback. The regular and bold Latin WOFF2 subsets are self-hosted, total 28,632 bytes, and use `font-display: swap` with font synthesis disabled. Other scripts use the browser's sans-serif fallback. Visitors make no remote font requests. Preserve the [SIL Open Font License and font provenance](public/fonts/README.md).

Use regular (400) for reading and bold (700) for headings, labels and actions. The open, rounded letterforms carry the friendly character without a display serif. Device hostnames use `ui-monospace, monospace`; inline code uses the browser monospace default at 0.8em and wraps long values.

| Role                 | Application and responsive treatment                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display              | General page headings use the fluid display token. At 600px and below, general headings become 2.3rem. Documentation headings instead use 2.4rem. |
| Page title           | The USB page heading uses the fixed page-title token, becoming 2.4rem at 600px and below.                                                         |
| Heading / subheading | Base section headings use the heading and subheading tokens. Documentation section headings become 1.6rem at 600px and below.                     |
| Body / label         | Both follow the body size: 20px ordinarily and 18px at 600px and below. Labels are bold.                                                          |
| Lede                 | Documentation introductions use the lede token. The homepage introduction uses 1.65rem/1.25, becomes 1.5rem at 800px, then 1.25rem/1.3 at 600px.  |
| Button               | Ordinary actions follow the button token and become 1.15rem at 600px. The homepage primary action uses 1.6rem, becoming 1.25rem at 600px.         |
| Wordmark             | The wordmark follows its token, becoming 2.4rem at 800px and 2.2rem at 600px.                                                                     |
| Small                | Helper text, footer links and supporting installer details use the small token.                                                                   |

Rem dimensions follow the browser root size, ordinarily 16px. Paragraphs have 16px bottom spacing; headings use compact line height to keep short titles cohesive. Documentation reading width is capped at 76ch.

**The Wordmark Rule.** Render OpenAthan as text in the established bold sans-serif; do not add a separate brand symbol.

## Layout

The shared page container is centered and capped at 1120px, with 28px horizontal gutters. At 600px and below, gutters become 18px. The desktop header has a minimum height of 110px and places the wordmark opposite a horizontal navigation row. On narrow screens it wraps into wordmark and navigation rows; all links remain visible.

Spacing centers on the frontmatter scale, with 24px section padding, 16px paragraph spacing and 36px gaps between main and supporting columns. Homepage sections use rules to establish a compact reading rhythm. The footer uses a top rule and wraps its links as space narrows.

| Surface             | Wide layout                                                                     | At 800px and below                                                                          | At 600px and below                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage            | Main information and supporting panels use a 1.9:1 grid with a 24px column gap. | Grid ratio becomes 1.6:1 with a 20px gap and smaller section type.                          | Single column: features, hardware guidance, then contributions. Hardware guidance returns to white; contributions retain a pale panel. The primary action fills the width. |
| Documentation index | Reading column plus a 225px contents panel, separated by 36px.                  | Single reading column; the duplicate contents navigation is hidden. Section anchors remain. | Smaller headings and introductions; paired cable diagrams become one column.                                                                                               |
| USB choices         | Task choices plus a 320px help column, separated by 36px.                       | Help flows below the choices.                                                               | Shared narrow-screen gutters and control typography apply.                                                                                                                 |
| USB flow            | A single task panel capped at 880px; forms are capped at 760px.                 | Width follows the available container.                                                      | Actions wrap; fields remain full width and long addresses break safely.                                                                                                    |

Documentation articles use a single reading column capped at 76ch. There is no sticky header, floating navigation or animated layout transition. Reduced-motion preferences explicitly disable transitions and smooth scrolling.

## Elevation & Depth

The interface is flat. White and pale blue distinguish reading space from supporting content; fine borders and whitespace establish sections. No component shadow is defined. Notices use tonal emphasis without appearing as floating cards.

**The Flat Surface Rule.** Preserve hierarchy with type, spacing, rules and tonal panels; keep these components free of decorative shadows.

## Shapes

Supporting panels and documentation link rows use square edges. Buttons, inputs, notices, feedback and diagram labels share the subtle control radius. Interactive inputs have a 2px field outline; buttons and ordinary separators use 1px borders. Avoid turning the rectangular control language into pills.

Functional diagrams and notice/status SVGs explain connections and outcomes. They are separate from the text-only brand identity; decorative image assets are not part of this system.

## Components

### Buttons and links

Primary buttons use slate blue with white bold text; secondary buttons use white with a slate-blue outline and label. Both have a minimum height of 48px. Hover deepens the primary fill; the secondary fill becomes pale blue. Disabled buttons keep a pale fill, muted label, field-outline border and `not-allowed` cursor, including secondary variants. Do not simulate an unavailable action with a working link.

The homepage action is larger on desktop, with minimum dimensions of 266px by 60px. On narrow screens it returns to a 48px minimum height and fills the content width. Ordinary text links are underlined, with a 0.16em underline offset; their stroke grows from 1px to 2px on hover. Navigation uses an underline on hover and on the current page or section.

### Fields and feedback

Fields fill their form width, have a minimum height of 48px, and use the input token's padding. Labels precede inputs; helper text follows them. Checkboxes are 22px square and paired with wrapping text. Disabled fields use a pale fill.

Neutral, error and uncertain feedback share one spacing and shape pattern. The installer announces messages in a polite, atomic status region. Error and uncertain states include direct text explaining the outcome and next step. Uncertain outcomes retain their amber treatment and do not appear as success.

### Panels and documentation rows

Help and contribution panels use pale blue with 24px padding. The documentation contents panel uses 22px padding. Documentation destination rows are full-width links with an underlined bold title, body-color description, 20px bottom padding and a bottom rule. They are reading links, without raised card treatment.

### Page and task context

Each page has one visible h1. Documentation uses h2 sections and h3 subsections; its link-row titles remain link text rather than false section headings. Section anchors retain a 24px scroll margin.

The USB entry screen keeps the page heading as its visible title. A visually hidden h2 names the choices region and serves as a focus target. Inside a flow, a visible h2 identifies USB recovery or new installation and gives its preservation/setup context; the changing step title is an h3. Unsupported-browser guidance uses an h2 beneath the page title. Preserve these relationships when adding installer states.

After the initial render, installer navigation focuses the new step heading. The initial page load does not move focus. Focusable step headings have `tabindex="-1"`; keyboard-visible heading focus uses a 3px slate outline with a 5px offset. Other keyboard-focusable elements use a 3px outline with a 4px offset. The skip link becomes visible on focus and leads to the main content. Keep native links, buttons, labels and heading semantics.

## Do's and Don'ts

### Do

- Do use the text-only wordmark and the self-hosted regular/bold type family.
- Do give supporting content pale panels and primary reading content white space.
- Do preserve visible keyboard focus, explanatory feedback and responsive heading hierarchy.
- Do distinguish availability notices, errors and uncertain outcomes with words as well as color.
- Do keep functional connection diagrams close to the instructions they explain.

### Don't

- Don't add a symbol logo, decorative hero imagery or a competing display typeface.
- Don't replace field outlines with the low-contrast separator color.
- Don't add decorative shadows, pill controls or animated page transitions to these components.
- Don't hide the release gate or style an unavailable installer action as enabled.
- Don't use visual design or simulator behavior as evidence of physical installer qualification.
