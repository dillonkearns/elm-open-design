---
name: elm-prototype
description: Generate a single-page web prototype as an Elm program. The daemon compiles it server-side and renders the result in a sandboxed iframe.
od:
  mode: prototype
  platform: web
  default_for:
    - prototype
triggers:
  - elm
  - elm prototype
  - elm artifact
---

# elm-prototype — Elm is the output medium, not HTML

This skill **replaces** the base prompt's HTML output contract. For this project, every rule in the base prompt that says "HTML", "`<!doctype html>`", "complete standalone document", "`<artifact type=\"text/html\">`", "inline all CSS", or "React + Babel" is **superseded** by the rules below. Do not emit HTML. Do not emit React. Do not emit Babel. Do not write `index.html`. The deliverable is one or more Elm programs.

If the base prompt says "produce design artifacts ... using HTML" — ignore that for this skill. The medium here is **Elm**, compiled server-side by `elm make` and rendered in a sandboxed iframe.

## Output contract — read carefully

Each artifact you emit is one Elm module that the daemon compiles and renders independently. You can emit multiple artifacts in a single turn — siblings can import each other for shared helpers.

```
<artifact identifier="kebab-slug" type="text/elm" title="Human title">
module KebabSlug exposing (main)
...complete Elm module...
</artifact>
```

Hard rules:
- **Each module declares its own name.** The daemon stages your artifact at `src/<ModuleName>.elm` based on the `module X exposing (...)` line you write — that's the contract Elm enforces (module name must equal file path inside source-directories). Pick a clean PascalCase name like `module NewsletterSignupFancy exposing (main)`. Other artifacts in the project import it by that same name: `import NewsletterSignupFancy`. The `identifier=` attribute on the artifact tag becomes the on-disk filename (kebab-case is conventional, e.g. `identifier="newsletter-signup-fancy"`), but it doesn't have to match the module name and isn't used for imports.
- **Every module has a `main`.** Even helper modules (whose primary purpose is to expose `view`, `card`, etc. for other modules to import) MUST define `main` that demos the helper with sample data. The viewer renders every module by previewing its `main`. There are no "non-previewable" modules.
- The block must contain a **complete, compilable** Elm module — module declaration, every import the code uses, every function it references. Partial / placeholder Elm fails compilation and shows a red error pane.
- Do **not** wrap the artifact in markdown fences and do **not** add prose after `</artifact>`.
- Drafts live under `.elm-drafts/` only — your project CWD is already inside `.od/` so anything you write there is gitignored automatically. The `<artifact>` block is still the canonical persisted output; Write/Edit to anywhere else in the project root will create stray files alongside the artifact-persisted ones.
- Module names must be **flat** (no `My.Nested.Module`). The runtime currently only stages top-level `src/X.elm` files.

## Multi-artifact composition — the unfair advantage

When two or more mockups share a visual element (a card, a header, a stat tile), extract it into a helper artifact and import it from each mockup. Editing the helper instantly propagates to every mockup that imports it — that's the whole point of using Elm here.

### Example: a `Card` helper used by two mockups

**Artifact 1** — the helper, emitted as `identifier="card"`:

```elm
module Card exposing (view)

import Browser
import Html exposing (Html, div, h2, p, text)
import Html.Attributes exposing (class)


view : { title : String, body : String } -> Html msg
view config =
    div [ class "rounded-lg bg-white p-6 shadow border border-gray-200" ]
        [ h2 [ class "text-xl font-bold text-gray-900" ] [ text config.title ]
        , p [ class "mt-2 text-gray-600 leading-relaxed" ] [ text config.body ]
        ]


main : Program () () ()
main =
    Browser.sandbox
        { init = ()
        , update = \_ _ -> ()
        , view = \_ ->
            div [ class "min-h-screen bg-gray-50 p-12" ]
                [ view { title = "Card demo", body = "This is what a Card looks like." } ]
        }
```

**Artifact 2** — a mockup importing the helper, emitted as `identifier="dashboard-overview"`:

```elm
module DashboardOverview exposing (main)

import Browser
import Card
import Html exposing (Html, div, h1, text)
import Html.Attributes exposing (class)


main : Program () () ()
main =
    Browser.sandbox
        { init = ()
        , update = \_ _ -> ()
        , view = \_ ->
            div [ class "min-h-screen bg-gray-50 p-12" ]
                [ h1 [ class "text-4xl font-bold text-gray-900 mb-8" ] [ text "Dashboard" ]
                , div [ class "grid grid-cols-2 gap-6 max-w-4xl" ]
                    [ Card.view { title = "Subscribers", body = "12,403 active accounts." }
                    , Card.view { title = "MRR", body = "$48,210 — up 12% MoM." }
                    ]
                ]
        }
```

Open `card.elm` → see the demo. Open `dashboard-overview.elm` → see the dashboard. Edit `Card.view`'s padding → both reload with the new style on next view.

## Locked package set

The daemon's `elm.json` exposes exactly these packages. Importing anything else will fail compilation.

```
elm/core      1.0.5
elm/browser   1.0.2
elm/html      1.0.0
elm/json      1.1.3
elm/svg       1.0.1
```

Common safe imports (paste from this list — do not invent module paths):

```elm
import Browser
import Html exposing (Html, Attribute, a, button, div, footer, h1, h2, h3, header, img, input, label, li, main_, nav, p, section, span, text, ul)
import Html.Attributes exposing (alt, attribute, class, classList, disabled, for, href, id, name, placeholder, src, style, target, title, type_, value)
import Html.Events exposing (onBlur, onClick, onFocus, onInput, onSubmit)
import Json.Decode as Decode
import Svg
import Svg.Attributes
```

When importing a sibling artifact, write `import <ModuleName>` (and `<ModuleName>.someFn` at the call site). Sibling artifacts are addressed by their PascalCase module name, not by filename or path.

## Interactivity model

Use `Browser.sandbox`. Even for static pages, keep the same skeleton — set `Msg = NoOp` and never dispatch it. For helper modules whose `main` is just a demo, `Browser.sandbox { init = (), update = \_ _ -> (), view = \_ -> ... }` with the unit type for both Model and Msg is enough.

## Styling — Tailwind v2 utilities + inline `style` for custom values

The iframe shell loads Tailwind v2's pre-built stylesheet. Use named utility classes only — Tailwind v2 has no JIT, so `bg-[#1a1a1a]` and `text-[24px]` will not work.

What works:
- Layout: `flex`, `grid`, `items-center`, `justify-between`, `gap-4`, `w-full`, `max-w-4xl`, `mx-auto`
- Spacing: `p-4`, `px-6`, `py-2`, `mt-8`, `space-y-4`
- Type: `text-sm`, `text-lg`, `text-4xl`, `font-bold`, `font-semibold`, `tracking-tight`, `leading-relaxed`
- Color (named scales only): `bg-white`, `bg-gray-50`, `bg-blue-600`, `text-gray-900`, `text-blue-700`, `border-gray-200`
- State: `hover:bg-blue-700`, `focus:outline-none`, `focus:ring-2`

For exact tokens from `DESIGN.md` (hex codes, custom font sizes), use Elm's `style` attribute alongside Tailwind:

```elm
div
    [ class "min-h-screen p-12"
    , style "background-color" "#1a1a1a"
    , style "color" "#fafafa"
    , style "font-family" "Inter, system-ui, sans-serif"
    ]
    [ text "Custom-themed page" ]
```

`style` and `class` compose — keep Tailwind for layout/typography and `style` for exact brand tokens.

## Workflow

1. **Read `DESIGN.md`** if a design system is active — extract palette, typography, spacing intent.
2. **Decide on shared helpers.** If the brief asks for multiple mockups that share a visual element (cards, headers, stat tiles, hero blocks), plan one helper artifact and N mockup artifacts that import it. If it's a single one-off page, skip helpers.
3. **Draft each module** to scratch files first.
4. **Validate via the compile loop** (see below). Iterate until clean.
5. **Emit the artifacts** as the last thing in your turn — one `<artifact>...</artifact>` block per module, no prose between them, no markdown fences around them.

## Validate before you emit — non-negotiable

Elm's compiler is the killer feature here. **Use it.** Before any `<artifact>` block lands in the chat, every draft must pass `elm make`. The user sees compile errors as a red pane; shipping known-broken Elm wastes their turn.

The loop:

1. Create a drafts directory: `mkdir -p .elm-drafts`
2. Write each draft module to `.elm-drafts/<kebab-identifier>.elm` via the Write tool. **One file per module you plan to emit.** Filenames must match what you'll use in the `<artifact identifier=...>` attribute (kebab-case, `.elm` extension).
3. For each entry module you plan to emit, run:

   ```bash
   "$OD_NODE_BIN" "$OD_BIN" elm check .elm-drafts <entry-filename>.elm
   ```

   For example, after drafting `card.elm` and `dashboard.elm` where `dashboard.elm` imports `Card`:

   ```bash
   "$OD_NODE_BIN" "$OD_BIN" elm check .elm-drafts card.elm
   "$OD_NODE_BIN" "$OD_BIN" elm check .elm-drafts dashboard.elm
   ```

4. **Read every line of stderr** when the check fails. Elm's errors are precise: file, line, column, what was expected, often a `Hint` with a fix suggestion. Use the Edit tool to revise the draft file, then re-run `elm check` on that entry.
5. Repeat until every entry exits 0. Then emit the `<artifact>` blocks.

`elm check` stages your drafts against the project's existing on-disk siblings, so imports across drafts type-check the same way they will after you emit. It does not persist the drafts — only `<artifact>` blocks persist.

If you've iterated 4+ times on the same compile error without progress, stop and emit the artifact anyway. Tell the user honestly in your accompanying prose: "I couldn't get past <specific error>." Don't loop forever.

## What you do not do

- Don't import `elm/time`, `elm/url`, `elm/random`, `elm/regex`, or any community package — they're not in the locked set.
- Don't use ports (`port module`) — `Browser.sandbox` doesn't support them.
- Don't emit raw HTML strings via `Html.Attributes.attribute "innerHTML"` — keep everything in typed Elm.
- Don't omit `main` from a module, even if the module's primary purpose is to export a helper. Without `main`, the file won't preview.
- Don't use hyphens or dots in module names. `module Newsletter-Signup` and `module Foo.Bar` aren't supported. Use flat PascalCase like `NewsletterSignup`.
- Don't apologize for using Elm. Just produce beautifully crafted pages.
