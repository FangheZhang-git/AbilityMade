# AbilityMade Project Notes

## Project Overview

AbilityMade is a small bilingual storefront for handmade functional gifts, craft objects, and artwork-based products created by disabled artisans. The frontend remains plain HTML/CSS/JavaScript, while a small Node.js server provides static hosting and Resend-backed form APIs.

The site currently has two language variants:

- `index.html`: English page.
- `index-zh.html`: Simplified Chinese page.

Both pages share the same visual system, layout, responsive rules, cart drawer styling, newsletter styling, and checkout styling through `style.css`.

## Technology Stack

- Plain HTML, CSS, and inline JavaScript on the frontend.
- A dependency-free Node.js 20+ HTTP server in `server.js` serves files and handles backend routes.
- `package.json` provides `npm start` and `npm test`; there is no bundler or framework build step.
- Resend stores newsletter contacts, sends newsletter confirmations, sends host notifications, and delivers purchase-request emails.
- Production is hosted on Railway at `https://abilitymade.net` and is connected to the GitHub `main` branch.
- Static images live under `assets/images/`.
- Do not use VS Code Live Server to test APIs; it only serves static files and returns 405 for POST routes.

## Key Files and Directories

- `README.md`: Local development, Resend configuration, and newsletter Broadcast instructions.
- `AGENTS.md`: This maintenance guide for future agents.
- `.gitignore`: Currently ignores `.DS_Store`.
- `index.html`: English landing/storefront page.
- `index-zh.html`: Simplified Chinese landing/storefront page.
- `our-story-in-full.html` / `our-story-in-full-zh.html`: Full English and Chinese mission/story pages.
- `checkout.html`: Purchase-request form populated from the cart handoff stored in `localStorage`.
- `server.js`: Static server plus purchase-request and newsletter API routes.
- `server.test.js`: Node built-in tests with mocked Resend responses.
- `package.json`: Node 20+ runtime and start/test scripts; there are no third-party dependencies.
- `style.css`: Shared styling, responsive layout, color tokens, product grid, cart drawer, newsletter, and checkout styling.
- `assets/images/`: Product, workshop, artisan, beaded item, diamond painting, frame clutch, and hero collage imagery.
- `favicon.ico`: Root favicon fallback; PNG and Apple touch variants live under `assets/images/`.

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
- A separate purchase-request page reached from the cart.
- Separate full-story pages in both languages.

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
- Saving the cart handoff for `checkout.html` under `abilitymade-checkout-request-v1`.
- Opening product-name searches in a new storefront tab, filtering matching cards from the `search` URL parameter, and restoring normal browsing when a category is selected.
- Submitting newsletter emails to `/api/newsletter-subscribe` with a fixed page locale and a hidden honeypot.
- Displaying localized pending, success, validation, rate-limit, and service-error states for newsletter signup.

`checkout.html` submits customer/cart details to `/api/purchase-request`. Account navigation and online payment are not implemented; checkout is currently a purchase request followed by manual contact.

## Server and Email Behavior

`server.js` uses only Node built-ins and the global Node 20 `fetch` implementation. It provides:

- Static file serving with explicit content types, including `image/x-icon` for `/favicon.ico`.
- `POST /api/purchase-request`: validates customer details and sends the request to `PURCHASE_REQUEST_TO` through Resend.
- `POST /api/newsletter-subscribe`: validates/normalizes email, applies an in-memory per-address rate limit, ignores honeypot submissions, and creates or restores a Resend contact in `RESEND_NEWSLETTER_SEGMENT_ID`.
- Newsletter confirmation emails in English or Chinese based on the source page.
- A new-subscriber notification to the host inbox containing email, page language, and signup time.
- Non-blocking confirmation delivery: once the contact is saved, email failures are logged but the signup still returns success.
- `POST /api/create-checkout-session`: intentionally returns 503 because online checkout is disabled.

Required production environment variables:

- `RESEND_API_KEY`: full-access key so the server can send email and manage contacts.
- `RESEND_NEWSLETTER_SEGMENT_ID`: Resend segment used for newsletter subscribers and Broadcasts.
- `PURCHASE_REQUEST_FROM`: verified Resend sender used by purchase requests and newsletter confirmations.
- `PURCHASE_REQUEST_TO`: host inbox; defaults to `AbilityMade@gmail.com`.

Never expose API keys in HTML, browser JavaScript, screenshots, commits, or chat messages.

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
- Newsletter controls stack vertically at the mobile breakpoint.
- The checkout request panel and navigation adapt to narrow screens.
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
- Browser icon variants: root `favicon.ico`, 32px and 192px PNG icons, and a 180px Apple touch icon.

Use existing images from `assets/images/` when possible. Keep image references relative to the HTML files, for example:

```html
<img src="assets/images/example.jpg" alt="Descriptive alt text">
```

When adding new images, place them under `assets/images/` and use descriptive filenames and alt text.

Some JPEGs contain camera EXIF/GPS metadata. If publishing externally, consider whether metadata should be stripped, but do not bulk-process or delete files without explicit user approval.

## Development Workflow

Use Node.js 20 or newer. Start the site from the repository root:

```sh
npm start
```

Open `http://localhost:3000`. Do not use `127.0.0.1:5500` or VS Code Live Server when testing purchase or newsletter forms because those routes require `server.js`.

Run the built-in test suite with:

```sh
npm test
```

`server.test.js` binds an ephemeral localhost port and mocks Resend. It verifies new and repeat newsletter subscriptions, English/Chinese confirmations, non-blocking delivery failures, locale validation, and favicon serving without sending real email.

Before editing, check the working tree because this repository may contain user changes:

```sh
git status --short
```

When verifying behavior manually, check at minimum:

- Category tabs show the correct product sections.
- Product searches from all English and Chinese pages open a new tab, match partial product names, preserve the page position while typing, and show localized empty-result messages.
- Add-to-cart opens the drawer and updates quantity/count/subtotal.
- Cart quantity increment, decrement, and remove controls work.
- Cart state persists after refresh.
- Checkout handoff populates `checkout.html`, and a configured server can submit a purchase request.
- Newsletter signup shows localized states and saves the contact in the configured Resend segment.
- Subscriber and host confirmation emails are sent for both new and repeat signups.
- `/favicon.ico` and PNG/Apple icons load with successful responses and correct content types.
- English and Chinese pages remain structurally aligned.
- Mobile widths around 980px and 640px still avoid overlapping text or controls.

For production, push reviewed changes to `main` and confirm Railway completes its deployment. Railway environment-variable edits remain staged until explicitly deployed. After email changes, use a controlled real address to verify the Resend contact, subscriber confirmation, host notification, and purchase-request flow.

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

- Preserve the plain HTML/CSS/inline-JavaScript frontend and small Node server unless the user asks for a framework or larger backend.
- Keep shared visual changes in `style.css`.
- Keep English and Chinese pages structurally aligned.
- Maintain accessibility details such as labels, `aria-label` values, `aria-pressed`, and meaningful image alt text.
- Be careful with inline JavaScript duplicated between the two main pages; when changing cart, category, or newsletter behavior, update both pages.
- Treat newsletter contact persistence as the primary success condition; confirmation-email failures are intentionally non-blocking and should remain logged server-side.
- Use Resend Broadcasts with the newsletter segment and an unsubscribe link for marketing sends; do not send bulk campaigns through the transactional confirmation endpoint.
- Keep favicon declarations aligned across both main pages, both full-story pages, and `checkout.html`.
- Avoid unrelated refactors; the project is small and direct edits are easier to review.
- Do not overwrite or revert existing user changes without explicit instruction.
- Do not delete `node_modules/` or other untracked files unless the user explicitly asks, and follow the deletion safety rules above.
