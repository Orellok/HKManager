---
name: review-checklist
description: Structured code review checklist with severity rules. Use when reviewing a diff, pull request or implementation before it moves to QA.
---

# Review checklist

Review the diff in this order. Earlier categories matter more; do not spend the review on style while a correctness problem goes unnoticed.

## 1. Does it do the right thing

- The change implements what the task and spec ask, completely. Every acceptance criterion is addressed.
- Nothing outside the task was changed. Unrelated edits are a finding.
- Nothing on the profile's "Do not touch" list was modified.

## 2. Correctness

- Logic holds for empty, null, zero, boundary and duplicate inputs.
- Error paths are handled, not swallowed, and leave the system in a consistent state.
- Async and concurrent code: no race conditions, unawaited results, or leaked resources (connections, listeners, timers, file handles).
- State changes and data writes are atomic where they need to be.
- Existing callers of changed code still work.

## 3. Security

- Untrusted input is validated at the boundary and never concatenated into queries, commands or markup.
- Authorization is checked on the server for each protected action.
- No secrets in code, config committed to the repo, or logs.
- New dependencies are necessary, maintained and from a trusted source.

## 4. Tests

- New and changed logic has tests, and they would fail if the logic were broken.
- Edge and failure cases are covered, not only the main path.
- No test was weakened, skipped or deleted to make the suite pass.
- The suite, lint, type check and build pass when you run them yourself.

## 5. Design and maintainability

- The change follows the patterns already in the codebase.
- No duplication of something that already exists in the project.
- Functions and modules have one responsibility; nothing is more abstract than its current uses need.
- Names state intent. No dead code, debug output or unexplained TODOs.

## 6. Performance

- No queries or network calls inside loops, unbounded result sets, or repeated expensive work on a hot path.

## 7. UI changes only

- Matches the spec: layout, states, content.
- Uses design tokens and existing components, not raw values or one-off copies.
- Keyboard accessible, labelled, with visible focus.

## Severity

**Blocking** (must be fixed before approval):
- wrong or incomplete behavior against the spec
- a security problem or risk of data loss
- a failing check
- missing tests for new logic, or weakened tests
- a clear violation of the project's standards
- changes outside the task scope that carry risk

**Non-blocking** (suggestions): readability improvements, alternative approaches, minor naming, anything that is preference rather than a defect.

When unsure whether something is blocking, ask: would this cause a bug, a vulnerability or a real maintenance cost? If not, it is non-blocking.

## Writing a finding

Each finding states: `path/file:line`, what is wrong, why it matters, and a concrete fix. One issue per finding. If the same issue repeats, report it once and list the locations.
