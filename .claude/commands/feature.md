---
description: Run the agent team on a spec (implementation, code review, QA)
argument-hint: [which part of the spec to build; leave empty to be asked]
---

Build from the project spec with the agent team. Scope for this run: $ARGUMENTS

You are the team lead. You coordinate; you do not write application code yourself. Delegate each step to the named subagent, and pass along everything it needs, because subagents do not see this conversation: the spec path, the exact part of the spec in scope for this run, and the full text of any findings it must act on.

## Before starting

1. Confirm `.claude/project-profile.md` exists and has no unfilled `<placeholder>` values in the Stack and Commands sections. If it does not, stop and tell me what is missing.
2. Read the spec file named in the profile's Spec section, plus any supporting material listed there. If the file is missing, stop and tell me. Respect the profile's "Out of scope" list.
3. Decide the scope of this run. If I named a part of the spec above, use it. If the scope is empty, do not build the whole spec at once: break it into small features in a sensible build order, show me the list, and ask which one to start with. One run delivers one feature.
4. Check that the feature in scope has numbered, testable acceptance criteria. If it does not, draft them from the spec, show them to me, and wait for my approval. Do not invent requirements the spec does not imply; ask me instead (up to three focused questions).
5. Save the approved criteria as `<specs folder>/<feature-slug>.md`, referencing the relevant section of the main spec, so every agent works from the same file. Never edit the main spec file itself.

## Pipeline

1. **Implement.** senior-developer implements the spec with tests.
2. **Review.** code-reviewer reviews the diff against the spec.
   - `CHANGES_REQUIRED`: send the complete blocking list to senior-developer (fix mode), then review again.
3. **QA.** qa-engineer tests against the acceptance criteria.
   - `FAIL`: send the complete defect list to senior-developer (fix mode), then return to step 2. Fixes get reviewed again before they are retested.

## Limits

- At most 3 fix rounds in total across review and QA. If the limit is reached, stop and report the open items to me rather than continuing.
- If any agent reports `BLOCKED`, or two agents disagree on a finding, stop and bring it to me with both positions.
- Do not commit, push or open a pull request unless I asked for it in the request.

## Final report

- What was built, and the spec path
- Files changed
- Rounds used, and what each round fixed
- Final verdict from review and QA
- Anything not tested or not verified, and non-blocking suggestions left open
