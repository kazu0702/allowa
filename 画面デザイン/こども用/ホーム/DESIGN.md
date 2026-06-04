---
name: Incentive-Driven Growth System
colors:
  surface: '#fbf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae8e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#574235'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0f0'
  outline: '#8b7263'
  outline-variant: '#dfc1af'
  surface-tint: '#964900'
  primary: '#964900'
  on-primary: '#ffffff'
  primary-container: '#ff8000'
  on-primary-container: '#5e2b00'
  inverse-primary: '#ffb787'
  secondary: '#845400'
  on-secondary: '#ffffff'
  secondary-container: '#feb246'
  on-secondary-container: '#6f4600'
  tertiary: '#7b5800'
  on-tertiary: '#ffffff'
  tertiary-container: '#d29a00'
  on-tertiary-container: '#4c3600'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc7'
  primary-fixed-dim: '#ffb787'
  on-primary-fixed: '#311300'
  on-primary-fixed-variant: '#723600'
  secondary-fixed: '#ffddb6'
  secondary-fixed-dim: '#ffb95a'
  on-secondary-fixed: '#2a1800'
  on-secondary-fixed-variant: '#643f00'
  tertiary-fixed: '#ffdea4'
  tertiary-fixed-dim: '#ffbb00'
  on-tertiary-fixed: '#261900'
  on-tertiary-fixed-variant: '#5d4200'
  background: '#fbf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e1'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 32px
  xl: 48px
  container-padding-mobile: 20px
  container-padding-desktop: 40px
  gutter: 16px
---

## Brand & Style

The design system is built upon a "Sophisticated Warmth" philosophy, blending the structured efficiency of a financial tool with the approachable encouragement of a mentor. It avoids juvenile tropes, opting instead for a modern Japanese consumer aesthetic: clean, organized, and high-quality. 

The target audience spans from elementary students learning the value of work to busy parents managing family finances. To bridge this gap, the system utilizes a **Modern-Tactile** style—relying on generous whitespace, soft depth, and a vibrant, sun-drenched palette to create a sense of optimism and clarity. The interface should feel like a premium physical stationery set: organized, tactile, and satisfying to use.

## Colors

The palette is anchored by "Energetic Orange," symbolizing motivation and activity. 
- **Primary (#FF8000):** Used for primary actions, progress indicators, and key brand moments.
- **Secondary Range (#FFB347, #FFBB00, #FEC798):** These shades provide hierarchy within complex data visualizations (like task categories or savings goals) without breaking the warm monochromatic harmony.
- **Background (#FFF8F1):** A "paper-white" cream that reduces eye strain compared to pure white and reinforces the friendly, tactile nature of the system.
- **Typography:** Main text is a soft charcoal (#333333) to maintain high legibility while appearing softer than pure black. Secondary text (#666666) is used for metadata and hints.

## Typography

This design system uses **Plus Jakarta Sans** for its friendly, open counters and modern geometric construction. It strikes a perfect balance between professional clarity and a welcoming, soft personality.

- **Headlines:** Use Bold (700) or SemiBold (600) weights with slight negative letter spacing to create a compact, "designed" look typical of modern Japanese apps.
- **Body:** Regular (400) weight ensures high readability for task descriptions and financial logs.
- **Labels:** SemiBold (600) is used for buttons and navigation items to ensure they are easily identifiable as interactive elements.

## Layout & Spacing

The layout philosophy follows a **Fluid Grid** model with an 8px base unit. 

- **Mobile:** A 4-column grid with 20px side margins. Content cards usually span the full width to maximize tappable areas for younger users.
- **Desktop/Tablet:** A 12-column grid with a max-width of 1200px. Dashboards use a sidebar-and-main-content split (3 columns for sidebar, 9 for main).
- **Rhythm:** Generous vertical spacing (24px - 32px between sections) is mandatory to maintain a "calm and organized" feel, preventing the app from feeling like a chore-list.

## Elevation & Depth

To achieve the "Modern Japanese" look, the design system utilizes **Tonal Layering** combined with **Ambient Shadows**.

1.  **Level 0 (Floor):** The `#FFF8F1` background.
2.  **Level 1 (Cards/Containers):** Pure white `#FFFFFF` surfaces with a very soft, diffused shadow (Offset: 0, 4px; Blur: 20px; Color: `rgba(255, 128, 0, 0.08)`). The slight orange tint in the shadow adds warmth and integrates the element into the brand palette.
3.  **Level 2 (Interactive Elements):** Elevated buttons or active cards use a slightly more pronounced shadow to indicate "pressability."

Avoid heavy inner shadows or harsh black drop shadows. Depth should feel like layers of thick, high-quality cardstock.

## Shapes

The shape language is defined by large, inviting radii that feel safe and friendly.

- **Default (8px):** Used for small inputs, checkboxes, and buttons.
- **Rounded-LG (16px):** Used for secondary cards and informational modals.
- **Rounded-XL (24px):** Used for primary dashboard cards and the main container for task lists.
- **Pill:** All primary buttons and chips should be fully rounded (pill-shaped) to maximize the "friendly/tappable" aesthetic.

## Components

### Buttons
- **Primary:** Pill-shaped, `#FF8000` background, white text. Large height (56px) for mobile to ensure easy tapping.
- **Secondary:** White background with a 1px border of `#FF8000` and orange text.

### Cards
Cards are the primary organizational unit. They must have a white background, 24px corner radius, and the standard ambient orange-tinted shadow. Padding within cards should be a minimum of 24px.

### Inputs & Selection
- **Text Fields:** Subtle `#FEC798` border when inactive, thickening to 2px `#FF8000` when focused. Background stays white.
- **Chips:** Used for task categories (e.g., "Study," "Chore," "Bonus"). Use the secondary color range with low opacity backgrounds (e.g., 15% opacity) and dark text of the same hue.

### Progress Bars
Progress bars for savings goals or task completion should be thick (12px+) with fully rounded ends. Use a track color of `#FEC798` and an active fill of `#FF8000`.

### Task Lists
Items in a list should have a 12px vertical gap between them. Each item is its own mini-card or separated by a soft horizontal rule in `#FEC798` at 20% opacity.