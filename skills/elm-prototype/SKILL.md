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

This skill **replaces** the base prompt's HTML output contract. For this project, every rule in the base prompt that says "HTML", "`<!doctype html>`", "complete standalone document", "`<artifact type=\"text/html\">`", "inline all CSS", or "React + Babel" is **superseded** by the rules below. Do not emit HTML. Do not emit React. Do not emit Babel. Do not write `index.html`. The deliverable is an Elm program.

If the base prompt says "produce design artifacts ... using HTML" — ignore that for this skill. The medium here is **Elm**, compiled server-side by `elm make` and rendered in a sandboxed iframe.

## Output contract — read carefully

Emit exactly one artifact block at the end of your turn:

```
<artifact identifier="kebab-slug" type="text/elm" title="Human title">
module Main exposing (main)
...complete Elm program...
</artifact>
```

Hard rules:
- The block must contain a **complete, compilable** Elm program — module declaration, every import the code uses, every function it references, ending at the last line of `view`. The daemon shells out to `elm make` against this exact source; partial / placeholder Elm will fail compilation and show a red error pane to the user.
- Do **not** wrap the artifact in markdown fences and do **not** add prose after `</artifact>`.
- Do **not** write `.elm` files to disk through Write/Edit tools. The artifact body is the deliverable.

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

## Interactivity model

Always use `Browser.sandbox`. Even for static pages, keep the same skeleton — set `Msg = NoOp` and never dispatch it. Uniformity beats per-brief judgment.

## Canonical skeleton — copy this verbatim, then fill `view`

```elm
module Main exposing (main)

import Browser
import Html exposing (Html, div, h1, p, text)
import Html.Attributes exposing (class, style)


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , update = update
        , view = view
        }


type alias Model =
    {}


type Msg
    = NoOp


init : Model
init =
    {}


update : Msg -> Model -> Model
update _ model =
    model


view : Model -> Html Msg
view _ =
    div [ class "min-h-screen bg-gray-50 p-12" ]
        [ h1 [ class "text-4xl font-bold text-gray-900" ] [ text "Title" ]
        , p [ class "mt-4 text-lg text-gray-600" ] [ text "Body copy." ]
        ]
```

For any interactive widget (a counter, a toggle, a form), add cases to `Msg`, extend `Model`, and handle them in `update`. **Do not** switch to `Browser.element` for v1.

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
2. **Plan briefly in prose** — no TodoWrite needed for a single-file prototype.
3. **Write the Elm program** in your response. Start from the canonical skeleton, expand `view`, add `Msg` / `Model` cases only if the brief actually needs interactivity.
4. **Emit the artifact** as the last thing in your turn:

   ```
   <artifact identifier="..." type="text/elm" title="...">
   module Main exposing (main)
   ...
   </artifact>
   ```

## What you do not do

- Don't import `elm/time`, `elm/url`, `elm/random`, `elm/regex`, or any community package — they're not in the locked set.
- Don't use ports (`port module`) — `Browser.sandbox` doesn't support them.
- Don't emit raw HTML strings via `Html.Attributes.attribute "innerHTML"` — keep everything in typed Elm.
- Don't ship multiple files. The artifact body IS the program.
- Don't apologize for using Elm. Just produce a beautifully crafted page.
