---
name: sync-upstream
description: Merge pingdotgg/t3code main into this fork (batchema/t3code), resolve conflicts so the fork's features keep working, validate locally, and open a PR. Use when asked to sync the fork with upstream, and from the scheduled sync task.
---

# Sync with upstream

This fork tracks `pingdotgg/t3code` until it becomes a hard fork. Each sync is one PR to
`batchema/t3code`, which a maintainer reviews and merges. Never merge it yourself.

The run may be unattended, started by a scheduled task. Don't stop to ask questions. End with a
PR, or with one line saying why there was nothing to do.

## Decide whether to run

```sh
git remote get-url upstream || {
  git remote add upstream https://github.com/pingdotgg/t3code.git
  git remote set-url --push upstream no_push
}
git fetch origin && git fetch upstream
git rev-list --count origin/main..upstream/main
gh pr list --repo batchema/t3code --state open --json number,headRefName \
  --jq '.[] | select(.headRefName | startswith("chore/sync-upstream"))'
```

Stop if upstream has no new commits. Also stop if a sync PR is already open, and name it.

## Set up

Work in a worktree, never the main checkout. Sanu Code runs from the main checkout and restarts
when its files change. A scheduled task with a worktree workspace already gives you one.
Otherwise, `git worktree add` one next to the main checkout and run `vp i` in it.

```sh
git switch -c "chore/sync-upstream-$(date +%F)" origin/main
git merge --no-ff upstream/main -m "chore: sync with upstream main"
```

## Resolve conflicts

A merge without conflicts commits itself, so skip to Validate. Otherwise, before you edit
anything, read the fork's own commits so you know what to protect:
`git log --oneline --no-merges upstream/main..origin/main`. List the conflicted files with
`git diff --name-only --diff-filter=U`. For each one, learn what each side changed:

```sh
base=$(git merge-base origin/main upstream/main)
git log --oneline "$base"..origin/main -- <file>    # the fork
git log --oneline "$base"..upstream/main -- <file>  # upstream
```

- Keep every fork feature working, and take upstream's version of everything else. Most
  conflicts are two additions next to each other, so keep both.
- When upstream changes something the fork's code uses, such as a signature, a command's shape,
  or a test layer that is now required, change the fork's code to match. Never revert upstream
  to make the fork's code fit.
- Don't hand-merge generated files:
  - Translation catalogs in `apps/{web,mobile}/src/i18n/translations`: wrap the fork strings
    that `t3code/no-untranslated-copy` flags, run `vp run i18n:generate`, then
    `vp run i18n:check`.
  - `apps/server/src/provider/agentContextBudget.json`: run `AgentContextBudget.test.ts` and set
    the file to the values it measures.
- When the two sides truly can't both hold, pick the closest reasonable resolution, open the PR
  as a draft, and explain the choice under **Needs a decision**.

Once every conflict is resolved, `git add` the files and finish the merge with
`git commit --no-edit`.

## Validate

The fork has no CI, so all validation happens here. Commit the fixes it leads to as separate
commits on the branch, so each one can be reviewed on its own.

- Run `vp run check:changed upstream/main`. Comparing against upstream checks the fork's whole
  difference, including your resolutions. If its test step times out, run `vp test run` on the
  test files the fork changes (`git diff --name-only upstream/main`) and the tests beside every
  file you resolved.
- A failing test blocks the PR unless it also fails on `upstream/main` in a clean worktree. List
  any failures that also happen on upstream in the PR.
- Boot the merged app with `vp run dev` in the worktree. Its first run seeds a copy of real data.
  Check the server log for errors and failed migrations. Then make one pass with
  [test-t3-app](../test-t3-app/SKILL.md): the sidebar and a settled thread load, a turn's diff
  renders, the command palette opens, and every fork feature whose files conflicted still works.
  Stop the dev server when you're done.

## Open the PR

Push the branch to `origin`. Open the PR against `main` on `batchema/t3code`, never upstream.
`gh pr create` defaults to the parent repository in a fork, so pass `--repo batchema/t3code`.

Title it `chore: sync with upstream main`. The body has these parts, in this order:

1. One sentence: how many commits behind the fork was, and the upstream SHA it merged.
2. **Merge this with a merge commit, not squash.** Squashing drops upstream's history, and
   every later sync conflicts again.
3. **Needs a decision**: include this only when a conflict needs one.
4. **Conflicts**: each file and how its two sides were combined. Group the files where both
   sides were simply kept.
5. **Fork code adapted to upstream**: fork code that had to change for upstream changes that
   didn't conflict as text.
6. **Validation**: what ran and passed, failures that also happen on upstream, and what the app
   pass covered.
