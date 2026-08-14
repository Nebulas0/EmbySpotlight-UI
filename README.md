# EmbySpotlight-UI

Netflix-style spotlight slider for Emby Server, loaded via the
[Emby.CustomCssJS](https://github.com/MediaBrowser/Emby.Plugins) plugin.

## Files

| File | Description |
|------|-------------|
| `SpotlightPro.js` | Base spotlight implementation (no trailer support) |
| `SpotlightPro-trailer.js` | Full version with inline YouTube trailer player, TV/remote support, custom seek bar |
| `SpotlightPro-trailer-notv.js` | Backup of the trailer version before TV support was added |
| `Spotlight.js` | Original simple spotlight (legacy) |
| `TV_KEYBOARD_FIX.md` | Notes for future TV keyboard handling fix |

## Features

### Spotlight
- Randomized initial load from large Emby libraries (single API query with random startIndex)
- Year-descending sort + random window selection
- Excludes watched items (`IsPlayed: false`)
- Background batch fetching (250 items per batch)
- Preload next group near end of current group
- Cycle through additional items (no repeats)
- Progressive image loading (800px first, upgrades to 1280px)
- Slide counter (e.g. "3 / 10")
- Dot navigation indicators
- Autoplay with configurable interval
- Progress bar showing autoplay timing

### Visual Enhancements
- Ken Burns effect (randomized pan + zoom) — disabled on TV
- Frosted glass blur behind info text — disabled on TV
- Crossfade transitions between batch swaps — disabled on TV
- Clickable genre chips
- Play button (links to Emby item page)
- Favorite button (toggles favorite state)
- Logo/title/overview/tagline with show/hide on click

### Trailer Player (SpotlightPro-trailer.js)
- Trailer button only shown when current item has `RemoteTrailers` metadata
- Button visibility updates per-slide (not just first load)
- Inline YouTube playback using the **YouTube IFrame Player API**
- Replaces the spotlight backdrop when playing
- Hides logo, info, gradients, overlays, and spotlight buttons during playback
- Custom controls (top-right, show on hover):
  - Mute / Unmute
  - Fullscreen
  - Close (X)
- Custom seek bar (red, bottom of trailer):
  - Polls `getCurrentTime()` / `getDuration()` every 250ms
  - Click/tap to seek via `seekTo()`
  - Desktop: shows on hover
  - Mobile: shows on touch, auto-hides after 3 seconds
- YouTube's own controls hidden (`controls=0`, `iv_load_policy=3`, `fs=0`)
- Contain mode: iframe fills container, YouTube handles 16:9 letterboxing
- Auto-stop when trailer ends (`onStateChange` state 0)
- Autoplay and progress bar paused during trailer, resumed on close
- Trailer stopped on slide change and spotlight cleanup
- Per-user enable/disable via `localStorage` key `spotlight-trailers-enabled`

### TV / Remote Control Support
- Auto-detects TV via user agent (Android TV, Tizen, webOS, Bravia, etc.)
- Disables heavy animations (Ken Burns, crossfade, blur) for smoother playback
- D-pad navigation:
  - Left/Right: navigate slides (spotlight) or controls (trailer)
  - Up/Down: move focus between buttons
  - Enter/OK: activate focused button or play trailer
  - Escape/Back: close trailer first
- All buttons get `tabindex=0` and white focus outline
- Buttons always visible on TV (no hover)
- Auto-focus play button on load
- Autoplay pauses when button is focused, resumes on blur
- See `TV_KEYBOARD_FIX.md` for future keyboard handling improvements

### Mobile Responsive
- Buttons shrink to 40px, positioned at corners
- Buttons always visible (no hover on mobile)
- Spotlight container 94% width with border radius
- Banner height adjusted for small screens
- Genre/meta text scaled down
- Trailer controls always visible when playing
- Seek bar shows on touch, auto-hides after 3 seconds
- Touch swipe navigation

## Configuration

Key config values in `SpotlightPro-trailer.js`:

```javascript
imageWidth: 1280,          // Full-res image width
preloadWidth: 1280,        // Preload image width
limit: 10,                 // Items per group
autoplayInterval: 8000,    // Slide duration (10000 on TV)
libraryId: 2310256,        // Emby library ID
spotlightBatchSize: 250,   // Background batch size
unplayedOnly: true,        // Exclude watched items
enablePreloading: true,    // Preload next group
enableKenBurns: true,      // Pan+zoom effect (false on TV)
enableBlurBackdrop: true,  // Frosted glass (false on TV)
enableCrossfade: true,     // Transition effect (false on TV)
enableTrailers: true,      // Trailer button + player
trailerStartMuted: false,  // Start trailers muted
```

## Deployment

### Via Emby.CustomCssJS plugin
1. Copy the JS content into a CustomCssJS JavaScript entry named `spotlight-pro-trailer`
2. Ensure XML-escaping: `&&` → `&amp;&amp;`, `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`
3. Restart Emby to reload the plugin configuration
4. Hard-refresh the Emby web client

### Direct XML deployment
The XML config file is at:
`/config/plugins/configurations/Emby.CustomCssJS.xml` (inside the Emby container)

## Architecture

```
MQTT event → ZenLocalPoller → rclone cache refresh
  → Autoscan (unionfs path) → Emby scan
  → strm-bridge → STRM sync → Autoscan (strm path) → Emby scan

SpotlightPro-trailer.js (this repo)
  → Emby.CustomCssJS plugin → Emby web client
  → Fetches items from Emby API
  → Displays spotlight slider with trailers
```

## AI Notes

### How the trailer system works
1. `buildQuery()` includes `RemoteTrailers` in the Emby API fields
2. `createBannerElement()` extracts the YouTube video ID from `RemoteTrailers[0].Url`
3. The video ID is stored in `dataset.trailerId` on the banner item
4. `updateTrailerButtonVisibility()` checks `dataset.trailerId` and shows/hides the trailer button
5. `startTrailer()` creates a `YT.Player` instance using the YouTube IFrame Player API
6. `onReady` sets mute/volume and starts seek bar polling
7. `onStateChange` detects when the trailer ends (state 0) and calls `stopTrailer()`
8. `stopTrailer()` destroys the player, removes the iframe, and resumes autoplay

### YouTube IFrame Player API
- Loaded via `https://www.youtube.com/iframe_api` on script init
- `YT.Player` replaces the trailer-container element with an iframe
- Provides proper methods: `mute()`, `unMute()`, `setVolume()`, `getDuration()`, `getCurrentTime()`, `seekTo()`, `destroy()`
- Fallback to simple iframe embed if API not yet loaded (first load)

### Performance optimizations
- Single API query with random startIndex (no double fetch)
- Progressive image loading (800px first, 1280px upgrade)
- Skip `preloadImages()` for initial load (progressive loading in DOM)
- Reduced image width (1280px vs 1900px)
- Background batch fetching (250 items, async)
- Preload next group at slide 8

### Known limitations
- YouTube `showinfo=0` is deprecated (2018) — video title may still show
- YouTube `controls=0` hides all native controls — custom seek bar required
- Contain mode may show black bars (16:9 vs spotlight aspect ratio)
- TV keyboard handling may conflict with Emby's own handlers (see `TV_KEYBOARD_FIX.md`)
- `YT.Player` sets inline width/height on iframe — overridden with `!important` CSS and `onReady` style reset
