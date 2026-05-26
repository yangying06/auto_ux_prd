---
name: Forge Blueprint
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2b2a2a'
  surface-container-highest: '#353434'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c8c5ca'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#919095'
  outline-variant: '#47464a'
  surface-tint: '#c8c6c8'
  primary: '#c8c6c8'
  on-primary: '#313032'
  primary-container: '#09090b'
  on-primary-container: '#7a787b'
  inverse-primary: '#5f5e60'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#000c05'
  on-tertiary-container: '#008a5f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e1e4'
  primary-fixed-dim: '#c8c6c8'
  on-primary-fixed: '#1c1b1d'
  on-primary-fixed-variant: '#474649'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#141313'
  on-background: '#e5e2e1'
  surface-variant: '#353434'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is engineered for "GameUX PromptForge," a utility designed for technical users, narrative designers, and game developers. The personality is **high-tech, utilitarian, and precise**, evoking the feeling of a sophisticated integrated development environment (IDE) combined with a creative blueprint workshop.

The visual style is a hybrid of **Minimalism** and **Technical Glassmorphism**. It utilizes a deep, monochromatic base to reduce eye strain during long sessions, punctuated by vibrant functional accents that represent the flow of data and logic. The interface feels like a "digital workbench" where the primary focus is on the creation and refinement of game logic and dialogue prompts.

**Key visual drivers:**
- High density of information without visual clutter.
- Semantic color coding to indicate system status and AI confidence.
- Architectural depth through subtle glows and semi-transparent layering.

## Colors

This design system utilizes a "Void & Neon" palette. The background is anchored in **Zinc-950**, providing a deep canvas for high-contrast interactive elements.

- **Surface Primary:** Zinc-950 (#09090b) for the main application background.
- **Surface Secondary:** Zinc-900 (#18181b) for sidebars and navigation panels.
- **Accent Emerald:** Used exclusively for success states, completed tasks, and "ready-to-deploy" logic nodes.
- **Accent Red:** Reserved for warnings, missing assets, or broken prompt logic.
- **Accent Blue:** The primary interactive color, representing information flow and Retrieval-Augmented Generation (RAG) status.
- **Chat Semantics:** User messages are encased in a semi-transparent Deep Blue; AI responses use a solid Zinc-800 to denote stability and the system's "base" knowledge.

## Typography

The typography strategy prioritizes legibility and technical precision. **Inter** is the primary typeface for its neutral, highly readable qualities in complex UIs. For technical metadata, prompt tags, and code snippets, **JetBrains Mono** is introduced to provide a "geeky," developer-centric feel.

- **Headlines:** Use tight letter spacing and heavier weights to command attention against the dark background.
- **Labels:** Always set in JetBrains Mono, typically uppercase, to differentiate "System Data" from "User Content."
- **Mobile scaling:** For small screens, `display-lg` scales down to 32px to maintain hierarchy without horizontal overflow.

## Layout & Spacing

The system uses a **Fluid Grid** model with a hard-coded 8px baseline rhythm. The primary canvas utilizes a **Blueprint Grid pattern** (a 32px grid with 8px sub-divisions) to help users align nodes and prompt blocks.

- **Breakpoints:**
  - Mobile: < 768px (Single column, hidden sidebars)
  - Tablet: 768px - 1280px (Collapsible sidebars, fluid center)
  - Desktop: > 1280px (Fixed sidebars 280px, fluid canvas)
- **Margins:** Standard 24px internal padding for containers to allow the UI to breathe amidst dense data.

## Elevation & Depth

This design system avoids traditional physical shadows in favor of **Tonal Layering and Glows**. Depth is communicated through:

1.  **Z-Index Layering:** Surfaces "rise" by becoming lighter (Zinc-950 -> Zinc-900 -> Zinc-800).
2.  **Backdrop Blurs:** Overlays and modals use a 12px blur with a 60% opacity fill of the background color to maintain context.
3.  **Accent Glows:** Active elements (like the currently edited prompt) emit a subtle 8px outer glow using the primary Blue or Emerald color at 20% opacity.
4.  **Borders:** 1px solid borders serve as the primary separator. Dashed borders are used specifically for "Drop Zones" or "Empty States" to indicate a temporary or editable area.

## Shapes

The shape language is **Rounded**, using a consistent `0.5rem` (8px) base radius to soften the technical aesthetic. 

- **Containers & Cards:** Use `rounded-xl` (1.5rem / 24px) to create a clear distinction between the workspace background and interactive modules.
- **Buttons & Inputs:** Follow the base `rounded-md` (0.5rem) for a precise, "clickable" feel.
- **Chat Bubbles:** Utilize asymmetric rounding: 1.5rem on three corners and 0.25rem on the anchor corner to indicate the speaker.

## Components

- **Buttons:** 
  - *Primary:* Solid Blue background, white text, subtle glow on hover.
  - *Secondary:* Transparent background, 1px Zinc-700 border, shifts to Zinc-800 on hover.
  - *Ghost:* No border/background, used for utility icons in the canvas.
- **Prompt Nodes (Cards):** Use `rounded-xl`, Zinc-900 background, and a 1px border. If the node is "Active," the border color changes to Blue-500.
- **Input Fields:** Zinc-950 background with a 1px Zinc-800 border. On focus, the border glows Blue-500. Use JetBrains Mono for the text.
- **Status Chips:** Small, pill-shaped markers with low-opacity backgrounds and high-saturation text (e.g., Emerald-500/20 background with Emerald-500 text).
- **Chat Bubbles:**
  - *User:* Blue-900 at 50% opacity, right-aligned.
  - *AI:* Zinc-800 solid, left-aligned, accompanied by a small "Processing" pulse animation when generating.
- **Canvas Grid:** A CSS-generated repeating background of lines every 32px, colored at Zinc-900/50.