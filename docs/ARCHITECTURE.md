# Architecture Notes

## High-level modules

- `src/background`: extension lifecycle and service worker routing.
- `src/popup`: launch surface, actions, settings and i18n controls.
- `src/workspace`: main PDF editing UI and interaction flow.
- `src/services`: PDF and storage services.
- `src/shared`: cross-module contracts, protocols and typed errors.

## Main runtime flow

1. User opens popup and starts a PDF action.
2. Workspace loads the PDF renderer and fabric overlay.
3. User applies annotations and shape operations.
4. Export path flattens canvas objects into final PDF output.
5. Export metadata and recoverable artifacts are persisted locally.

## Data and persistence

- Lightweight state and preferences: `chrome.storage.local`.
- Recoverable history blobs: IndexedDB via storage service layer.

## Design principles

- Keep core editing local-first.
- Isolate rendering from interaction logic.
- Use explicit contracts for messaging between contexts.
- Avoid monolithic files and keep features modular.
