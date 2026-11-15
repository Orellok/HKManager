---
name: design-system
description: Stack-independent UX/UI and accessibility standards. Use when designing, specifying, building or reviewing any user-facing interface.
---

# Design system standards

These are the team's baseline UI rules. The project's own tokens, theme and component library (paths are in `.claude/project-profile.md`) always take precedence: find them and use them before applying anything here. If the project has no tokens yet, define a minimal set in the theme file rather than scattering raw values, and report it.

## Reuse first

- Use an existing component before creating one. Extend it with a variant before copying it.
- Use design tokens for color, spacing, type, radius and shadow. A raw value in a component is a defect unless no token fits, and then it is flagged.
- A new component earns its place by being needed in more than one spot, or by being clearly distinct from everything existing.

## Layout and spacing

- Use the project's spacing scale consistently. Related items sit closer together than unrelated ones.
- Align to a clear grid. Avoid one-off offsets.
- Design for every viewport listed in the profile, smallest first. No horizontal scrolling of the page; wide content scrolls inside its own container.
- Layouts must survive real content: long names, long translations, empty lists, large numbers.
- If the profile lists an RTL language, use logical properties (start/end, not left/right) and mirror directional icons.

## Typography and color

- Use the project's type scale. One clear hierarchy per screen: one primary heading, then descending levels.
- Body text stays at a comfortable reading size and line length.
- Color is never the only carrier of meaning: pair it with text, an icon or a shape.
- One primary action per view. Secondary and destructive actions are visually distinct from it.

## States

Every interactive element defines, where applicable: default, hover, focus, active, disabled, loading, error, success. Every data view defines: loading, empty, error, partial and full. An undefined state is an unfinished design.

- Loading: show progress for anything that can take more than a moment; keep the layout stable while it loads.
- Empty: explain what belongs here and offer the next action.
- Error: say what happened and how to recover, in plain language, next to where it occurred. Preserve what the user already entered.
- Destructive actions ask for confirmation or offer undo.

## Forms

- Every field has a visible label. Placeholder text is not a label.
- Validate at the right moment: on blur or submit, not on every keystroke. Show the error beside the field.
- Mark required or optional consistently. Use the correct input type so mobile keyboards match.
- The submit action is disabled only while submitting, and shows that it is working.

## Content

- Labels name the action: "Save changes", not "OK" or "Submit".
- Use the same word for the same thing everywhere.
- Short, plain sentences. No blame in error messages.

## Accessibility (WCAG 2.1 AA baseline)

- Semantic elements first: real buttons, links, headings, lists, landmarks. ARIA only to fill gaps.
- Everything works with the keyboard alone, in a logical order, with a clearly visible focus indicator. No keyboard traps.
- Text contrast at least 4.5:1 (3:1 for large text and for UI component boundaries).
- Touch targets at least 44 by 44 CSS pixels.
- Images have meaningful alt text, or empty alt when decorative. Icon-only buttons have an accessible name.
- Dialogs trap focus while open and return it on close. Dynamic updates are announced to assistive technology.
- Respect the reduced-motion preference. Motion supports understanding and is brief.
- The page works at 200% zoom.

## Spec checklist

A UI spec is complete when it covers: goal, user flow, layout per viewport, components (reused and new), all states, exact content, tokens, accessibility notes, and numbered testable acceptance criteria.
