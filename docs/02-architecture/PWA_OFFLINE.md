# PWA Offline, Service Worker and iOS Standard

**Normative skill:** KB-MCP `pwa:product-standard` v1.0.0; updated releases must consult current approved skill.

## Offline matrix

| Feature | Offline | Basis / boundary |
|---|---|---|
| Launch app shell and navigation | YES | precached versioned JS/CSS/icons only |
| View existing local product/photo/projects | YES, if local data retained | IndexedDB, not HTTP cache |
| Crop, manual mask and composite locally | YES, subject to device capacity | canvas worker and local assets |
| Inspect existing QA/report and export ZIP | YES | local computation |
| Connect BYOK, check provider, new AI generation | NO | requires authenticated network provider |
| Remote sync or shop publishing | NOT IN P0 | do not queue phantom success |

## Service Worker contract

The current app loads product details and backup import as separate route modules. The built worker precaches those modules with the rest of the static shell; a missing route module shows a recoverable page error and never silently reloads. A synthetic Chromium check covers offline first access after installation, but installed-device and two-build old-tab acceptance remain open. See [T-010 / T-011 / T-080](../08-delivery/TASK.md#t-010--t-011--t-080-route-loading-and-offline-follow-up--2026-10-31).

- Change build identity for every release; worker revalidation must discover updates. A controlled navigation normally uses its active worker's cached HTML to keep the shell with its hashed assets while an update waits; if that cache entry is missing, the current worker falls back to the network. The local development gateway snapshots one completed build at startup and requires a restart to serve another; this is not a production deployment guarantee. Precache only static app shell, never `/api/*`, Images API, source images or seller-authenticated material.
- N to N+1: new worker waits; app shows visible `New version available`; user chooses `Update now`; save local drafts/masks and pending transactions; show loader; message `SKIP_WAITING` to waiting worker; await controllerchange; reload after activation; error/timeout recovery visible. Recheck unsaved state before activation and again before reload: if a draft appears while activation is in flight, retain it and offer an explicit reload when ready.
- Do not automatically force reload while user edits a mask. Test update from two actual builds, not by clicking simulated button.
- Retain older versioned static-shell caches across activation so an already open tab can still fetch its hashed assets. The worker pauses installation at its cache limit and offers explicit cleanup only when supported, after the user closes other app tabs and saves work. Cleanup must not remove the active shell or product data; when Web Locks are unavailable it fails closed. Cached assets may still be evicted by the browser, so full offline and cross-tab behavior requires device verification. Exclude sensitive routes.

## iOS-first requirements

- Set manifest `display=standalone`, suitable icons, theme/background colors, start URL and scope per deployed origin.
- Use `viewport-fit=cover`; intentional solid top/status-bar surface in light/dark mode; `env(safe-area-inset-*)` paddings.
- Minimum 16px input text on iOS to reduce focus-zoom; ~44px targets, keyboard reachability, reduced-motion.
- Smart hide/reveal top bar and contextual scroll-to-top only where relevant to long screens; avoid scroll jitter/layout shifts.
- No landscape overflow at 320 CSS px; proper screen-reader labels on icon-only actions and change announcements.
- Plan WebKit/iOS installed-mode *real device* testing; desktop simulator is not complete proof.

## Storage / resilience

- Ask `navigator.storage.persist()` when available, but this is not guaranteed; show used/available storage and offer backup.
- Quota failure: atomic transaction rollback + guidance to export and delete old images; never silently drop the original.
- First-load offline is not guaranteed until installation/service-worker cache is established. Test fresh-install offline separately from returning-user offline.

## QA gate

`E2E-018..020` must capture offline navigation, local editing, refresh and backup, worker update UX, safe areas, dark/light chrome, keyboard navigation, no horizontal overflow and screen reader basics. All PWA assertions PENDING until tested.
