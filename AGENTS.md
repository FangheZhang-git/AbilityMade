# AbilityMade Project Notes

## Project Overview

AbilityMade is a small static bilingual storefront prototype for handmade functional gifts, craft objects, and artwork-based products created by disabled artisans.

The site currently has two language variants:

- `index.html`: English page.
- `index-zh.html`: Simplified Chinese page.

Both pages share the same visual system, layout, responsive rules, cart drawer styling, and cookie banner styling through `style.css`.

## Technology Stack

- Plain HTML, CSS, and inline JavaScript.
- No framework, bundler, package manifest, or formal build step is currently part of the tracked project.
- The pages can be opened directly from the HTML files in a browser.
- Static images live under `assets/images/`.
- `api/` currently exists as an empty directory.
- `node_modules/` may be present locally and untracked; do not assume it is intentional project source unless a package manifest or user instruction says so.

## Key Files and Directories

- `README.md`: Minimal repository placeholder.
- `AGENTS.md`: This maintenance guide for future agents.
- `.gitignore`: Currently ignores `.DS_Store`.
- `index.html`: English landing/storefront page.
- `index-zh.html`: Simplified Chinese landing/storefront page.
- `style.css`: Shared styling, responsive layout, color tokens, product grid styling, cart drawer styling, and cookie banner styling.
- `assets/images/`: Product, workshop, artisan, beaded item, diamond painting, frame clutch, and hero collage imagery.
- `api/`: Empty at the time of this update.

## Current Page Structure

The main pages include:

- A delivery notice strip.
- A sticky header with AbilityMade logo, search field, navigation links, cart icon with count, and account icon.
- A cart overlay and slide-out cart drawer.
- A story section with long-form mission copy and a workshop hero collage image.
- A shop category selector.
- Product sections for:
  - Frame Clutch Purse.
  - Diamond Painting.
  - Beaded Sculpture.
  - Beaded Bracelet.
- Newsletter signup.
- Footer with contact information.
- Cookie notice banner with customizable preferences.

Older sections such as the top partner strip, workshop image strip, new arrivals grid, artist feature panels, and corporate gifting panels are not present in the current HTML files.

## Current JavaScript Behavior

Each HTML page has inline JavaScript at the bottom of the file.

The script currently handles:

- Category tab selection for all products and individual product categories.
- Showing all merchandise sections or only the selected category section.
- Updating `.active` and `aria-pressed` state on category tabs.
- Smooth-scrolling to the relevant merchandise section.
- Building a product catalog from `.merchandise-card` elements.
- Adding products to a cart stored in `localStorage` under `abilitymade-cart-v1`.
- Opening and closing the cart drawer through cart links, overlay clicks, close buttons, and the Escape key.
- Rendering cart rows with image, title, artist, price, quantity controls, remove controls, subtotal, item count, and free-delivery progress.
- Clamping cart quantities between 1 and 99 when loading saved cart data, and between 0 and 99 during updates.
- Saving cookie preferences in `localStorage` under `abilitymade-cookie-consent-v1`.
- Accepting all cookies, declining optional cookies, or saving custom statistics/marketing preferences.

Search, newsletter submission, account navigation, checkout/payment, and server-side APIs are not currently implemented.

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

- Header uses a desktop grid and collapses to one column on narrower screens.
- Product grids move from four columns to two columns and then one column.
- The cart drawer is fixed to the right side of the viewport and uses a full-screen overlay.
- The cookie banner changes from a horizontal fixed bar to compact mobile layouts.
- Product images use fixed aspect ratios and `object-fit: cover`.

## Content and Localization

The English and Chinese pages are separate files. When changing visible content, keep both pages in sync unless the task explicitly targets only one language.

The Chinese page is partly localized, but some product titles, artist names, descriptions, prices, and button text remain in English, especially in merchandise listings. Confirm with the user before assuming this mixed-language content should be fully translated.

Both pages currently use USD prices and a US English `Intl.NumberFormat` currency formatter.

## Asset Notes

Current image assets include:

- Workshop and artisan photos.
- A workshop hero collage: `abilitymade-workshop-hero-collage.jpg`.
- Beaded baskets, flower displays, sculptures, and shell bracelets.
- Diamond painting product images.
- Frame clutch purse product images.

Use existing images from `assets/images/` when possible. Keep image references relative to the HTML files, for example:

```html
<img src="assets/images/example.jpg" alt="Descriptive alt text">
```

When adding new images, place them under `assets/images/` and use descriptive filenames and alt text.

Some JPEGs contain camera EXIF/GPS metadata. If publishing externally, consider whether metadata should be stripped, but do not bulk-process or delete files without explicit user approval.

## Development Workflow

Because this is a static site, basic verification can be done by opening:

- `index.html`
- `index-zh.html`

There is no automated test suite configured.

Before editing, check the working tree because this repository may contain user changes:

```sh
git status --short
```

When verifying behavior manually, check at minimum:

- Category tabs show the correct product sections.
- Add-to-cart opens the drawer and updates quantity/count/subtotal.
- Cart quantity increment, decrement, and remove controls work.
- Cart state persists after refresh.
- Cookie accept, decline, customize, and save actions hide the banner and persist preferences.
- English and Chinese pages remain structurally aligned.
- Mobile widths around 980px and 640px still avoid overlapping text or controls.

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

- Preserve the static HTML/CSS architecture unless the user asks for a framework, build system, or backend.
- Keep shared visual changes in `style.css`.
- Keep English and Chinese pages structurally aligned.
- Maintain accessibility details such as labels, `aria-label` values, `aria-pressed`, and meaningful image alt text.
- Be careful with inline JavaScript duplicated between the two HTML files; when changing cart, category, or cookie behavior, update both pages.
- Avoid unrelated refactors; the project is small and direct edits are easier to review.
- Do not overwrite or revert existing user changes without explicit instruction.
- Do not delete `node_modules/` or other untracked files unless the user explicitly asks, and follow the deletion safety rules above.
