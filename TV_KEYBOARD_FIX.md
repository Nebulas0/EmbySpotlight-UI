# TV Keyboard Handling — Future Fix

## Problem
Emby's own keyboard handlers may intercept arrow keys and other remote control
buttons before our spotlight keyboard handler receives them. This could prevent
D-pad navigation from working on TV devices.

## Solution (3 techniques, use all together)

### 1. Capture phase
Switch from bubble phase to capture phase so our handler fires BEFORE Emby's:

```javascript
// Current (bubble phase — fires after Emby):
document.addEventListener("keydown", keyboardHandler);

// Fixed (capture phase — fires before Emby):
document.addEventListener("keydown", keyboardHandler, true);
```

Capture phase always fires before bubble phase regardless of handler
registration order. This is the most important fix.

### 2. stopPropagation() after handling
Currently we call `e.preventDefault()` but not `e.stopPropagation()`.
`preventDefault` stops the browser default action, but the event still
propagates to Emby's handlers. Add `e.stopPropagation()` for keys we handle:

```javascript
if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); currentIndex--; animate(); }
```

Only call `stopPropagation()` for keys we actually handle (arrows, enter,
space, escape when spotlight is visible). Don't block keys we don't handle.

### 3. Only intercept when spotlight is visible
The existing check already does this:
```javascript
if (rect.bottom < 0 || rect.top > window.innerHeight) return;
```

This ensures we don't break Emby's navigation when the user has scrolled
down to "My Media" or other sections. Keep this check.

## When to implement
Test on an actual TV first. If arrow keys / D-pad don't work in the
spotlight on TV, apply these three fixes. Desktop should be unaffected
since capture phase + stopPropagation only matter when there's a
conflicting handler.
