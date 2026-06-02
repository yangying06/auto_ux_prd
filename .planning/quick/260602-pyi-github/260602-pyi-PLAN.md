# Quick Task 260602-pyi: 检查本地改动，忽略仅本地内容，提交并推送到 GitHub

**Date:** 2026-06-02
**Mode:** quick

## Task 1 — Separate local-only artifacts from commit content

- Files: [.gitignore](../../../.gitignore), working tree status
- Action: Add ignore rules for Claude worktrees, GSD debug scratch data, and local progress files; keep application/source/docs changes eligible for commit.
- Verify: `git status --short` no longer lists ignored local-only paths.
- Done: local-only paths are ignored and not staged.

## Task 2 — Validate, commit, and push

- Files: all eligible modified/untracked project files plus quick-task artifacts
- Action: Run project checks, stage only commit-eligible files, commit, then push to GitHub.
- Verify: validation succeeds or failures are reported; commit exists; push succeeds.
- Done: GitHub has the new commit and local-only artifacts remain untracked/ignored.
