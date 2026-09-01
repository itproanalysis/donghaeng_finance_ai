---
name: "Donghaeng Finance"
description: "A calm dawn road that turns circumstances beyond the score into three review-ready steps."
colors:
  forest-ink: "#173a32"
  companion-green: "#285c4d"
  dawn-cream: "#fff8e8"
  route-gold: "#f2c46f"
  recovery-apricot: "#e6a86f"
  quiet-sky: "#dde9dc"
  fog-mist: "#e9eee3"
  grass-eucalyptus: "#91ad83"
  grass-deep: "#688469"
  road-taupe: "#b9ab92"
  road-edge: "#f5edda"
  evidence-blue: "#7296a2"
  muted-green: "#536c62"
typography:
  display:
    fontFamily: "Gowun Batang, Batang, serif"
    fontSize: "clamp(48px, 5.3vw, 82px)"
    fontWeight: 700
    lineHeight: 1.03
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Gowun Batang, Batang, serif"
    fontSize: "clamp(28px, 2.4vw, 40px)"
    fontWeight: 700
    lineHeight: 1.14
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Gowun Batang, Batang, serif"
    fontSize: "clamp(18px, 1.45vw, 24px)"
    fontWeight: 700
    lineHeight: 1.38
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Noto Sans KR, Apple SD Gothic Neo, sans-serif"
    fontSize: "13px"
    fontWeight: 520
    lineHeight: 1.68
    letterSpacing: "-0.03em"
  label:
    fontFamily: "Noto Sans KR, Apple SD Gothic Neo, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.02em"
rounded:
  soft: "10px"
  action: "12px"
  hud: "14px"
  arrival: "16px"
  pill: "999px"
spacing:
  cue-gap: "6px"
  micro: "8px"
  compact: "12px"
  control: "18px"
  panel: "24px"
  section: "36px"
  viewport-edge: "clamp(22px, 4.4vw, 72px)"
components:
  brand-navigation:
    textColor: "{colors.forest-ink}"
    typography: "{typography.label}"
    padding: "24px clamp(22px, 4.4vw, 72px)"
  hero-intro:
    textColor: "{colors.forest-ink}"
    typography: "{typography.display}"
    width: "min(660px, 55vw)"
  mission-hud:
    backgroundColor: "rgba(255, 248, 232, 0.9)"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.hud}"
    padding: "24px 25px 23px"
    width: "min(390px, 31vw)"
  cue-chip:
    backgroundColor: "rgba(40, 92, 77, 0.1)"
    textColor: "#294f43"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "26px"
  roadside-cue:
    textColor: "{colors.forest-ink}"
    typography: "{typography.title}"
    width: "min(250px, 19vw)"
  progress-navigation:
    textColor: "{colors.forest-ink}"
    typography: "{typography.label}"
    height: "22px"
  arrival-button:
    backgroundColor: "{colors.companion-green}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "0 22px"
    height: "52px"
  arrival-card:
    backgroundColor: "rgba(255, 248, 232, 0.96)"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.arrival}"
    padding: "34px 36px 30px"
    width: "min(520px, calc(100% - 44px))"
---

# Design System: Donghaeng Finance

## Overview

**Creative North Star: "새벽의 동행길 / The Dawn Companion Road"**

The Dawn Companion Road treats financial recovery as a calm first-person walk through a familiar Korean landscape. It is hopeful, grounded, human, and materially tactile: the product listens to circumstances outside the score, then makes three achievable steps visible without turning care into spectacle.

The road and its central vanishing point own the world. A restrained editorial HUD explains the journey without competing with it; cream paper, forest ink, route markers, and softly modeled roadside objects make AI feel like an attentive organizer rather than a neon machine. The experience always resolves at human review, never at a promise of loan approval.

**Key Characteristics:**

- A tactile dawn landscape with structural Three.js depth.
- Restrained Korean editorial typography over a road-dominant viewport.
- Explicit three-step progress from interview to review-ready evidence.
- Warm, rare accents that mark routes, recovery, and completion.
- Calm, reassuring components with visible states and honest boundaries.

## Colors

The palette moves from eucalyptus dawn light into forest ink, with gold and apricot reserved for route and recovery moments.

### Primary

- **Forest Ink** (`colors.forest-ink`): The main text, route line, progress, and focused destination color; it carries financial seriousness without becoming black.
- **Companion Green** (`colors.companion-green`): The active action, gate, and institutional anchor color.

### Secondary

- **Route Gold** (`colors.route-gold`): A scarce wayfinding and focus accent for mission markers, selection, and moments of passage.
- **Recovery Apricot** (`colors.recovery-apricot`): A human warmth cue for interview, evidence, and incremental recovery objects.

### Tertiary

- **Evidence Blue** (`colors.evidence-blue`): A supporting material color for documents and review artifacts; it never becomes a generic technology accent.

### Neutral

- **Dawn Cream** (`colors.dawn-cream`): The readable paper surface for HUDs, labels, arrival, and road edging.
- **Quiet Sky** (`colors.quiet-sky`) and **Fog Mist** (`colors.fog-mist`): The eucalyptus-tinted atmosphere behind the route.
- **Grass Eucalyptus** (`colors.grass-eucalyptus`) and **Deep Grass** (`colors.grass-deep`): The grounded landscape field and its darker vegetation.
- **Road Taupe** (`colors.road-taupe`) and **Road Edge** (`colors.road-edge`): The tactile path body and its legible boundary.
- **Muted Green** (`colors.muted-green`): Secondary explanation and compact status copy.

**The Quiet Accent Rule.** Gold and apricot mark meaning—route, recovery, or focus—and never flood a surface.

## Typography

**Display Font:** Gowun Batang (with Batang and serif fallbacks)

**Body Font:** Noto Sans KR (with Apple SD Gothic Neo and sans-serif fallbacks)

**Character:** Gowun Batang gives the journey a patient, literary Korean voice; Noto Sans KR keeps instructions, status, and product boundaries direct. Tight tracking creates editorial confidence, while generous body leading preserves ease and trust.

### Hierarchy

- **Display** (`typography.display`): The opening promise and only the largest journey-defining statements.
- **Headline** (`typography.headline`): Mission HUD and arrival headings.
- **Title** (`typography.title`): Roadside thoughts and compact narrative emphasis.
- **Body** (`typography.body`): Explanations, mission descriptions, and product-boundary copy; keep lines near the observed 36–38em maximum.
- **Label** (`typography.label`): Progress, cue, and status language; use weight rather than all-caps styling to stay approachable.

**The Whole Sentence Rule.** Korean phrases use `word-break: keep-all`; responsive layouts reposition or resize complete thoughts instead of arbitrarily splitting syllables or sentences.

## Layout

The home is a 100svh sticky stage inside a 420svh journey, with 320svh of scroll travel driving the camera. The road remains centered on a strong vanishing point while editorial information occupies the edges: brand at the top, mission context to the left or roadside, and progress across the bottom. Horizontal page insets use `spacing.viewport-edge`; HUD width is bounded rather than allowed to cover the route.

At 1180px and wider, the mission HUD settles near the lower left to expose more landscape. At 1040px and below, verbose roadside thoughts disappear and reappear as compact cue chips inside the HUD. At 760px and below, the journey shortens to 400svh with 300svh of scroll travel; the HUD becomes a full-width top panel with 16–18px insets, the brand descriptor hides, and progress compresses along the bottom. A height breakpoint at 700px tightens display size and vertical offsets without changing story order.

**The Road Stays Primary Rule.** Responsive adaptation may simplify supporting semantics, but it never crops the route into a decorative strip or covers its central passage with dense interface chrome.

## Elevation & Depth

This system uses a hybrid depth model. The Three.js road, fog, camera perspective, modeled objects, and directional light provide structural depth; HTML surfaces receive only restrained ambient lift for readability. The mission HUD uses `0 18px 45px rgba(31,65,53,.18)` with an 8px blur, the arrival card uses `0 24px 70px rgba(23,58,50,.24)`, and the primary arrival action uses `0 10px 22px rgba(40,92,77,.24)` at rest. No generic glass panels or stacked dashboard shadows belong in the world.

**The Structural Depth Rule.** Let the road scene create space; use shadow only to keep essential language legible or to confirm arrival.

## Shapes

Edges are gently softened rather than bubbly. Reading surfaces progress from a soft 10px treatment to 14px HUD and 16px arrival corners; the main action uses 12px, while 999px is reserved for compact semantic cue chips. Progress numbers and the scroll indicator use true circles or capsules. In the 3D world, rounded extruded panels, gates, documents, and steps repeat the same friendly geometry with visible material thickness.

Borders are functional and quiet: a one-pixel current-color ring defines progress, while most paper surfaces rely on tone and ambient depth. Avoid arbitrary radius variation; larger radius corresponds to a larger, more conclusive surface.

## Components

### Brand Navigation

The navigation is a quiet identity rail, not a conventional marketing menu. It spans the viewport with the brand in display type and a compact sans-serif descriptor opposite; links underline on hover and receive a three-pixel route-gold focus outline with a five-pixel offset. On mobile, the descriptor disappears so the road and product name remain clear.

### Mission HUD and Cue Chips

The mission HUD is a translucent dawn-cream reading card with forest text, restrained blur, and ambient lift. It contains a small progress label, one headline, one concise explanation, and—only below the roadside-content breakpoint—two companion-green cue chips. Chips are compact semantic summaries, not filters or decorative tags.

### Roadside Cues

Roadside cues pair a small sans-serif role label with a short Gowun Batang statement. Desktop places them to either side of the road so “what we hear” and “what review gains” remain distinct; compact layouts translate their meaning into HUD chips instead of shrinking the original sentences.

### Progress Navigation

Three mission previews sit in one ordered rail. Future items are quiet, the current preview rises four pixels, earlier previews replace the number with “확인,” and a four-pixel track fills directly with scroll progress. Mobile keeps all three previews visible, reduces the marker to 19px, and uses a three-pixel track.

### Arrival Card and Primary Action

The arrival card is the single highest HTML surface: centered, balanced, and limited to one conclusion, one action, and one explicit product boundary. Its companion-green button lifts three pixels and deepens to forest ink on hover; focus uses route gold. Disabled state means the route is incomplete or the interview transition is already underway.

**The Honest Arrival Rule.** Completion means “ready for a better consultation,” never approval, guaranteed credit improvement, or an automated final judgment.

### First-Person Road

One authored scroll sequence advances the camera through interview, cash-flow habit, and consultation-evidence gates. Natural bob and sway appear only while walking; gate light responds once near passage. Reduced-motion mode replaces interpolation with four stepped camera states, removes bob, sway, rotation, and pulses, and stops decorative loops while preserving the entire story.

## Do's and Don'ts

### Do:

- **Do** keep the road and central vanishing point visually dominant in every viewport.
- **Do** use cream reading surfaces and restrained ambient lift only where language needs protection from the scene.
- **Do** preserve complete Korean phrases with `word-break: keep-all` and simplify supporting content into explicit cues on compact screens.
- **Do** connect AI interview, achievable habits, prepared evidence, and human review in that order.
- **Do** carry provenance for every shipping raster; the road itself should remain code-native when possible.

### Don't:

- **Don't** introduce generic AI neon, cyan glows, glass dashboards, or abstract chatbot imagery.
- **Don't** let gold or apricot become broad background fills; their rarity makes wayfinding legible.
- **Don't** add independent scroll effects, looping decoration, or competing camera motion to the authored traversal.
- **Don't** imply loan approval, guaranteed score improvement, or an AI-made final lending decision.
- **Don't** shrink desktop roadside sentences into illegible fragments on mobile; replace them with the approved compact semantic cues.
