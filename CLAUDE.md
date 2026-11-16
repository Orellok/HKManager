# HKManager – instructions for Claude sessions

- Communicate with the owner in Hebrew.
- At the start of every session read `docs/PROGRESS.md` and resume from its "Next step" without waiting to be asked, unless that step requires an owner decision.
- Follow `.claude/project-profile.md` and `.claude/commands/feature.md`. The spec is `SPEC.md` (never edit it).
- Commit and push after every meaningful step, and update `docs/PROGRESS.md` in the same commit.
- PR workflow (owner decision 2026-11-16): development continues on the session branch. When a feature is DONE (review APPROVED + QA PASS), push a feature branch `claude/feature-<id>-<slug>` at the feature's DONE commit and open a PR **directly to `main`** (never stacked on another PR branch). Do not wait for the owner's merge – continue with the next feature immediately.
