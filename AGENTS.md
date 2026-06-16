# AbilityMade Project Notes

## Project Overview

AbilityMade is a small static marketing and storefront prototype for functional gifts, homeware, workshops, and corporate gifting featuring artwork by disabled artisans.

The site currently has two language variants:

- `index.html`: English page.
- `index-zh.html`: Simplified Chinese page.

Both pages share the same visual system and layout through `style.css`.

## Technology Stack

- Plain HTML, CSS, and a small amount of inline JavaScript.
- No package manager, framework, bundler, or build step is currently present.
- The site can be opened directly from the HTML files in a browser.
- Static images live under `assets/images/`.

## Key Files

- `README.md`: Minimal repository placeholder.
- `index.html`: English landing/storefront page.
- `index-zh.html`: Chinese landing/storefront page.
- `style.css`: Shared styling, responsive layout, color tokens, and component styles.
- `assets/images/`: Product, workshop, artisan, and frame clutch imagery.
- `.gitignore`: Ignores `.DS_Store`.

## Page Structure

The main pages include:

- A top partner strip linking to story, artists, and corporate sections.
- A delivery notice strip.
- A sticky header with logo, search field, navigation links, cart icon, and account icon.
- A hero banner for a June holiday craft workshop.
- A workshop image strip using images from `assets/images/`.
- A new arrivals product grid.
- A category selector.
- A hidden `Frame Clutch Purse` merchandise listing that appears when the matching category tab is clicked.
- Story, artists, workshops, and corporate gifting sections.
- Newsletter signup.
- Footer navigation.
- Cookie notice banner.

## Current JavaScript Behavior

Each HTML page has inline JavaScript at the bottom of the file.

The script:

- Selects all `.category-tab` buttons.
- Shows `#frame-clutch-products` only when the tab with `data-category="frame-clutch"` is clicked.
- Applies the `.active` class to the selected tab.
- Smooth-scrolls the frame clutch product section into view when it becomes visible.

There is no current cart, search, newsletter, cookie, or sorting implementation beyond static UI.

## Styling Notes

`style.css` defines a warm, craft-oriented visual direction using CSS custom properties:

- White and cream surfaces.
- Sand and soft blue highlight bands.
- Deep green brand color.
- Terracotta accent color.
- 8px standard radius through `--radius`.

Layout is mostly CSS Grid and Flexbox. The site is responsive with breakpoints at:

- `max-width: 980px`
- `max-width: 640px`

Important layout patterns:

- Header uses a grid on desktop and collapses to one column on narrower screens.
- Product grids move from four columns to two columns and then one column.
- The workshop image strip becomes horizontally scrollable on mobile.
- The cookie banner changes from a horizontal fixed bar to compact mobile layout.

## Content and Localization

The English and Chinese pages are separate files. When changing visible content, keep both pages in sync unless the task explicitly targets only one language.

Some category labels and merchandise product text in `index-zh.html` are still English, especially inside the frame clutch listing. This may be intentional placeholder content, but check before assuming it should remain mixed-language.

## Asset Notes

Current image assets include:

- Artisan and workshop photos.
- Beaded baskets and flower displays.
- Framed handmade artwork.
- Frame clutch purse product photos.

Use existing images from `assets/images/` when possible. Keep image references relative to the HTML files, for example:

```html
<img src="assets/images/example.jpg" alt="Descriptive alt text">
```

When adding new images, place them under `assets/images/` and use descriptive filenames and alt text.

## Development Workflow

Because this is a static site, basic verification can be done by opening:

- `index.html`
- `index-zh.html`

There is no automated test suite configured.

Before editing, check the working tree because this repository may contain user changes:

```sh
git status --short
```

## Repository Safety Rules

Do not bulk-delete files or directories.

Do not use:

- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`
- `rm -rf`

When deleting files, delete only one file with one explicit path at a time. If bulk deletion is needed, stop and ask the user to delete the files manually.

## Maintenance Guidance for Future Agents

- Preserve the static HTML/CSS architecture unless the user asks for a framework or build system.
- Keep shared visual changes in `style.css`.
- Keep English and Chinese pages structurally aligned.
- Maintain accessibility details such as labels, `aria-label` values, and meaningful image alt text.
- Avoid unrelated refactors; the project is small and direct edits are easier to review.
- Do not overwrite or revert existing user changes without explicit instruction.
