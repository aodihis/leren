---
name: feature-screenshots
description: Use when capturing screenshots of a UI feature in apps/platform as evidence for a pull request, changelog or docs: a page, dialog, form, menu, card, or any other piece of UI. Covers running the app, isolating the feature, focused crops, consistent sizes across a set, states to cover, and adding the images to a PR.
---

# Feature Screenshots

A screenshot is evidence that a change works. It shows one feature in a known state, not the whole page around it. Capture only what the PR changed.

## When to use

- A PR changes visible UI in `apps/platform` or `packages/ui`.
- The user asks for screenshots, a gallery, or visual evidence for a PR.

Do not capture screenshots for a change that has no visible effect. Say that no screenshots apply.

**Exception:** if no browser or screenshot tool is available in the session, skip the evidence. Do not install a tool, write a mock-up, or ask the user to supply images. Say that screenshots were skipped because no tool was available, and continue with the rest of the task.

## 1) Run the app

1. Check `docs/rules/` and the project scripts for the current way to start the app. At the time of writing, `pnpm dev` in `apps/platform` starts the Vite dev server.
2. If the feature needs the API, worker, Postgres or Qdrant, start them first as `docker-compose.dev.yml` and the docs describe. Do not capture a screen that shows an error because a dependency was not running.
3. Seed or create only the data the feature needs. Use realistic, neutral sample content. Never show real user data, secrets, tokens or `.env` values in a screenshot.

If the app cannot be started, say so and do not substitute a mock-up.

## 2) Choose the style

- **Transparent or isolated** when the feature has distinct edges of its own, such as rounded corners or a shadow: dialogs, popovers, menus, cards, toasts. Only the feature remains.
- **Focused crop** otherwise: a field, a table, a row of buttons, part of a page. Crop with the same padding on all four sides, and hide neighbouring UI and text inside that padding.
- **Full page** only when the change is the page layout itself.

## 3) Capture consistently

Use the browser tools available in the session, such as Claude in Chrome (load it with the `chrome-browser` skill first) or the built-in browser. Do not install a new tool to take screenshots.

1. Resize the viewport once for the whole set, for example 1280×720, and read back the real size. Every shot in a set uses the same viewport so the feature lands in the same place.
2. Use the light theme unless the PR concerns theming. When it does, capture each theme.
3. Put the feature in the state that proves the change. Open the dialog, focus the field, trigger the error. Do not capture the idle page.
4. Hide anything that distracts or can change between runs: the dev tools bar, toasts that are not part of the feature, timestamps, hover states and focus rings that are not the point.
5. Capture at the device pixel ratio the tool provides. Do not upscale.
6. Review each image after capture. Retake it if the feature is clipped, the data is wrong or private data is visible.
7. Use a dedicated test user with neutral data, such as `dewi.evidence@example.com`, when the browser is signed in as a real person. The sidebar, labels and tables show the account's address. In a development environment, the sign-in code of the test user is in the local mail catcher. Tell the user that you signed their browser out.
8. Size a crop to the whole feature. Check that no column, button or label is cut off at the edge, and move the pointer away from the feature before the capture so that it does not cover text.

## 4) Cover the states that matter

For a change in behavior, capture a before and an after of the same state. For a new feature, capture what a reviewer needs to believe it works:

- the default state,
- the state the PR is about, such as filled, selected or open,
- the empty, loading and error states when the change handles them,
- a narrow viewport when the layout is responsive.

Prefer a few images that each prove something over many that look alike.

## 5) Name and store the files

- Name each file for what it shows, in lowercase with hyphens, such as `course-form-validation-error.png`. Add `-before` and `-after` when comparing.
- Save files in the session scratchpad directory or another location outside the repository. Do not commit screenshots, and do not add them to `docs/` unless the user asks for documentation images.

## 6) Add them to the PR

Every image in a PR must be a `https://github.com/user-attachments/assets/…` URL, which only GitHub's own upload produces.

- Do not host images anywhere else: not in the repository (no commits, branches or custom refs that link `raw` URLs), and not on another service such as an artifact or file host.
- Edit the PR description or post a comment only when the user asks for the PR or its evidence. Outward-facing changes need the user's approval.
- If you cannot upload the images, leave them out and tell the user where the files are.

### Upload with `gh --attach`

Use `gh pr edit --attach` when the GitHub CLI is version 2.99.0 or newer. It needs no browser. Check with `gh --version` and `gh pr edit --help`, which must list `--attach`.

1. Put the images in one directory with plain names. A `#` in a file name is read as the start of the alt text.
2. Write the PR body with a Screenshots section that references each image by the same relative path that you pass to `--attach`. `gh` replaces the reference with the uploaded URL.
3. Run the command from the image directory and name the repository, because the directory is not a clone:

```bash
gh pr edit 29 -R owner/repo --body-file body.md \
  --attach ./channels-empty-state.png \
  --attach ./channels-connected-account.png
```

4. Verify with `gh pr view 29 -R owner/repo --json body -q .body | grep -c 'user-attachments/assets'`. The count must equal the number of images.

Attaching only appends. Running the command again duplicates the images, so to replace one, write the body without its old URL in the same command. Without `--body` or `--body-file`, the existing description is kept and the images are appended at the end. To read the current body for editing, use `gh pr view … --json body -q .body`.

If `gh` is older than 2.99.0, tell the user that upgrading makes this one command, and ask before upgrading it. Do not upgrade it yourself.

### Upload through the browser

This is the fallback for an older `gh`. It needs the user's signed-in GitHub session in the browser. GitHub's file input is created only when the "Paste, drop, or click to add files" button is clicked, so a tool that can fill only an existing `<input type="file">` cannot do it. Use a browser tool that can intercept the file chooser, and stop and tell the user if there is none.

### Layout

Describe each image in one line, in a gallery. Use a table for a before and after pair:

```markdown
### Screenshots

| Before                       | After                      |
| ---------------------------- | -------------------------- |
| ![Before](./form-before.png) | ![After](./form-after.png) |

- **Validation error:** the form shows an inline message when the name is empty.

![Form with a validation error](./form-validation-error.png)
```

## 7) Report

State which images were captured, the viewport, the states covered, and anything not captured and why. If the PR has visible changes with no screenshot, say so.
