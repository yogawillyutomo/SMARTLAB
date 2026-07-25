# Codex Review Loop

## Recommended workflow

1. Create a GitHub issue with scope and acceptance criteria.
2. Ask Codex to implement the issue in an isolated branch/worktree.
3. Codex runs checks and opens a draft pull request.
4. CI runs lint, type checking, build, and later backend/agent tests.
5. Codex/GitHub code review inspects the pull request diff.
6. A reviewer checks behavior, architecture, security, and regression risk.
7. Review findings become explicit PR comments or a follow-up Codex task.
8. Codex fixes only the accepted findings and updates the same PR.
9. CI and review repeat until all required checks pass.
10. A human approves the merge.

## Required task format

Each task should include:

```text
Goal:
Scope:
Out of scope:
Acceptance criteria:
Relevant files/modules:
Commands to run:
Evidence required:
```

## Review dimensions

- Correctness and acceptance criteria
- Regression risk
- Authentication and authorization
- Data consistency and transactions
- Privacy and monitoring boundaries
- Mobile usability and offline behavior
- Accessibility
- Performance
- Tests and observability
- Contract compatibility

## Rule
Never ask an implementation agent to broadly “improve everything.” Keep changes reviewable and one concern per pull request.
