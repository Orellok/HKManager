---
name: coding-standards
description: Stack-independent coding standards for this team. Use when writing, changing or reviewing application code or tests.
---

# Coding standards

These standards apply in every project. Stack-specific rules come from `.claude/project-profile.md`, the linter and formatter config, and the existing code. When those conflict with this file, the project wins: consistency with the codebase beats any general rule here.

## Order of authority

1. The project profile and its "Do not touch" list
2. Linter, formatter and type checker configuration
3. Patterns already established in the codebase
4. This file

## Design

- Make the smallest change that fully solves the problem. Do not refactor code the task does not touch.
- One responsibility per function, class and module. If describing it needs "and", split it.
- Prefer the simple, direct solution. Add an abstraction only when there are at least two real uses for it today.
- Reuse what exists before writing new: utilities, components, types, helpers.
- Keep business logic out of UI components, controllers and route handlers.
- No new dependency without a stated reason. Prefer the standard library and what the project already uses.

## Naming and readability

- Names state intent: what a value is or what a function does. No abbreviations the codebase does not already use.
- Follow the casing and file naming conventions already in the project.
- Code should read top to bottom without needing comments. Comment the why of a non-obvious decision, never the what.
- No dead code, commented-out code, debug output or leftover TODOs without an owner or issue.

## Correctness

- Validate input at system boundaries: user input, API requests, file and network data. Trust internal code.
- Handle the empty, null, zero, boundary and duplicate cases explicitly.
- Never swallow an error. Handle it meaningfully or let it propagate with context.
- No magic numbers or strings. Name them.
- Use the type system fully where the language has one. No escape hatches (`any`, unchecked casts, ignore directives) without a comment explaining why.

## Security

- Never commit secrets, keys or credentials. Read them from the project's configuration mechanism.
- Never build queries, shell commands or markup by concatenating untrusted input. Use parameterization and escaping provided by the framework.
- Enforce authorization on the server for every protected action, not only in the UI.
- Do not log personal data, tokens or passwords.

## Performance

- Do not optimize without a reason, but avoid known traps: queries inside loops, unbounded lists without pagination, repeated expensive work that could be computed once, blocking calls on hot paths.

## Tests

- New logic gets tests, written with the project's test tool and placed where the profile says.
- Test behavior through the public interface, not implementation details.
- Each test covers one behavior and has a name that states it.
- Cover the main path, the edge cases and the failure paths.
- Tests must be deterministic: no dependence on real time, network, ordering or shared state.
- Never weaken, skip or delete a test to get a green run. A test that fails for a wrong reason gets fixed; one that fails for a right reason means the code is wrong.

## Before calling work done

Run, using the commands in the profile: format, lint, type check, tests, build. All must pass, and the result of each must be reported honestly.
