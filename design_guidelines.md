# Nihki - Live Translation Application Design Guidelines

## Design Approach

**System-Based Minimal Interface** inspired by Linear and Zoom's professional clarity. The black/white constraint creates a sophisticated, distraction-free environment perfect for real-time communication. This utility-first approach prioritizes readability and instant comprehension over decorative elements.

## Core Design Elements

### A. Color Palette

**Dark Mode (Primary)**
- Background Base: `0 0% 9%` (near-black canvas)
- Surface Elevated: `0 0% 13%` (cards, modals)
- Surface Interactive: `0 0% 17%` (hover states)
- Border Subtle: `0 0% 20%` (dividers)
- Text Primary: `0 0% 98%` (main content)
- Text Secondary: `0 0% 65%` (supporting text)
- Text Muted: `0 0% 45%` (timestamps, metadata)

**Accent Colors (Functional Only)**
- Active Speaker: `142 76% 36%` (green indicator)
- Hand Raised: `25 95% 53%` (orange notification)
- Denied: `0 84% 60%` (red alert)
- System Status: `217 91% 60%` (blue info)

**Light Mode Alternative**
- Background: `0 0% 100%`
- Surface: `0 0% 96%`
- Text: `0 0% 9%`
- Borders: `0 0% 88%`

### B. Typography

**Font Family**: Poppins (Google Fonts)
- Headings: 600 (Semibold)
- Body: 400 (Regular)
- Labels/UI: 500 (Medium)

**Scale**
- Hero/Display: text-5xl (48px) - Conference names
- H1: text-3xl (30px) - Session titles
- H2: text-xl (20px) - Section headers
- Body Large: text-base (16px) - Translation text
- Body: text-sm (14px) - UI controls
- Caption: text-xs (12px) - Metadata, timestamps

**Line Heights**
- Headings: leading-tight (1.25)
- Translation Display: leading-relaxed (1.75) - critical for readability
- UI Text: leading-normal (1.5)

### C. Layout System

**Spacing Primitives**: Use Tailwind units of **4, 6, 8, 12, 16**
- Tight spacing: p-4, gap-4 (component internals)
- Standard spacing: p-6, gap-6 (sections)
- Generous spacing: p-8, p-12 (page margins)
- Section breaks: py-16, py-24 (vertical rhythm)

**Grid Structure**
- Main Layout: 70/30 split (translation panel / controls sidebar)
- Translation Display: Single column, max-w-4xl centered
- Control Panels: Stacked cards with gap-4

### D. Component Library

**Translation Display Panel**
- Full-width card with subtle border
- Word-by-word reveal animation (fade-in sequential)
- Active word highlight with background: `0 0% 20%`
- Source language label (top-left, text-xs, muted)
- Font size: text-lg for optimal readability
- Padding: p-8 for breathing room

**Moderation Controls**
- Floating bottom bar (sticky, backdrop-blur)
- Hand raise button: Circular, 56px, orange accent when active
- Speaker list: Compact avatars with status indicators
- Approve/Deny actions: Icon-only buttons, 40px touch targets

**Status Indicators**
- Live badge: Pulsing dot + "LIVE" text (top-right)
- Speaker badge: Green ring around avatar (4px width)
- Hand raised: Orange badge with count overlay
- Connection status: Small indicator in navbar

**Navigation**
- Top bar: 64px height, backdrop-blur-md
- Logo left, session info center, controls right
- Settings/profile icons: 40px clickable areas
- Minimal divider: border-b with subtle opacity

**Modals & Overlays**
- Dark backdrop: bg-black/80
- Modal cards: Elevated surface with rounded-2xl
- Close button: Top-right, 40px touch target
- Actions: Right-aligned, gap-3

### E. Interaction Patterns

**Micro-interactions** (minimal, purposeful)
- Button hover: Brightness increase (filter: brightness-110)
- Active speaker pulse: Subtle 2s infinite scale animation
- Hand raise: Single bounce on activation
- Translation reveal: 150ms stagger per word

**Transitions**
- UI state changes: 200ms ease-out
- Panel slides: 300ms ease-in-out
- Modal appearance: 250ms scale + fade

## Images

**Hero Section**
- Large abstract geometric pattern representing sound waves and translation flow
- Monochromatic gradient overlay (black to transparent)
- Image dimensions: Full viewport width, 60vh height
- Placement: Landing page top
- Style: Modern, minimal, professional - think audio waveforms meeting global connectivity
- Overlay text centered with backdrop-blur for readability

**Feature Visuals**
- Translation interface mockup: Screenshot-style presentation of word-by-word display
- Moderation panel preview: UI demonstration of hand-raise system
- Multi-language showcase: Visual of 6-8 language flags in elegant grid
- Placement: Feature sections, alternating left/right with text

## Page-Specific Layouts

**Landing Page**
- Hero: 60vh with abstract visual + centered CTA
- Features: 3-column grid (translation / moderation / accessibility)
- Demo section: Full-width video/image showcase
- Pricing: Clean table with subtle card elevation
- Footer: Minimal with social links and quick navigation

**Active Session Interface**
- Header: Session info, live badge, connection status
- Main: Translation panel (70% width) + participant sidebar (30%)
- Bottom bar: Moderation controls (hand raise, mic, settings)
- Minimal chrome - focus on content

**Admin Dashboard**
- Left sidebar: Session navigation (240px)
- Main grid: 2x2 analytics cards
- Participant list: Table with inline actions
- No floating elements - grounded design

**Critical Design Principles**
- Contrast first: Every element must be instantly readable
- Zero decorative animations during active sessions
- Touch targets: Minimum 40px for all interactive elements
- Information hierarchy through weight and size, not color
- Whitespace as a design element - embrace emptiness