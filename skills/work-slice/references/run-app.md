# Running the app for browser verification and capture

The Playwright verify loop (work-slice Step 3) and the capture stage
(`pr-evidence.md`) both drive the **real app, the way a user sees it**. Captures
reach the PR body and the human ticket, where designers, PMs and QA read them.
If the screen shows translation keys, placeholder copy, test fixtures or a
"test mode" banner, the capture misleads them. A capture like that is a defect,
not evidence.

## 1. Resolve the run command: Conductor settings first

Inside Conductor (`CONDUCTOR_IS_LOCAL` is set), the repo's Conductor run script
is the source of truth for starting the app:

1. Pick the environment: `CONDUCTOR_IS_LOCAL=1` means `local`, `0` means
   `cloud`. If it is set to anything else, stop and report. Never guess the
   environment from earlier runs, `.env.local` contents or URLs you have seen.
2. Read `.conductor/settings.toml`, then apply `.conductor/settings.local.toml`
   on top when it exists (the local file wins key by key). Read only
   `[scripts]`; never print or copy the `environment_variables` tables, which
   hold secrets.
3. `[scripts.run.<name>]` entries: take the one whose `available_in` includes
   the environment. If several match, take the one with `default = true`. If
   none match, the app has no run command here: treat it as "no dev stack"
   (below). A plain `scripts.run = "<command>"` string applies everywhere.
4. Run that `command` verbatim from the workspace root: same env prefixes, same
   wrapper (`mise exec`, alias registration). Do not trim it, "simplify" it or
   swap the dev target for another one.

Only outside Conductor, or when the settings have no `[scripts] run`, fall back
to `devServerCommand` from repo config. If both exist and disagree, the
Conductor command wins. Record one `verification.jsonl` note naming the command
you used and where it came from.

The app URL comes from the command's own output (for example a Portless HTTPS
URL printed on start) or from `browserGuidePath`. Use that exact origin for
login and every navigation. Never switch between a raw port and a proxy
hostname mid-run, because auth cookies and callbacks are tied to the origin.

## 2. Never let a test harness start or configure the app

The repo's e2e setup exists for CI assertions, not for showing the product. It
often builds or serves a special e2e build (translation keys instead of copy,
mocked services, a separate database) and loads e2e env files into the process.

- **Do not run the throwaway spec under the `e2eDir` Playwright config.** Use
  that project only for patterns: the dev-login steps, selectors and fixtures
  you copy into the spec. Run the spec with its own minimal config file, kept
  next to it in the gitignored test-output dir and recorded in
  `scratch-files.json`: `baseURL` = the URL from §1, **no `webServer`**, one
  desktop Chromium project, and no loading of `.e2e.env` or any other env file.
  `npx playwright test --config <that file>`.
- **No test-mode flags.** Do not set env vars that switch the app into a
  test rendering mode (showing i18n keys, mock data, disabled animations for
  snapshots), even if the browser guide suggests them for stable assertions.
  For assertions, use the real copy, roles, test ids or `aria` attributes
  instead.
- **Never start the app through an e2e target** (`nx e2e`, `build-e2e`,
  `next start` on an e2e build dir, `pnpm test:e2e`), not even "just to get a
  server".

## 3. Reuse only the right server

There is one dev server per run (work-slice Step 3). An already running server
is reused only when it serves the §1 URL **and** was started by the §1 command.
A server on another port (typically the e2e port), or one started with test
flags, is not the app. Leave it alone, start the §1 command, and if its port is
taken by something else, stop and report instead of starting a second server.

## 4. Check the app looks right before any capture

After login, and before the first screenshot or video, look at the first screen
the capture uses. The check fails if you see any of these:

- raw translation keys instead of copy: dotted or namespaced identifiers such
  as `settings.profile.title` or `Common.save`, or ICU placeholders like
  `{count}` rendered literally;
- empty labels or buttons where text belongs;
- an error overlay, "missing environment variable" page or test-mode banner.

On failure: stop the server you started, fix the cause (wrong command, stray
env flag, wrong server reused), start it again with the §1 command and re-check.
If the §1 command itself cannot render real copy here (for example the
translation service is unreachable or its key is missing in this sandbox), the
workspace has no usable dev stack for evidence. Publish nothing and use the
section's one-line form naming the reason. A capture with keys on screen is
never published, not even with a caption explaining it.

The Playwright verify loop runs the same check. A failure there is a problem
with how the app was started, not a code defect: fix the run, never hand it to
a fix agent. If the run cannot be fixed, the round could not verify, which
counts as FAIL, and the report names the reason.
