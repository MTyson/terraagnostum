# Technical Specification: Reality Consensus v0.2.1

## Overview
Shift the game's visual generation model from user-specific local images to a global "Fluid Consensus" model where generation is free for all, but "Anchoring" (locking) reality is a premium power.

## 1. Global Consensus (Guest Uploads)
**Target:** [`js/visualSystem.js`](js/visualSystem.js)

- **Modification:** Remove the `user.isAnonymous` guard in `triggerVisualUpdate` that prevents uploading to Firebase.
- **Outcome:** Every time a user (Guest or Architect) generates an image for a room that isn't "Pinned", it updates the room's global `storedImageUrl` in Firestore.
- **Lore Log:** `[SYSTEM]: Observation confirmed. Local wave function collapsed into consensus reality.`

## 2. Reality Anchoring (The Pinning Power)
**Target:** [`js/visualSystem.js`](js/visualSystem.js)

- **Logic Update:** `triggerVisualUpdate` must check for `room.pinnedView` at the start.
- **Precedence:** If `pinnedView` is set:
    - Automatically load `pinnedView` instead of `storedImageUrl`.
    - Block any new generation attempts by Guests.
    - Message: `[SYSTEM]: This sector is anchored by an Architect. Reality is immutable here.`
- **Architect Privilege:** Architects can still "Unpin" or "Refine" a pinned room.

## 3. Image Refinement (Img2Img)
**Target:** [`api/image.js`](api/image.js)

- **Capability:** Update the Imagen 4 Fast payload to support an `image` parameter for image-to-image refinement.
- **Payload Structure:**
  ```json
  {
    "instances": [
      {
        "prompt": "new prompt",
        "image": { "bytesBase64Encoded": "..." }
      }
    ]
  }
  ```

**Target:** [`js/visualSystem.js`](js/visualSystem.js)

- **New Function:** `refineVisual(newPrompt)`
- **Logic:** Captures the current `canvas` content as base64 and sends it to `apiService.projectVisual` along with the new prompt.

## 4. UI/UX Enhancements
**Target:** [`js/ui.js`](js/ui.js)

- **Context Commands:** Add `Refine Reality` as a contextual suggestion when a room image is present.
- **Status Indicator:** Add a small "⚓" (Anchor) icon or "[ ANCHORED ]" tag to the visual overlay when `pinnedView` is active.

## 5. Metadata Update
- **Version:** Increment UI version to `0.2.1`.
