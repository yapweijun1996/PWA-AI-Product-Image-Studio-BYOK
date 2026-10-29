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

- Change build identity for every release; worker revalidation must discover updates. A controlled navigation uses its active worker's cached HTML so it cannot mix a newer shell with older hashed assets while an update waits. Precache only static app shell, never `/api/*`, Images API, source images or seller-authenticated material.
- N to N+1: new worker waits; app shows visible `New version available`; user chooses `Update now`; save local drafts/masks and pending transactions; show loader; message `SKIP_WAITING` to waiting worker; await controllerchange; reload after activation; error/timeout recovery visible.
- Do not automatically force reload while user edits a mask. Test update from two actual builds, not by clicking simulated button.
- Clean old versioned caches on activation; keep HTML and hashed assets from the same active build; exclude sensitive routes.

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
