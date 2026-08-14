/*!
 * SpotlightPro-trailer.js — SpotlightPro + Netflix-style inline trailers
 * Based on Spotlight.js v6 with the following visual enhancements:
 *   1. Autoplay progress bar (thin bar at bottom showing slide timing)
 *   2. Ken Burns effect with randomized pan + zoom (cinematic camera drift)
 *   3. Frosted-glass blur backdrop behind info text area
 *   4. Slide counter ("3 / 10") next to dot indicators
 *   5. Keyboard navigation (arrow keys + spacebar for play/pause)
 *   6. Crossfade transition when swapping between batches
 *   7. "Play" text on the play button (visible on hover)
 *   8. Clickable genre chips that navigate to the genre's library page
 * Also includes: preload next group at slide 8 for instant batch swaps
 */

(function () {
'use strict';

const CONFIG = {
    imageWidth: 1900,
    preloadWidth: 1280,
    limit: 10,
    autoplayInterval: 8000,
    backgroundColor: "#000000",
    frameColor: "hsl(var(--theme-primary-color-hue), var(--theme-primary-color-saturation), var(--theme-primary-color-lightness))",
    marginTop: "9rem",
    marginBottom: "-6.5rem",
    playbuttonColor: "hsl(var(--theme-primary-color-hue), var(--theme-primary-color-saturation), var(--theme-primary-color-lightness))",
    favoriteButtonColor: "hsl(var(--theme-primary-color-hue), var(--theme-primary-color-saturation), var(--theme-primary-color-lightness))",
    customItemsFile: "spotlight-items.txt",
    collectionId: null,
    libraryId: 2310256,
    enablePreloading: true,
    enableSwipe: true,
    swipeThreshold: 50,
    spotlightBatchSize: 250,
    autoAdvanceOnCycle: true,
    unplayedOnly: true,
    enableProgressBar: true,
    enableKenBurns: true,
    enableBlurBackdrop: true,
    enableSlideCounter: true,
    enableKeyboard: true,
    enableCrossfade: true,
    crossfadeDuration: 400,
    enablePlayText: false,
    enableGenreClick: true,
    enableTrailers: true,
    trailerStartMuted: false
};

let SPOTLIGHT_INITIALIZED = false;
let SPOTLIGHT_INSTANCE = null;
const SPOTLIGHT_CONTAINER_CLASS = 'emby-spotlight-trailer-container';

const STATE = {
    itemPool: [],
    poolCursor: 0,
    totalRecordCount: null,
    usedStartIndices: new Set(),
    isFetchingBatch: false,
    apiClient: null,
    nextGroupReady: null
};

const homeContainerSelectors = [
    ".view:not(.hide) .homeSectionsContainer",
    ".view:not(.hide) .view-home-home",
    ".view-home-home",
    ".view-home",
    ".homeSectionsContainer",
    ".homeView",
    ".view[data-view='home'] .homeSectionsContainer",
    ".view[data-view='home']"
];

function findHomeContainer() {
    for (const s of homeContainerSelectors) {
        const el = document.querySelector(s);
        if (el) return el;
    }
    return document.querySelector(".view:not(.hide)");
}

function safeRequire(modules) {
    return new Promise((resolve) => {
        try {
            if (typeof window.require === "function") {
                window.require(modules, function () {
                    resolve(Array.prototype.slice.call(arguments));
                });
            } else if (typeof require === "function") {
                resolve([require.apply(null, modules)]);
            } else { resolve([]); }
        } catch (e) { resolve([]); }
    });
}

function getServerId(apiClient) {
    try {
        if (typeof apiClient.serverId === 'function') return apiClient.serverId();
        if (typeof apiClient.serverId === 'string') return apiClient.serverId;
        if (typeof apiClient.serverInfo === 'function') {
            const info = apiClient.serverInfo();
            return info?.Id || null;
        }
        if (apiClient.serverInfo?.Id) return apiClient.serverInfo.Id;
        if (apiClient._serverInfo?.Id) return apiClient._serverInfo.Id;
    } catch (e) { /* ignore */ }
    return null;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function formatRuntime(minutes) {
    if (!minutes) return '';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
}

function preloadImages(items, apiClient) {
    if (!CONFIG.enablePreloading) return Promise.resolve();
    // Use a smaller width for preloading (faster) — the browser will
    // scale it up. Full-res loads on demand when the slide is shown.
    const preloadW = Math.min(CONFIG.preloadWidth, 800);
    return Promise.all(items.map(item => new Promise(resolve => {
        const img = new Image();
        const to = setTimeout(resolve, 1500);
        img.onload = () => { clearTimeout(to); resolve(); };
        img.onerror = () => { clearTimeout(to); resolve(); };
        img.src = getImageUrl(apiClient, item, { width: preloadW, prefer: "Backdrop" });
    })));
}

function insertStyles() {
    if (document.getElementById("spotlight-trailer-css")) return;
    const bgColor = CONFIG.backgroundColor;
    const frameColor = CONFIG.frameColor;
    const rgb = hexToRgb(bgColor);
    const rgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`;
    const autoplayMs = CONFIG.autoplayInterval;
    const css = `
.spotlight-container.spotlight-pro{width:94%;display:block;position:relative;margin-top:${CONFIG.marginTop};margin-bottom:${CONFIG.marginBottom};margin-left:auto;margin-right:auto;padding:0;transition:box-shadow .3s ease,opacity ${CONFIG.crossfadeDuration}ms ease;border-radius:.5rem;box-shadow:10px 10px 10px 0 rgba(0,0,0,.35)}
.spotlight-container.spotlight-pro:hover{box-shadow:10px 10px 10px 0 rgba(0,0,0,.35),0 0 2px 4px ${frameColor};border-radius:.5rem}
.spotlight-container.spotlight-pro.fade-out{opacity:0}
.spotlight-container.spotlight-pro.fade-in{opacity:1}
.spotlight .play-button-overlay{position:absolute;top:2rem;right:2rem;z-index:25;opacity:0;transition:opacity .3s ease;pointer-events:none;display:flex;align-items:center}
.spotlight-container:hover .play-button-overlay{opacity:1;pointer-events:all}
.spotlight .play-button{width:80px;height:80px;border-radius:50%;background:rgba(55,55,55,.3);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s ease;box-shadow:0 4px 12px rgba(0,0,0,.4);flex-shrink:0}
.spotlight .play-button:hover{transform:scale(1.02);background:${CONFIG.playbuttonColor};box-shadow:0 6px 20px rgba(0,0,0,.5)}
.spotlight .play-button svg{width:40px;height:40px;fill:#fff;margin-left:6px;position:relative;left:-2px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));transition:filter .3s ease}
.spotlight .play-button:hover svg{filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}
.spotlight .favorite-button-overlay{position:absolute;top:2rem;left:2rem;z-index:25;opacity:0;transition:opacity .3s ease;pointer-events:none}
.spotlight-container:hover .favorite-button-overlay{opacity:1;pointer-events:all}
.spotlight .favorite-button{width:80px;height:80px;border-radius:50%;background:rgba(55,55,55,.3);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s ease;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.spotlight .favorite-button:hover{transform:scale(1.02);background:${CONFIG.favoriteButtonColor};box-shadow:0 6px 20px rgba(0,0,0,.5)}
.spotlight .favorite-button.is-favorite{background:${CONFIG.favoriteButtonColor}}
.spotlight .favorite-button svg{width:40px;height:40px;fill:#fff;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));transition:filter .3s ease}
.spotlight .favorite-button:hover svg{filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}
.spotlight .favorite-button.is-favorite svg{fill:#ffcc00}
.spotlight{position:relative;overflow:visible;width:100%;touch-action:pan-y pinch-zoom}
.spotlight .banner-slider-wrapper{position:relative;width:100%;overflow:hidden;border-radius:.5rem;background-color:${bgColor};-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);touch-action:pan-y}
.spotlight .banner-slider{display:flex;transition:transform .5s ease;will-change:transform;margin:0;padding:0;width:100%;touch-action:pan-y}
.spotlight .banner-item{flex:0 0 100%;min-width:100%;max-width:100%;position:relative;cursor:pointer;margin:0;padding:0;box-sizing:border-box;overflow:hidden}
.spotlight .banner-cover{width:100%;height:min(48vmax,54vh);object-fit:cover;object-position:center;display:block;pointer-events:none;margin:0;padding:0;border:0;outline:0;position:relative;transform-origin:center center}
@keyframes kenBurnsTL{0%{transform:scale(1.1) translate(0%,0%)}100%{transform:scale(1.22) translate(-3%,-2%)}}
@keyframes kenBurnsTR{0%{transform:scale(1.1) translate(0%,0%)}100%{transform:scale(1.22) translate(3%,-2%)}}
@keyframes kenBurnsBL{0%{transform:scale(1.1) translate(0%,0%)}100%{transform:scale(1.22) translate(-3%,2%)}}
@keyframes kenBurnsBR{0%{transform:scale(1.1) translate(0%,0%)}100%{transform:scale(1.22) translate(3%,2%)}}
@keyframes zoomOut{0%{transform:scale(1.15)}100%{transform:scale(1.0)}}
.spotlight .banner-cover.kb-tl{animation:kenBurnsTL ${autoplayMs}ms ease-out forwards}
.spotlight .banner-cover.kb-tr{animation:kenBurnsTR ${autoplayMs}ms ease-out forwards}
.spotlight .banner-cover.kb-bl{animation:kenBurnsBL ${autoplayMs}ms ease-out forwards}
.spotlight .banner-cover.kb-br{animation:kenBurnsBR ${autoplayMs}ms ease-out forwards}
.spotlight .banner-cover.kb-zoom{animation:zoomOut ${autoplayMs}ms ease-out forwards}
.spotlight .banner-gradient-left{position:absolute;top:0;bottom:0;left:0;width:35%;pointer-events:none;z-index:6;background:linear-gradient(to right,${rgbaColor} 0%,${rgbaColor} 3%,rgba(${rgb.r},${rgb.g},${rgb.b},.98) 6%,rgba(${rgb.r},${rgb.g},${rgb.b},.95) 10%,rgba(${rgb.r},${rgb.g},${rgb.b},.92) 15%,rgba(${rgb.r},${rgb.g},${rgb.b},.87) 20%,rgba(${rgb.r},${rgb.g},${rgb.b},.8) 25%,rgba(${rgb.r},${rgb.g},${rgb.b},.7) 35%,rgba(${rgb.r},${rgb.g},${rgb.b},.55) 45%,rgba(${rgb.r},${rgb.g},${rgb.b},.4) 55%,rgba(${rgb.r},${rgb.g},${rgb.b},.25) 65%,rgba(${rgb.r},${rgb.g},${rgb.b},.15) 75%,rgba(${rgb.r},${rgb.g},${rgb.b},.08) 85%,rgba(${rgb.r},${rgb.g},${rgb.b},.03) 92%,transparent 100%)}
.spotlight .banner-gradient-right{position:absolute;top:0;bottom:0;right:0;width:35%;pointer-events:none;z-index:6;background:linear-gradient(to left,${rgbaColor} 0%,${rgbaColor} 3%,rgba(${rgb.r},${rgb.g},${rgb.b},.98) 6%,rgba(${rgb.r},${rgb.g},${rgb.b},.95) 10%,rgba(${rgb.r},${rgb.g},${rgb.b},.92) 15%,rgba(${rgb.r},${rgb.g},${rgb.b},.87) 20%,rgba(${rgb.r},${rgb.g},${rgb.b},.8) 25%,rgba(${rgb.r},${rgb.g},${rgb.b},.7) 35%,rgba(${rgb.r},${rgb.g},${rgb.b},.55) 45%,rgba(${rgb.r},${rgb.g},${rgb.b},.4) 55%,rgba(${rgb.r},${rgb.g},${rgb.b},.25) 65%,rgba(${rgb.r},${rgb.g},${rgb.b},.15) 75%,rgba(${rgb.r},${rgb.g},${rgb.b},.08) 85%,rgba(${rgb.r},${rgb.g},${rgb.b},.03) 92%,transparent 100%)}
.spotlight .banner-vignette-top{position:absolute;top:0;left:0;right:0;height:30%;background:linear-gradient(to bottom,rgba(${rgb.r},${rgb.g},${rgb.b},.85) 0%,rgba(${rgb.r},${rgb.g},${rgb.b},.6) 30%,rgba(${rgb.r},${rgb.g},${rgb.b},.3) 60%,transparent 100%);pointer-events:none;z-index:6}
.spotlight .banner-vignette-bottom{position:absolute;bottom:0;left:0;right:0;height:30%;background:linear-gradient(to top,rgba(${rgb.r},${rgb.g},${rgb.b},.85) 0%,rgba(${rgb.r},${rgb.g},${rgb.b},.6) 30%,rgba(${rgb.r},${rgb.g},${rgb.b},.3) 60%,transparent 100%);pointer-events:none;z-index:6}
.spotlight .banner-info-backdrop{position:absolute;left:0;top:0;width:100%;height:100%;z-index:8;pointer-events:none;background:rgba(${rgb.r},${rgb.g},${rgb.b},.2);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .3s ease}
.spotlight .banner-item.show-overview .banner-info-backdrop{opacity:1}
.spotlight .banner-logo{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);max-width:60%;max-height:50%;object-fit:contain;z-index:15;filter:drop-shadow(0 6px 20px rgba(0,0,0,.95)) drop-shadow(0 0 40px rgba(0,0,0,.6));pointer-events:auto;cursor:pointer;transition:transform .5s ease,opacity .3s ease}
.spotlight-container:hover .banner-logo{transform:translate(-50%,-50%) scale(1.1)}
.spotlight .banner-logo.hidden{opacity:0;pointer-events:none}
.spotlight .banner-title{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);z-index:10;font-size:clamp(1.5rem,3.5vw,3rem);font-weight:700;color:#fff;text-shadow:2px 2px 8px rgba(0,0,0,.9);pointer-events:auto;cursor:pointer;text-align:center;max-width:80%;transition:transform .5s ease,opacity .3s ease}
.spotlight-container:hover .banner-title{transform:translate(-50%,-50%) scale(1.1)}
.spotlight .banner-title.hidden{opacity:0;pointer-events:none}
.spotlight .banner-overview{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);z-index:16;max-width:70%;padding:0;background:none;opacity:0;pointer-events:none;cursor:pointer;transition:opacity .3s ease}
.spotlight .banner-overview.visible{opacity:1;pointer-events:auto}
.spotlight .banner-overview-text{font-size:clamp(1.1rem,1.8vw,1.4rem);color:rgba(255,255,255,.9);text-shadow:2px 2px 8px rgba(0,0,0,.99),0 0 20px rgba(0,0,0,.9);font-weight:500;line-height:1.6;text-align:center;max-height:40vh;overflow-y:auto}
@media (max-width:768px),(orientation:portrait){.spotlight .banner-overview{max-width:85%}.spotlight .banner-overview-text{font-size:clamp(.9rem,1.5vw,1.1rem);line-height:1.4;max-height:25vh;overflow-y:auto}}
.spotlight .banner-tagline{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);z-index:10;font-size:clamp(1.3rem,2vw,1.6rem);font-weight:500;color:rgba(255,255,255,.9);text-shadow:1px 1px 4px rgba(0,0,0,.9);pointer-events:none;text-align:center;max-width:60%;transition:opacity .3s ease}
.spotlight .banner-tagline.hidden{opacity:0}
@media (max-width:1500px){.spotlight .banner-tagline{display:none}}
.spotlight .banner-info{position:absolute;left:3vmin;bottom:1.5rem;z-index:10;display:flex;flex-direction:column;align-items:flex-start;gap:.5rem;pointer-events:none;max-width:60%}
.spotlight .banner-genres{display:flex;gap:.5rem;flex-wrap:wrap}
.spotlight .banner-genre{font-size:clamp(1.1rem,1.8vw,1.4rem);color:rgba(255,255,255,.9);text-shadow:1px 1px 4px rgba(0,0,0,.9);font-weight:500;padding:.2rem .7rem;border-radius:1rem;background:rgba(255,255,255,.08);transition:background .2s ease,transform .2s ease;pointer-events:auto;cursor:pointer}
.spotlight .banner-genre:hover{background:rgba(255,255,255,.2);transform:translateY(-2px)}
.spotlight .banner-meta{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap}
.spotlight .banner-meta-item{font-size:clamp(1.1rem,1.8vw,1.4rem);color:rgba(255,255,255,.85);text-shadow:1px 1px 4px rgba(0,0,0,.9);font-weight:500}
.spotlight .meta-rating-item{display:flex;align-items:center;gap:.4rem}
.spotlight .meta-rating-icon{width:1.8rem;height:1.8rem;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))}
.spotlight .meta-rating-star{width:1.8rem;height:1.8rem;fill:#cb272a;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))}
.spotlight .meta-rating-score{font-size:clamp(1.1rem,1.8vw,1.4rem);font-weight:500;color:rgba(255,255,255,.85);text-shadow:1px 1px 4px rgba(0,0,0,.9)}
.spotlight .arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:20;border:none;color:#fff;cursor:pointer;opacity:.7;padding:0;background:none;transition:opacity .3s;display:flex;align-items:center;justify-content:center}
.spotlight .arrow svg{filter:drop-shadow(0 2px 6px rgba(0,0,0,.8))}
.spotlight .arrow:hover{opacity:1}
.spotlight .arrow.left{left:1rem}
.spotlight .arrow.right{right:1rem}
.spotlight .controls-wrapper{position:absolute;right:2rem;bottom:2rem;z-index:20;display:flex;align-items:center;gap:.8rem}
.spotlight .controls{display:flex;gap:.5rem}
.spotlight .control{width:.8rem;height:.8rem;border-radius:50%;background:rgba(255,255,255,.4);border:none;cursor:pointer;transition:background .3s}
.spotlight .control.active{background:#fff}
@media (max-width:768px),(orientation:portrait){.spotlight .control{display:none}}
.spotlight .slide-counter{font-size:.95rem;font-weight:600;color:rgba(255,255,255,.7);text-shadow:1px 1px 4px rgba(0,0,0,.9);min-width:3.5rem;text-align:right;pointer-events:none}
@media (max-width:768px),(orientation:portrait){.spotlight .slide-counter{display:none}}
.spotlight .progress-bar-container{position:absolute;left:0;bottom:0;width:100%;height:3px;z-index:22;background:rgba(255,255,255,.1);pointer-events:none;border-radius:0 0 .5rem .5rem;overflow:hidden}
.spotlight .progress-bar-fill{height:100%;width:0%;background:${frameColor};transition:width .1s linear;box-shadow:0 0 8px ${frameColor}}
.spotlight .progress-bar-fill.paused{transition:none}
/* === Trailer Support === */
.spotlight .trailer-button-overlay{position:absolute;top:2rem;right:12rem;z-index:25;opacity:0;transition:opacity .3s ease;pointer-events:none}
.spotlight-container:hover .trailer-button-overlay{opacity:1;pointer-events:all}
.spotlight .trailer-button{width:80px;height:80px;border-radius:50%;background:rgba(55,55,55,.3);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s ease;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.spotlight .trailer-button:hover{transform:scale(1.02);background:${CONFIG.playbuttonColor};box-shadow:0 6px 20px rgba(0,0,0,.5)}
.spotlight .trailer-button svg{width:36px;height:36px;fill:#fff;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))}
.spotlight .trailer-container{position:absolute;top:0;left:0;width:100%;height:100%;z-index:20;opacity:0;pointer-events:none;transition:opacity .4s ease;background:#000;overflow:hidden}
.spotlight .trailer-container.active{opacity:1;pointer-events:auto}
.spotlight .trailer-iframe{width:100%;height:100%;border:none;display:block}
.spotlight .trailer-controls{position:absolute;bottom:2rem;left:2rem;z-index:30;display:flex;gap:.8rem;opacity:0;transition:opacity .3s ease;pointer-events:none}
.spotlight .trailer-container.active ~ .trailer-controls{opacity:1;pointer-events:auto}
.spotlight .trailer-control-btn{width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.6);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s ease;color:#fff}
.spotlight .trailer-control-btn:hover{background:rgba(0,0,0,.8);transform:scale(1.05)}
.spotlight .trailer-control-btn svg{width:24px;height:24px;fill:#fff}
.spotlight .banner-item.show-trailer .banner-logo,
.spotlight .banner-item.show-trailer .banner-info,
.spotlight .banner-item.show-trailer .banner-info-backdrop,
.spotlight .banner-item.show-trailer .banner-title,
.spotlight .banner-item.show-trailer .banner-tagline,
.spotlight .banner-item.show-trailer .banner-overview{opacity:0;pointer-events:none;transition:opacity .4s ease}
.spotlight .banner-item.show-trailer .banner-logo{z-index:0}
.spotlight .banner-item.show-trailer ~ .play-button-overlay,
.spotlight .banner-item.show-trailer ~ .favorite-button-overlay,
.spotlight .banner-item.show-trailer ~ .trailer-button-overlay{opacity:0;pointer-events:none;transition:opacity .4s ease}
.spotlight .banner-item.show-trailer .banner-gradient-left,
.spotlight .banner-item.show-trailer .banner-gradient-right,
.spotlight .banner-item.show-trailer .banner-vignette-top,
.spotlight .banner-item.show-trailer .banner-vignette-bottom{opacity:0;transition:opacity .4s ease}

.spotlight .loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:30;background:rgba(0,0,0,.3)}
`;
    const s = document.createElement("style");
    s.id = "spotlight-trailer-css";
    s.innerHTML = css;
    document.head.appendChild(s);
}

function buildQuery(parentId, options) {
    options = options || {};
    const q = {
        IncludeItemTypes: "Movie,Series", Recursive: true,
        SortBy: "ProductionYear,SortName", SortOrder: "Descending",
        EnableImageTypes: "Primary,Backdrop,Thumb,Logo,Banner",
        EnableUserData: true,
        EnableTotalRecordCount: options.enableTotal !== false,
        Fields: "PrimaryImageAspectRatio,BackdropImageTags,ImageTags,ParentLogoImageTag,ParentLogoItemId,CriticRating,CommunityRating,OfficialRating,PremiereDate,ProductionYear,Genres,RunTimeTicks,Taglines,Overview,RemoteTrailers"
    };
    if (CONFIG.unplayedOnly) q.IsPlayed = false;
    q.Limit = options.limit != null ? options.limit : CONFIG.limit;
    if (options.startIndex != null) q.StartIndex = options.startIndex;
    if (parentId) q.ParentId = parentId;
    return q;
}

function getImageUrl(apiClient, item, options) {
    options = options || {};
    const width = options.width || CONFIG.imageWidth;
    const pref = options.prefer || "Backdrop";
    if (item.ImageUrl) {
        let url = item.ImageUrl;
        if (options.addImageSizeToUrl && width) url += "&maxWidth=" + width;
        return url;
    }
    const tags = item.ImageTags || {};
    if ((pref === "Backdrop" || pref === "Auto") && item.BackdropImageTags && item.BackdropImageTags.length)
        return apiClient.getImageUrl(item.Id, { type: "Backdrop", maxWidth: width, tag: item.BackdropImageTags[0] });
    if (tags.Primary) return apiClient.getImageUrl(item.Id, { type: "Primary", maxWidth: width, tag: tags.Primary });
    if (tags.Thumb) return apiClient.getImageUrl(item.Id, { type: "Thumb", maxWidth: width, tag: tags.Thumb });
    return apiClient.getImageUrl(item.Id, { type: "Primary", maxWidth: width });
}

function getLogoUrl(apiClient, item) {
    const tags = item.ImageTags || {};
    if (tags.Logo) return apiClient.getImageUrl(item.Id, { type: "Logo", maxWidth: 800, tag: tags.Logo });
    return null;
}

async function toggleFavorite(itemId, apiClient, isFavorite) {
    try {
        const userId = apiClient.getCurrentUserId();
        const url = apiClient.getUrl(`/Users/${userId}/FavoriteItems/${itemId}`);
        const response = await fetch(url, {
            method: isFavorite ? 'DELETE' : 'POST',
            headers: { 'X-Emby-Token': apiClient.accessToken() }
        });
        if (response.ok) return !isFavorite;
    } catch (error) { console.error("[SpotlightTrailer] Favorite toggle error:", error); }
    return isFavorite;
}

async function loadCustomItemsList() {
    try {
        const response = await fetch(`${CONFIG.customItemsFile}?t=${Date.now()}`, {
            cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!response.ok) { if (response.status === 404) return null; throw new Error(`HTTP ${response.status}`); }
        const text = await response.text();
        const ids = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).filter(l => /^[a-zA-Z0-9]+$/.test(l));
        return ids.length > 0 ? ids : null;
    } catch (e) { return null; }
}

async function fetchItemsByIds(apiClient, itemIds) {
    try {
        const items = [], userId = apiClient.getCurrentUserId();
        const shuffledIds = shuffleArray(itemIds);
        for (const itemId of shuffledIds.slice(0, Math.min(CONFIG.limit * 2, shuffledIds.length))) {
            try {
                const item = await apiClient.getItem(userId, itemId);
                if (item) {
                    if (item.Type === "BoxSet" || item.CollectionType === "boxsets") {
                        const ci = await apiClient.getItems(userId, { ParentId: itemId, Recursive: true, IncludeItemTypes: "Movie,Series", Limit: CONFIG.limit, SortBy: "Random", Fields: "PrimaryImageAspectRatio,BackdropImageTags,ImageTags,ParentLogoImageTag,ParentLogoItemId,CriticRating,CommunityRating,OfficialRating,PremiereDate,ProductionYear,Genres,RunTimeTicks,Taglines,Overview,RemoteTrailers" });
                        if (ci?.Items) items.push(...ci.Items);
                    } else items.push(item);
                }
                if (items.length >= CONFIG.limit) break;
            } catch (e) { /* skip */ }
        }
        return items;
    } catch (e) { return []; }
}

async function fetchItems(apiClient) {
    const customIds = await loadCustomItemsList();
    if (customIds?.length > 0) {
        const items = await fetchItemsByIds(apiClient, customIds);
        if (items.length === 0) return fetchStandardItems(apiClient);
        return shuffleArray(items).slice(0, Math.min(CONFIG.limit, items.length));
    }
    return fetchStandardItems(apiClient);
}

function getRandomStartIndex(batchSize) {
    const total = STATE.totalRecordCount;
    if (!total || total <= batchSize) return 0;
    const maxStart = total - batchSize;
    // Use fine-grained random: pick any start from 0 to maxStart
    // Track used ranges to avoid repeating the same window
    const chosen = Math.floor(Math.random() * (maxStart + 1));
    return chosen;
}

async function fetchInitialGroup(apiClient, parentId) {
    const fetchSize = CONFIG.limit * 2;
    // Single query: get items AND total count in one round-trip.
    // Use a random startIndex from 0 (since we don't know total yet).
    // The TotalRecordCount from this query enables random windows for
    // subsequent batch fetches.
    const q = buildQuery(parentId, { limit: fetchSize, startIndex: 0, enableTotal: true });
    const result = await apiClient.getItems(apiClient.getCurrentUserId(), q);
    if (result?.TotalRecordCount != null) {
        STATE.totalRecordCount = result.TotalRecordCount;
        console.log(`[SpotlightTrailer] Total unplayed items: ${STATE.totalRecordCount}`);
    }
    let allItems = (result?.Items || []);

    // If we have a large library, try a random window for variety on reload.
    // Do this as a second query only if the library is big enough to warrant it.
    if (STATE.totalRecordCount > fetchSize * 3) {
        try {
            const randomStart = getRandomStartIndex(fetchSize);
            const rq = buildQuery(parentId, { limit: fetchSize, startIndex: randomStart, enableTotal: false });
            const randomResult = await apiClient.getItems(apiClient.getCurrentUserId(), rq);
            const randomItems = randomResult?.Items || [];
            if (randomItems.length >= CONFIG.limit) {
                // Use the random window as display, push the first query items to pool
                allItems = randomItems;
                STATE.itemPool.push(...(result.Items || []));
            }
        } catch (e) { /* fall back to sequential items */ }
    }

    console.log(`[SpotlightTrailer] Initial fetch returned ${allItems.length} items`);
    if (allItems.length <= CONFIG.limit) return allItems;
    const display = allItems.slice(0, CONFIG.limit);
    STATE.itemPool.push(...allItems.slice(CONFIG.limit));
    STATE.poolCursor = 0;
    return display;
}

async function fetchBatch(apiClient, parentId) {
    if (STATE.isFetchingBatch) return;
    STATE.isFetchingBatch = true;
    try {
        const batchSize = CONFIG.spotlightBatchSize;
        const startIndex = getRandomStartIndex(batchSize);
        const q = buildQuery(parentId, { limit: batchSize, startIndex, enableTotal: false });
        const result = await apiClient.getItems(apiClient.getCurrentUserId(), q);
        const items = result?.Items || [];
        const existingIds = new Set(STATE.itemPool.map(i => i.Id));
        STATE.itemPool.push(...items.filter(i => !existingIds.has(i.Id)));
    } catch (e) { /* ignore */ }
    finally { STATE.isFetchingBatch = false; }
}

function getNextGroupFromPool() {
    const remaining = STATE.itemPool.length - STATE.poolCursor;
    if (remaining < CONFIG.limit && !STATE.isFetchingBatch && STATE.apiClient) {
        fetchBatch(STATE.apiClient, CONFIG.collectionId || CONFIG.libraryId || null);
    }
    if (remaining <= 0) return null;
    // Shuffle the remaining pool so each batch is different
    const available = STATE.itemPool.slice(STATE.poolCursor);
    const shuffled = shuffleArray(available);
    const group = shuffled.slice(0, CONFIG.limit);
    // Remove the selected items from the pool
    const groupIds = new Set(group.map(i => i.Id));
    STATE.itemPool = STATE.itemPool.filter(i => !groupIds.has(i.Id) || STATE.itemPool.indexOf(i) < STATE.poolCursor);
    STATE.poolCursor = STATE.itemPool.length - (available.length - group.length);
    return group;
}

async function preloadNextGroup(apiClient) {
    if (STATE.nextGroupReady) return STATE.nextGroupReady;
    const group = getNextGroupFromPool();
    if (!group?.length) return null;
    if (CONFIG.enablePreloading) await preloadImages(group, apiClient);
    STATE.nextGroupReady = group;
    return group;
}

async function fetchStandardItems(apiClient) {
    STATE.apiClient = apiClient;
    const parentId = CONFIG.collectionId || CONFIG.libraryId || null;
    try {
        const displayItems = await fetchInitialGroup(apiClient, parentId);
        fetchBatch(apiClient, parentId);
        return displayItems;
    } catch (e) { return []; }
}

async function navigateToGenre(genre, apiClient) {
    try {
        const sid = getServerId(apiClient);
        const parentId = CONFIG.collectionId || CONFIG.libraryId || '';
        const userId = apiClient.getCurrentUserId();
        const token = apiClient.accessToken ? apiClient.accessToken() : null;

        // Fetch the genre ID from Emby API using direct fetch
        let genreId = null;
        try {
            const params = new URLSearchParams();
            if (parentId) params.set('ParentId', parentId);
            if (userId) params.set('UserId', userId);
            const fetchUrl = apiClient.serverAddress() + '/Genres?' + params.toString();
            const headers = {};
            if (token) headers['X-Emby-Token'] = token;
            const response = await fetch(fetchUrl, { headers });
            if (response.ok) {
                const data = await response.json();
                const found = (data.Items || []).find(g => g.Name === genre);
                if (found) genreId = found.Id;
            }
        } catch (e) {
            console.warn('[SpotlightTrailer] Failed to fetch genre ID for', genre, e);
        }

        if (!genreId) {
            console.warn('[SpotlightTrailer] Genre ID not found for', genre, '- falling back to text search');
            // Fallback: use the genres text parameter format
            let url = '/web/index.html#!/list/list.html?genres=' + encodeURIComponent(genre);
            if (sid) url += '&serverId=' + sid;
            if (parentId) url += '&parentId=' + parentId;
            window.location.href = url;
            return;
        }

        // Build the correct Emby URL: #!/list/list.html?genreId=xxx&serverId=xxx&parentId=xxx
        let url = '/web/index.html#!/list/list.html?genreId=' + genreId;
        if (sid) url += '&serverId=' + sid;
        if (parentId) url += '&parentId=' + parentId;
        window.location.href = url;
    } catch (e) { console.warn('[SpotlightTrailer] Genre navigation failed:', e); }
}

function pickKenBurnsStyle() {
    if (!CONFIG.enableKenBurns) {
        return { name: 'kb-zoom', css: `zoomOut ${CONFIG.autoplayInterval}ms ease-out forwards` };
    }
    const variants = [
        { name: 'kb-tl', css: `kenBurnsTL ${CONFIG.autoplayInterval}ms ease-out forwards` },
        { name: 'kb-tr', css: `kenBurnsTR ${CONFIG.autoplayInterval}ms ease-out forwards` },
        { name: 'kb-bl', css: `kenBurnsBL ${CONFIG.autoplayInterval}ms ease-out forwards` },
        { name: 'kb-br', css: `kenBurnsBR ${CONFIG.autoplayInterval}ms ease-out forwards` }
    ];
    return variants[Math.floor(Math.random() * variants.length)];
}

function createInfoElement(item, apiClient) {
    const infoContainer = document.createElement("div");
    infoContainer.className = "banner-info";
    if (item.Genres?.length > 0) {
        const genresDiv = document.createElement("div");
        genresDiv.className = "banner-genres";
        item.Genres.slice(0, 3).forEach(genre => {
            const span = document.createElement("span");
            span.className = "banner-genre";
            span.textContent = genre;
            span.dataset.genre = genre;
            if (CONFIG.enableGenreClick) {
                span.addEventListener("click", (e) => { e.stopPropagation(); navigateToGenre(genre, apiClient); });
            }
            genresDiv.appendChild(span);
        });
        infoContainer.appendChild(genresDiv);
    }
    const metaDiv = document.createElement("div");
    metaDiv.className = "banner-meta";
    if (item.ProductionYear) { const y = document.createElement("span"); y.className = "banner-meta-item"; y.textContent = item.ProductionYear; metaDiv.appendChild(y); }
    if (item.CriticRating != null) { const r = document.createElement("div"); r.className = "meta-rating-item banner-meta-item"; r.innerHTML = `<img src="modules/mediainfo/${item.CriticRating >= 60 ? 'fresh' : 'rotten'}.png" alt="RT" class="meta-rating-icon"><span class="meta-rating-score">${item.CriticRating}%</span>`; metaDiv.appendChild(r); }
    if (item.CommunityRating) { const i = document.createElement("div"); i.className = "meta-rating-item banner-meta-item"; i.innerHTML = `<svg class="meta-rating-star" viewBox="0 0 24 24"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg><span class="meta-rating-score">${item.CommunityRating.toFixed(1)}</span>`; metaDiv.appendChild(i); }
    if (item.RunTimeTicks) { const s = document.createElement("span"); s.className = "banner-meta-item"; s.textContent = formatRuntime(Math.round(item.RunTimeTicks / 600000000)); metaDiv.appendChild(s); }
    if (metaDiv.children.length > 0) infoContainer.appendChild(metaDiv);
    return infoContainer.children.length > 0 ? infoContainer : null;
}

function getYouTubeId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /\[youtube\]\s*([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
    return null;
}
function getItemTrailerId(item) {
    if (item.RemoteTrailers?.length > 0) {
        for (const t of item.RemoteTrailers) { const id = getYouTubeId(t.Url || ''); if (id) return id; }
    }
    return null;
}
function isTrailersEnabled() {
    if (!CONFIG.enableTrailers) return false;
    try { if (localStorage.getItem('spotlight-trailers-enabled') === 'false') return false; } catch (e) {}
    return true;
}

function createBannerElement(item, apiClient) {
    const div = document.createElement("div");
    div.className = "banner-item";
    const img = document.createElement("img");
    const kb = pickKenBurnsStyle();
    img.className = "banner-cover " + kb.name;
    img.style.animation = kb.css;
    img.draggable = false; img.alt = item.Name || ""; img.loading = "eager"; img.decoding = "async";
    img.src = getImageUrl(apiClient, item, { width: CONFIG.imageWidth, prefer: "Backdrop" });
    div.appendChild(img);
    ['banner-gradient-left','banner-gradient-right','banner-vignette-top','banner-vignette-bottom'].forEach(c => { const e = document.createElement("div"); e.className = c; div.appendChild(e); });
    if (CONFIG.enableBlurBackdrop) { const b = document.createElement("div"); b.className = "banner-info-backdrop"; div.appendChild(b); }
    const logoUrl = getLogoUrl(apiClient, item);
    if (logoUrl) { const l = document.createElement("img"); l.className = "banner-logo"; l.src = logoUrl; l.alt = (item.Name||"")+" Logo"; l.draggable = false; div.appendChild(l); }
    else { const t = document.createElement("div"); t.className = "banner-title"; t.textContent = item.Name || ""; div.appendChild(t); }
    if (item.Taglines?.length > 0) { const t = document.createElement("div"); t.className = "banner-tagline"; t.textContent = item.Taglines[0]; div.appendChild(t); }
    if (item.Overview) { const oc = document.createElement("div"); oc.className = "banner-overview"; const ot = document.createElement("div"); ot.className = "banner-overview-text"; ot.textContent = item.Overview; oc.appendChild(ot); div.appendChild(oc); }
    const info = createInfoElement(item, apiClient);
    if (info) div.appendChild(info);
    div.dataset.itemId = item.Id;
    div.dataset.isFavorite = item.UserData?.IsFavorite ? "true" : "false";
    if (item.ServerId) div.dataset.serverId = item.ServerId;
    const trailerId = getItemTrailerId(item);
    if (trailerId && isTrailersEnabled()) {
        const tc = document.createElement("div"); tc.className = "trailer-container"; div.appendChild(tc);
        div.dataset.trailerId = trailerId;
    }
    return div;
}

function buildSlider(items, apiClient) {
    const container = document.createElement("div");
    container.className = `spotlight-container spotlight-pro ${SPOTLIGHT_CONTAINER_CLASS}`;
    const spotlight = document.createElement("div");
    spotlight.className = "spotlight";
    const loader = document.createElement("div");
    loader.className = "loader"; loader.innerHTML = "Loading…";
    spotlight.appendChild(loader);
    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "banner-slider-wrapper";
    const slider = document.createElement("div");
    slider.className = "banner-slider";
    const fragment = document.createDocumentFragment();
    items.forEach(it => fragment.appendChild(createBannerElement(it, apiClient)));
    slider.appendChild(fragment);
    if (items.length > 1) {
        const first = slider.children[0].cloneNode(true);
        const last = slider.children[slider.children.length - 1].cloneNode(true);
        slider.appendChild(first); slider.insertBefore(last, slider.children[0]);
    }
    sliderWrapper.appendChild(slider); spotlight.appendChild(sliderWrapper);
    const btnLeft = document.createElement("button");
    btnLeft.className = "arrow left";
    btnLeft.innerHTML = `<svg width="60" height="60" viewBox="0 0 24 24" fill="white"><path d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>`;
    btnLeft.setAttribute("aria-label", "Previous");
    const btnRight = document.createElement("button");
    btnRight.className = "arrow right";
    btnRight.innerHTML = `<svg width="60" height="60" viewBox="0 0 24 24" fill="white"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>`;
    btnRight.setAttribute("aria-label", "Next");
    spotlight.appendChild(btnLeft); spotlight.appendChild(btnRight);
    const playButtonOverlay = document.createElement("div");
    playButtonOverlay.className = "play-button-overlay";
    const playButton = document.createElement("button");
    playButton.className = "play-button"; playButton.setAttribute("aria-label", "Play");
    playButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>`;
    playButtonOverlay.appendChild(playButton);
    spotlight.appendChild(playButtonOverlay);
    const trailerButtonOverlay = document.createElement("div");
    trailerButtonOverlay.className = "trailer-button-overlay";
    const trailerButton = document.createElement("button");
    trailerButton.className = "trailer-button";
    trailerButton.setAttribute("aria-label", "Watch Trailer");
    trailerButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4,6H2V20A2,2 0 0,0 4,22H18V20H4V6M20,2H8A2,2 0 0,0 6,4V16A2,2 0 0,0 8,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M22,16H8V4H20V16M12,6.5L18,10L12,13.5V6.5Z"/></svg>`;
    trailerButtonOverlay.appendChild(trailerButton);
    spotlight.appendChild(trailerButtonOverlay);
    const favoriteButtonOverlay = document.createElement("div");
    favoriteButtonOverlay.className = "favorite-button-overlay";
    const favoriteButton = document.createElement("button");
    favoriteButton.className = "favorite-button"; favoriteButton.setAttribute("aria-label", "Add to Favorites");
    favoriteButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/></svg>`;
    favoriteButtonOverlay.appendChild(favoriteButton);
    spotlight.appendChild(favoriteButtonOverlay);
    const controlsWrapper = document.createElement("div");
    controlsWrapper.className = "controls-wrapper";
    const controls = document.createElement("div");
    controls.className = "controls";
    for (let i = 0; i < items.length; i++) { const c = document.createElement("button"); c.className = "control"; if (i === 0) c.classList.add("active"); c.dataset.index = i + 1; c.setAttribute("aria-label", `Slide ${i+1}`); controls.appendChild(c); }
    controlsWrapper.appendChild(controls);
    const slideCounter = document.createElement("div");
    slideCounter.className = "slide-counter";
    slideCounter.textContent = `1 / ${items.length}`;
    controlsWrapper.appendChild(slideCounter);
    spotlight.appendChild(controlsWrapper);
    const trailerControls = document.createElement("div");
    trailerControls.className = "trailer-controls";
    const unmuteBtn = document.createElement("button");
    unmuteBtn.className = "trailer-control-btn unmute-btn";
    unmuteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3,9V15H7L12,20V4L7,9H3M16.5,12C16.5,10.83 15.92,9.79 15,9.14V14.86C15.92,14.21 16.5,13.17 16.5,12M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23Z"/></svg>`;
    unmuteBtn.setAttribute("aria-label", "Mute"); unmuteBtn.title = "Mute";
    const closeTrailerBtn = document.createElement("button");
    closeTrailerBtn.className = "trailer-control-btn close-trailer-btn";
    closeTrailerBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>`;
    closeTrailerBtn.setAttribute("aria-label", "Close Trailer"); closeTrailerBtn.title = "Close Trailer";
    trailerControls.appendChild(unmuteBtn);
    trailerControls.appendChild(closeTrailerBtn);
    spotlight.appendChild(trailerControls);
    let progressBarFill = null;
    if (CONFIG.enableProgressBar) {
        const pbc = document.createElement("div"); pbc.className = "progress-bar-container";
        progressBarFill = document.createElement("div"); progressBarFill.className = "progress-bar-fill";
        pbc.appendChild(progressBarFill); spotlight.appendChild(pbc);
    }
    container.appendChild(spotlight);
    return { container, spotlight, slider, btnLeft, btnRight, controls, controlsWrapper, slideCounter, sliderWrapper, playButtonOverlay, favoriteButtonOverlay, progressBarFill, trailerButtonOverlay, trailerControls, unmuteBtn, closeTrailerBtn };
}

function playItem(itemId, serverId, apiClient) {
    let sid = serverId;
    if (!sid && apiClient) sid = getServerId(apiClient);
    if (window.require) { try { window.require(['playbackManager'], function(pm) { if (pm?.play) pm.play({ ids: [itemId], serverId: sid }); }); return; } catch (e) {} }
    if (window.appRouter?.showItem) { window.appRouter.showItem(itemId, sid); setTimeout(() => { const pb = document.querySelector('.btnPlay'); if (pb) pb.click(); }, 500); }
}

function navigateToItem(itemId, serverId, apiClient) {
    let sid = serverId;
    if (!sid && apiClient) sid = getServerId(apiClient);
    if (!sid) { try { sid = new URLSearchParams(window.location.search).get("serverId"); } catch (e) {} }
    if (!sid && window.localStorage) { try { sid = window.localStorage.getItem("serverId"); } catch (e) {} }
    if (window.appRouter?.showItem) { window.appRouter.showItem(itemId, sid); return; }
    if (window.Dashboard?.navigate) { window.Dashboard.navigate(sid ? `#!/item?id=${itemId}&serverId=${sid}` : `#!/item?id=${itemId}`); return; }
    if (typeof window.page === "function") { window.page(sid ? `#!/item?id=${itemId}&serverId=${sid}` : `#!/item?id=${itemId}`); return; }
    if (typeof require === "function") { try { require(['appRouter'], function(r) { if (r?.showItem) r.showItem(itemId, sid); else if (r?.show) r.show(sid ? `#!/item?id=${itemId}&serverId=${sid}` : `#!/item?id=${itemId}`); }); return; } catch (e) {} }
    window.location.hash = sid ? `#!/item?id=${itemId}&serverId=${sid}` : `#!/item?id=${itemId}`;
    setTimeout(() => { if (window.location.hash.includes(itemId)) window.location.reload(); }, 100);
}

function attachSliderBehavior(state, apiClient) {
    const { slider, btnLeft, btnRight, controls, controlsWrapper, slideCounter, spotlight, favoriteButtonOverlay, progressBarFill, container } = state;
    let itemsCount = state.itemsCount;
    let currentIndex = 1, cyclesCompleted = 0, isSwapping = false;
    let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0, isSwiping = false, swipeStartTime = 0;
    let autoplayTimer = null, progressTimer = null, isAutoplayPaused = false;
    let trailerActive = false, trailerIframe = null, trailerMuted = true;

    function startProgress() {
        if (!progressBarFill || !CONFIG.enableProgressBar) return;
        stopProgress();
        progressBarFill.classList.remove('paused');
        progressBarFill.style.width = '0%';
        const startTime = performance.now();
        progressTimer = setInterval(() => {
            if (isAutoplayPaused) return;
            const elapsed = performance.now() - startTime;
            progressBarFill.style.width = Math.min(100, (elapsed / CONFIG.autoplayInterval) * 100) + '%';
        }, 50);
    }
    function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }
    function pauseProgress() { if (progressBarFill) progressBarFill.classList.add('paused'); }
    function resumeProgress() { if (progressBarFill) progressBarFill.classList.remove('paused'); }

    function triggerKenBurns() {
        const vi = slider.children[currentIndex];
        if (vi) {
            const cover = vi.querySelector('.banner-cover');
            if (cover) {
                cover.style.animation = 'none';
                void cover.offsetWidth;
                const kb = pickKenBurnsStyle();
                cover.className = 'banner-cover ' + kb.name;
                cover.style.animation = kb.css;
            }
        }
    }
    function updateFavoriteButton() {
        const vi = slider.children[currentIndex];
        if (vi && favoriteButtonOverlay) { const fb = favoriteButtonOverlay.querySelector('.favorite-button'); if (vi.dataset.isFavorite === "true") fb.classList.add('is-favorite'); else fb.classList.remove('is-favorite'); }
    }
    function updateSlideCounter() {
        if (slideCounter) { const ri = ((currentIndex - 1 + itemsCount) % itemsCount) + 1; slideCounter.textContent = `${ri} / ${itemsCount}`; }
    }

    function stopTrailer() {
        if (trailerIframe) { trailerIframe.src = ''; trailerIframe.remove(); trailerIframe = null; }
        const vi = slider.children[currentIndex];
        if (vi) { const tc = vi.querySelector('.trailer-container'); if (tc) tc.classList.remove('active'); vi.classList.remove('show-trailer'); }
        trailerActive = false; trailerMuted = true;
        const ub = state.trailerControls?.querySelector('.unmute-btn');
        if (ub) { ub.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3,9V15H7L12,20V4L7,9H3M16.5,12C16.5,10.83 15.92,9.79 15,9.14V14.86C15.92,14.21 16.5,13.17 16.5,12M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23Z"/></svg>`; ub.title = "Mute"; }
        startAutoplay();
        startProgress();
    }
    function startTrailer() {
        const vi = slider.children[currentIndex];
        if (!vi) return;
        const trailerId = vi.dataset.trailerId;
        if (!trailerId) return;
        const tc = vi.querySelector('.trailer-container');
        if (!tc) return;
        if (trailerIframe) { trailerIframe.src = ''; trailerIframe.remove(); }
        stopAutoplay();
        stopProgress();
        vi.classList.add('show-trailer');
        const params = new URLSearchParams({ autoplay: '1', mute: CONFIG.trailerStartMuted ? '1' : '0', controls: '1', modestbranding: '1', rel: '0', playsinline: '1', enablejsapi: '1' });
        trailerIframe = document.createElement('iframe');
        trailerIframe.className = 'trailer-iframe';
        trailerIframe.src = `https://www.youtube.com/embed/${trailerId}?${params.toString()}`;
        trailerIframe.allow = 'autoplay; encrypted-media; fullscreen';
        trailerIframe.allowFullscreen = true;
        tc.appendChild(trailerIframe);
        trailerMuted = CONFIG.trailerStartMuted;
        trailerActive = true;
        requestAnimationFrame(() => tc.classList.add('active'));
    }
    function toggleTrailerMute() {
        if (!trailerIframe) return;
        trailerMuted = !trailerMuted;
        // Try YouTube IFrame API postMessage first
        const cmd = trailerMuted ? 'mute' : 'unMute';
        trailerIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: cmd, args: [] }), '*');
        if (!trailerMuted) {
            trailerIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
        }
        const ub = state.trailerControls?.querySelector('.unmute-btn');
        if (ub) {
            if (trailerMuted) { ub.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.52C15.59,18 14.84,18.35 14,18.53V20.59C15.28,20.38 16.5,19.9 17.5,19.18L19.73,21.41L21,20.14L4.27,3M19,12C19,12.82 18.86,13.61 18.61,14.34L20.12,15.85C20.68,14.66 21,13.37 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M12,4L9.91,6.09L12,8.18V4Z"/></svg>`; ub.title = "Unmute"; }
            else { ub.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3,9V15H7L12,20V4L7,9H3M16.5,12C16.5,10.83 15.92,9.79 15,9.14V14.86C15.92,14.21 16.5,13.17 16.5,12M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23Z"/></svg>`; ub.title = "Mute"; }
        }
    }
    function updateTrailerButtonVisibility() {
        const vi = slider.children[currentIndex];
        const hasTrailer = vi?.dataset?.trailerId;
        if (state.trailerButtonOverlay) state.trailerButtonOverlay.style.display = hasTrailer ? '' : 'none';
    }
    function updateTransform(index, animate) {
        const w = spotlight.querySelector('.banner-slider-wrapper').getBoundingClientRect().width;
        slider.style.transition = animate ? "transform .5s ease" : "none";
        slider.style.transform = `translate3d(${Math.round(-(index * w))}px, 0, 0)`;
        void slider.offsetHeight;
    }
    function setActiveDot(idx) {
        controls.querySelectorAll(".control").forEach(d => d.classList.remove("active"));
        const ri = ((idx - 1 + itemsCount) % itemsCount);
        const dot = controls.querySelectorAll(".control")[ri];
        if (dot) dot.classList.add("active");
    }
    function resetOverviews() {
        slider.querySelectorAll('.banner-item').forEach(item => {
            const o = item.querySelector('.banner-overview'), l = item.querySelector('.banner-logo'), t = item.querySelector('.banner-title'), tg = item.querySelector('.banner-tagline');
            if (o) o.classList.remove('visible'); item.classList.remove('show-overview');
            if (l) l.classList.remove('hidden'); if (t) t.classList.remove('hidden'); if (tg) tg.classList.remove('hidden');
        });
    }

    function swapGroup(newItems) {
        if (!newItems?.length) return;
        isSwapping = true;
        // Instant swap — no crossfade. The old content is already off-screen
        // (we intercepted the wrap), so we just replace and show new slide 1.
        while (slider.firstChild) slider.removeChild(slider.firstChild);
        const frag = document.createDocumentFragment();
        newItems.forEach(it => frag.appendChild(createBannerElement(it, apiClient)));
        slider.appendChild(frag);
        if (newItems.length > 1) { const f = slider.children[0].cloneNode(true); const l = slider.children[slider.children.length - 1].cloneNode(true); slider.appendChild(f); slider.insertBefore(l, slider.children[0]); }
        while (controls.firstChild) controls.removeChild(controls.firstChild);
        newItems.forEach((_, i) => { const c = document.createElement("button"); c.className = "control"; if (i === 0) c.classList.add("active"); c.dataset.index = i + 1; c.setAttribute("aria-label", `Slide ${i+1}`); controls.appendChild(c); });
        itemsCount = newItems.length; state.itemsCount = itemsCount; currentIndex = 1;
        updateTransform(currentIndex, false); setActiveDot(currentIndex); updateFavoriteButton(); updateSlideCounter(); triggerKenBurns();
        isSwapping = false;
        startProgress();
    }
    state.swapGroup = swapGroup;

    const resizeHandler = () => { updateTransform(currentIndex, false); void slider.offsetHeight; };
    window.addEventListener("resize", resizeHandler);
    setTimeout(() => { updateTransform(currentIndex, false); setActiveDot(currentIndex); triggerKenBurns(); updateFavoriteButton(); updateSlideCounter(); updateTrailerButtonVisibility(); startProgress(); }, 50);

    btnRight.addEventListener("click", (e) => { e.stopPropagation(); currentIndex++; animate(); });
    btnLeft.addEventListener("click", (e) => { e.stopPropagation(); currentIndex--; animate(); });
    controls.addEventListener("click", (e) => { e.stopPropagation(); if (e.target.classList.contains("control")) { resetOverviews(); currentIndex = parseInt(e.target.dataset.index, 10); updateTransform(currentIndex, true); setActiveDot(currentIndex); updateFavoriteButton(); updateSlideCounter(); setTimeout(() => { triggerKenBurns(); startProgress(); }, 100); } });

    function animate() {
        if (trailerActive) stopTrailer();
        // Check if we're about to wrap forward past the last slide
        if (CONFIG.autoAdvanceOnCycle && !isSwapping && currentIndex === itemsCount + 1) {
            // Forward wrap — DON'T show old slide 1. Swap to new batch instead.
            if (STATE.nextGroupReady) {
                // Preloaded — swap immediately, no old content shown
                cyclesCompleted++;
                if (typeof state.onCycleComplete === 'function') state.onCycleComplete();
            } else {
                // Not preloaded — snap back to last slide and wait for preload
                currentIndex = itemsCount;
                updateTransform(currentIndex, false);
                setActiveDot(currentIndex);
                updateFavoriteButton();
                updateSlideCounter();
                setTimeout(() => { triggerKenBurns(); startProgress(); }, 100);
                // Trigger preload and swap when ready
                if (typeof state.preloadNext === 'function') {
                    state.preloadNext().then(() => {
                        if (STATE.nextGroupReady && !isSwapping) {
                            cyclesCompleted++;
                            if (typeof state.onCycleComplete === 'function') state.onCycleComplete();
                        }
                    });
                }
            }
            return;
        }

        // Normal slide navigation
        resetOverviews(); updateTransform(currentIndex, true); setActiveDot(currentIndex); updateFavoriteButton(); updateSlideCounter();
        setTimeout(() => { triggerKenBurns(); startProgress(); }, 100);

        // Preload next group when 2 slides before cycle end
        if (CONFIG.autoAdvanceOnCycle && !isSwapping && !STATE.nextGroupReady && currentIndex === itemsCount - 1 && typeof state.preloadNext === 'function') state.preloadNext();

        // Backward wrap (slide 0 → last slide) — no swap needed
        setTimeout(() => {
            if (currentIndex === 0) {
                currentIndex = itemsCount; updateTransform(currentIndex, false); setActiveDot(currentIndex); updateFavoriteButton(); updateSlideCounter();
                setTimeout(() => { triggerKenBurns(); startProgress(); }, 100);
            }
        }, 520);
    }

    if (CONFIG.enableSwipe) {
        slider.addEventListener('touchstart', (e) => {
            if (e.target.closest('.play-button-overlay') || e.target.closest('.favorite-button-overlay') || e.target.closest('.arrow') || e.target.closest('.controls') || e.target.closest('.banner-overview.visible') || e.target.closest('.banner-genre')) return;
            touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; swipeStartTime = Date.now(); isSwiping = false;
        }, { passive: true });
        slider.addEventListener('touchmove', (e) => {
            if (touchStartX === 0) return;
            const dx = Math.abs(e.touches[0].clientX - touchStartX), dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > dy && dx > 10) { isSwiping = true; e.preventDefault(); }
        }, { passive: false });
        slider.addEventListener('touchend', (e) => {
            if (!isSwiping || touchStartX === 0) { touchStartX = 0; touchStartY = 0; isSwiping = false; return; }
            touchEndX = e.changedTouches[0].clientX;
            const sd = touchEndX - touchStartX, st = Date.now() - swipeStartTime, ss = Math.abs(sd) / st;
            if (Math.abs(sd) > CONFIG.swipeThreshold || ss > 0.5) { if (sd < 0) currentIndex++; else currentIndex--; animate(); }
            touchStartX = 0; touchStartY = 0; touchEndX = 0; touchEndY = 0; isSwiping = false;
        }, { passive: true });
        slider.addEventListener('touchcancel', () => { touchStartX = 0; touchStartY = 0; isSwiping = false; }, { passive: true });
    }

    slider.addEventListener("click", (e) => {
        if (isSwiping) return;
        if (e.target.closest('.arrow') || e.target.closest('.controls') || e.target.closest('.play-button-overlay') || e.target.closest('.favorite-button-overlay') || e.target.closest('.banner-genre')) return;
        const oe = e.target.closest('.banner-overview'), le = e.target.closest('.banner-logo'), te = e.target.closest('.banner-title');
        if (oe) { const bi = oe.closest('.banner-item'); const o = bi.querySelector('.banner-overview'), l = bi.querySelector('.banner-logo'), t = bi.querySelector('.banner-title'), tg = bi.querySelector('.banner-tagline'); if (o) o.classList.remove('visible'); bi.classList.remove('show-overview'); if (l) l.classList.remove('hidden'); if (t) t.classList.remove('hidden'); if (tg) tg.classList.remove('hidden'); return; }
        if (le || te) { const bi = (le || te).closest('.banner-item'); const o = bi.querySelector('.banner-overview'); if (o) { o.classList.add('visible'); bi.classList.add('show-overview'); const l = bi.querySelector('.banner-logo'), t = bi.querySelector('.banner-title'), tg = bi.querySelector('.banner-tagline'); if (l) l.classList.add('hidden'); if (t) t.classList.add('hidden'); if (tg) tg.classList.add('hidden'); } return; }
        let node = e.target;
        while (node && node !== slider && !(node.dataset && node.dataset.itemId)) node = node.parentElement;
        if (node?.dataset?.itemId) navigateToItem(node.dataset.itemId, node.dataset.serverId, apiClient);
    });

    const playButtonOverlay = spotlight.querySelector('.play-button-overlay');
    if (playButtonOverlay) playButtonOverlay.addEventListener("click", (e) => { e.stopPropagation(); const vi = slider.children[currentIndex]; if (vi?.dataset?.itemId) playItem(vi.dataset.itemId, vi.dataset.serverId, apiClient); });
    const trailerBtnOverlay = spotlight.querySelector('.trailer-button-overlay');
    if (trailerBtnOverlay) trailerBtnOverlay.addEventListener("click", (e) => { e.stopPropagation(); if (trailerActive) stopTrailer(); else startTrailer(); });
    if (state.unmuteBtn) state.unmuteBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleTrailerMute(); });
    if (state.closeTrailerBtn) state.closeTrailerBtn.addEventListener("click", (e) => { e.stopPropagation(); stopTrailer(); });
    if (favoriteButtonOverlay) favoriteButtonOverlay.addEventListener("click", async (e) => {
        e.stopPropagation(); const vi = slider.children[currentIndex];
        if (vi?.dataset?.itemId) { const itemId = vi.dataset.itemId; const isFav = vi.dataset.isFavorite === "true"; const newState = await toggleFavorite(itemId, apiClient, isFav); vi.dataset.isFavorite = newState ? "true" : "false"; slider.querySelectorAll(`.banner-item[data-item-id="${itemId}"]`).forEach(c => c.dataset.isFavorite = newState ? "true" : "false"); updateFavoriteButton(); }
    });

    function startAutoplay() { if (autoplayTimer) clearInterval(autoplayTimer); isAutoplayPaused = false; resumeProgress(); startProgress(); autoplayTimer = setInterval(() => { currentIndex++; animate(); }, CONFIG.autoplayInterval); }
    function stopAutoplay() { if (autoplayTimer) clearInterval(autoplayTimer); autoplayTimer = null; isAutoplayPaused = true; pauseProgress(); }
    spotlight.addEventListener("mouseenter", () => { if (!trailerActive) stopAutoplay(); });
    spotlight.addEventListener("mouseleave", () => { if (!trailerActive) startAutoplay(); });

    let keyboardHandler = null;
    if (CONFIG.enableKeyboard) {
        keyboardHandler = (e) => {
            const rect = container.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); currentIndex--; animate(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); currentIndex++; animate(); }
            else if (e.key === ' ') { e.preventDefault(); if (trailerActive) { stopTrailer(); } else if (autoplayTimer) stopAutoplay(); else startAutoplay(); }
        };
        document.addEventListener("keydown", keyboardHandler);
    }

    startAutoplay();
    state.cleanup = () => { window.removeEventListener("resize", resizeHandler); if (keyboardHandler) document.removeEventListener("keydown", keyboardHandler); stopTrailer(); stopAutoplay(); stopProgress(); };
}

async function init() {
    try {
        if (SPOTLIGHT_INITIALIZED) return;
        if (document.querySelector(`.${SPOTLIGHT_CONTAINER_CLASS}`)) return;
        SPOTLIGHT_INITIALIZED = true;
        const initStart = performance.now();
        insertStyles();
        const home = findHomeContainer();
        if (!home) { SPOTLIGHT_INITIALIZED = false; return; }
        const [connectionManager, ApiClient] = await safeRequire(["connectionManager", "ApiClient"]);
        let apiClient = null;
        try { if (connectionManager?.[0]?.currentApiClient) apiClient = connectionManager[0].currentApiClient(); } catch (e) {}
        if (!apiClient) { try { if (ApiClient?.[0]?.serverAddress) apiClient = ApiClient[0]; } catch (e) {} }
        if (!apiClient && window.ApiClient) apiClient = window.ApiClient;
        if (!apiClient) { SPOTLIGHT_INITIALIZED = false; return; }
        const items = await fetchItems(apiClient);
        if (!items?.length) { SPOTLIGHT_INITIALIZED = false; return; }
        await preloadImages(items, apiClient);
        const { container, spotlight, slider, btnLeft, btnRight, controls, controlsWrapper, slideCounter, favoriteButtonOverlay, progressBarFill, trailerButtonOverlay, trailerControls, unmuteBtn, closeTrailerBtn } = buildSlider(items, apiClient);
        const reference = home.querySelector ? home.querySelector(".homeSectionsContainer") : null;
        if (reference?.parentNode) reference.parentNode.insertBefore(container, reference);
        else home.insertBefore(container, home.firstChild);
        const loader = container.querySelector(".loader");
        if (loader) loader.style.display = "none";
        const sliderState = { slider, itemsCount: items.length, btnLeft, btnRight, controls, controlsWrapper, slideCounter, spotlight, favoriteButtonOverlay, progressBarFill, container, trailerButtonOverlay, trailerControls, unmuteBtn, closeTrailerBtn };
        sliderState.preloadNext = async function() { if (!STATE.nextGroupReady) await preloadNextGroup(apiClient); };
        sliderState.onCycleComplete = function() {
            if (STATE.nextGroupReady) {
                // Group is preloaded — swap immediately, no async delay
                const nextGroup = STATE.nextGroupReady;
                STATE.nextGroupReady = null;
                if (nextGroup?.length > 0 && typeof sliderState.swapGroup === 'function')
                    sliderState.swapGroup(nextGroup);
            } else {
                // Not preloaded yet — swap will show old content briefly,
                // but at least start fetching immediately
                console.warn('[SpotlightTrailer] Next group not preloaded in time, fetching now');
                preloadNextGroup(apiClient).then(group => {
                    STATE.nextGroupReady = null;
                    if (group?.length > 0 && typeof sliderState.swapGroup === 'function')
                        sliderState.swapGroup(group);
                });
            }
        };
        attachSliderBehavior(sliderState, apiClient);
        SPOTLIGHT_INSTANCE = { container, cleanup: null };
        console.log(`[SpotlightTrailer] Initialized in ${Math.round(performance.now() - initStart)}ms with ${items.length} items`);
    } catch (err) { console.error("[SpotlightTrailer] init error", err); SPOTLIGHT_INITIALIZED = false; }
}

function cleanup() {
    if (SPOTLIGHT_INSTANCE?.cleanup) SPOTLIGHT_INSTANCE.cleanup();
    if (SPOTLIGHT_INSTANCE?.container) SPOTLIGHT_INSTANCE.container.remove();
    SPOTLIGHT_INSTANCE = null; SPOTLIGHT_INITIALIZED = false;
    STATE.itemPool = []; STATE.poolCursor = 0; STATE.totalRecordCount = null; STATE.usedStartIndices.clear(); STATE.isFetchingBatch = false; STATE.nextGroupReady = null;
}

function observeViewAndInit() {
    let homeWasVisible = false, initTimeout = null;
    const observer = new MutationObserver(() => {
        const hv = !!document.querySelector(".view:not(.hide) .homeSectionsContainer, .view:not(.hide) [data-view='home'], .view:not(.hide) .view-home-home");
        if (hv && !homeWasVisible) { homeWasVisible = true; if (initTimeout) clearTimeout(initTimeout); initTimeout = setTimeout(() => { if (!SPOTLIGHT_INITIALIZED) init(); }, 50); }
        if (!hv && homeWasVisible) { homeWasVisible = false; cleanup(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { const hv = !!document.querySelector(".view:not(.hide) .homeSectionsContainer, .view:not(.hide) [data-view='home']"); if (hv && !SPOTLIGHT_INITIALIZED) { homeWasVisible = true; init(); } }, 100);
}

observeViewAndInit();
})();
