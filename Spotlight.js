/*!
 * Spotlight.js — Emby 4.9 compatible Spotlight slider (OPTIMIZED v6)
 * Added: Touch/Swipe support for mobile devices
 * Added: libraryId option (use a library ID instead of a collection ID)
 * Generated: 2025-10-26
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
    // Source selection — set ONE of these:
    //   collectionId: use a collection/boxset ID as the parent
    //   libraryId:    use a library ID as the parent
    // If both are set, collectionId takes precedence.
    // If neither is set, the whole server library is used.
    collectionId: 2310256,
    libraryId: null,
    enablePreloading: true,
    enableSwipe: true,
    swipeThreshold: 50,
    spotlightBatchSize: 250,
    autoAdvanceOnCycle: true,
    unplayedOnly: true
};

let SPOTLIGHT_INITIALIZED = false;
let SPOTLIGHT_INSTANCE = null;
const SPOTLIGHT_CONTAINER_CLASS = 'emby-spotlight-slider-container';

const STATE = {
    itemPool: [],
    poolCursor: 0,
    totalRecordCount: null,
    usedStartIndices: new Set(),
    isFetchingBatch: false,
    apiClient: null
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

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1],16), g: parseInt(result[2],16), b: parseInt(result[3],16) } : { r:0, g:0, b:0 };
}

function shuffleArray(array) {
    const s = [...array];
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [s[i],s[j]]=[s[j],s[i]]; }
    return s;
}

function formatRuntime(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes/60), m = minutes%60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function getImageUrl(apiClient, item, options) {
    options = options || {};
    const width = options.width || CONFIG.imageWidth;
    const pref = options.prefer || "Backdrop";
    if (item.ImageUrl) { let u = item.ImageUrl; if (options.addImageSizeToUrl && width) u += "&maxWidth=" + width; return u; }
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

function insertStyles() {
    if (document.getElementById("spotlight-css-emby")) return;
    const rgb = hexToRgb(CONFIG.backgroundColor);
    const rgba = `rgba(${rgb.r},${rgb.g},${rgb.b},1)`;
    const css = `
.spotlight-container{width:94%;display:block;position:relative;margin-top:${CONFIG.marginTop};margin-bottom:${CONFIG.marginBottom};margin-left:auto;margin-right:auto;padding:0;transition:box-shadow .3s ease;border-radius:.5rem;box-shadow:10px 10px 10px 0 rgba(0,0,0,.35)}
.spotlight-container:hover{box-shadow:10px 10px 10px 0 rgba(0,0,0,.35),0 0 2px 4px ${CONFIG.frameColor};border-radius:.5rem}
.spotlight .play-button-overlay{position:absolute;top:2rem;right:2rem;z-index:25;opacity:0;transition:opacity .3s ease;pointer-events:none}
.spotlight-container:hover .play-button-overlay{opacity:1;pointer-events:all}
.spotlight .play-button{width:80px;height:80px;border-radius:50%;background:rgba(55,55,55,.3);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s ease;box-shadow:0 4px 12px rgba(0,0,0,.4)}
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
.spotlight .banner-slider-wrapper{position:relative;width:100%;overflow:hidden;border-radius:.5rem;background-color:${CONFIG.backgroundColor};-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);touch-action:pan-y}
.spotlight .banner-slider{display:flex;transition:transform .5s ease;will-change:transform;margin:0;padding:0;width:100%;touch-action:pan-y}
.spotlight .banner-item{flex:0 0 100%;min-width:100%;max-width:100%;position:relative;cursor:pointer;margin:0;padding:0;box-sizing:border-box;overflow:hidden}
.spotlight .banner-cover{width:100%;height:min(48vmax,54vh);object-fit:cover;object-position:center;display:block;pointer-events:none;margin:0;padding:0;border:0;outline:0;position:relative;transform-origin:center center;animation:zoomOut 8s ease-out forwards}
@keyframes zoomOut{0%{transform:scale(1.15)}100%{transform:scale(1)}}
.spotlight .banner-gradient-left{position:absolute;top:0;bottom:0;left:0;width:35%;pointer-events:none;z-index:6;background:linear-gradient(to right,${rgba} 0%,${rgba} 3%,rgba(${rgb.r},${rgb.g},${rgb.b},.98) 6%,rgba(${rgb.r},${rgb.g},${rgb.b},.95) 10%,rgba(${rgb.r},${rgb.g},${rgb.b},.92) 15%,rgba(${rgb.r},${rgb.g},${rgb.b},.87) 20%,rgba(${rgb.r},${rgb.g},${rgb.b},.8) 25%,rgba(${rgb.r},${rgb.g},${rgb.b},.7) 35%,rgba(${rgb.r},${rgb.g},${rgb.b},.55) 45%,rgba(${rgb.r},${rgb.g},${rgb.b},.4) 55%,rgba(${rgb.r},${rgb.g},${rgb.b},.25) 65%,rgba(${rgb.r},${rgb.g},${rgb.b},.15) 75%,rgba(${rgb.r},${rgb.g},${rgb.b},.08) 85%,rgba(${rgb.r},${rgb.g},${rgb.b},.03) 92%,transparent 100%)}
.spotlight .banner-gradient-right{position:absolute;top:0;bottom:0;right:0;width:35%;pointer-events:none;z-index:6;background:linear-gradient(to left,${rgba} 0%,${rgba} 3%,rgba(${rgb.r},${rgb.g},${rgb.b},.98) 6%,rgba(${rgb.r},${rgb.g},${rgb.b},.95) 10%,rgba(${rgb.r},${rgb.g},${rgb.b},.92) 15%,rgba(${rgb.r},${rgb.g},${rgb.b},.87) 20%,rgba(${rgb.r},${rgb.g},${rgb.b},.8) 25%,rgba(${rgb.r},${rgb.g},${rgb.b},.7) 35%,rgba(${rgb.r},${rgb.g},${rgb.b},.55) 45%,rgba(${rgb.r},${rgb.g},${rgb.b},.4) 55%,rgba(${rgb.r},${rgb.g},${rgb.b},.25) 65%,rgba(${rgb.r},${rgb.g},${rgb.b},.15) 75%,rgba(${rgb.r},${rgb.g},${rgb.b},.08) 85%,rgba(${rgb.r},${rgb.g},${rgb.b},.03) 92%,transparent 100%)}
.spotlight .banner-vignette-top{position:absolute;top:0;left:0;right:0;height:30%;background:linear-gradient(to bottom,rgba(${rgb.r},${rgb.g},${rgb.b},.85) 0%,rgba(${rgb.r},${rgb.g},${rgb.b},.6) 30%,rgba(${rgb.r},${rgb.g},${rgb.b},.3) 60%,transparent 100%);pointer-events:none;z-index:6}
.spotlight .banner-vignette-bottom{position:absolute;bottom:0;left:0;right:0;height:30%;background:linear-gradient(to top,rgba(${rgb.r},${rgb.g},${rgb.b},.85) 0%,rgba(${rgb.r},${rgb.g},${rgb.b},.6) 30%,rgba(${rgb.r},${rgb.g},${rgb.b},.3) 60%,transparent 100%);pointer-events:none;z-index:6}
.spotlight .banner-logo{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);max-width:60%;max-height:50%;object-fit:contain;z-index:15;filter:drop-shadow(0 6px 20px rgba(0,0,0,.95)) drop-shadow(0 0 40px rgba(0,0,0,.6));pointer-events:auto;cursor:pointer;transition:transform .5s ease,opacity .3s ease}
.spotlight-container:hover .banner-logo{transform:translate(-50%,-50%) scale(1.1)}
.spotlight .banner-logo.hidden{opacity:0;pointer-events:none}
.spotlight .banner-title{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);z-index:10;font-size:clamp(1.5rem,3.5vw,3rem);font-weight:700;color:#fff;text-shadow:2px 2px 8px rgba(0,0,0,.9);pointer-events:auto;cursor:pointer;text-align:center;max-width:80%;transition:transform .5s ease,opacity .3s ease}
.spotlight-container:hover .banner-title{transform:translate(-50%,-50%) scale(1.1)}
.spotlight .banner-title.hidden{opacity:0;pointer-events:none}
.spotlight .banner-overview{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);z-index:16;max-width:70%;padding:0;background:none;opacity:0;pointer-events:none;cursor:pointer;transition:opacity .3s ease}
.spotlight .banner-overview.visible{opacity:1;pointer-events:auto}
.spotlight .banner-overview-text{font-size:clamp(1.1rem,1.8vw,1.4rem);color:rgba(255,255,255,.9);text-shadow:2px 2px 8px rgba(0,0,0,.99),0 0 20px rgba(0,0,0,.9);font-weight:500;line-height:1.6;text-align:center;max-height:40vh;overflow-y:auto}
@media(max-width:768px),(orientation:portrait){.spotlight .banner-overview{max-width:85%}.spotlight .banner-overview-text{font-size:clamp(.9rem,1.5vw,1.1rem);line-height:1.4;max-height:25vh;overflow-y:auto}}
.spotlight .banner-tagline{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);z-index:10;font-size:clamp(1.3rem,2vw,1.6rem);font-weight:500;color:rgba(255,255,255,.9);text-shadow:1px 1px 4px rgba(0,0,0,.9);pointer-events:none;text-align:center;max-width:60%;transition:opacity .3s ease}
.spotlight .banner-tagline.hidden{opacity:0}
@media(max-width:1500px){.spotlight .banner-tagline{display:none}}
.spotlight .banner-info{position:absolute;left:3vmin;bottom:1.5rem;z-index:10;display:flex;flex-direction:column;align-items:flex-start;gap:.5rem;pointer-events:none;max-width:60%}
.spotlight .banner-genres{display:flex;gap:.8rem;flex-wrap:wrap}
.spotlight .banner-genre{font-size:clamp(1.1rem,1.8vw,1.4rem);color:rgba(255,255,255,.9);text-shadow:1px 1px 4px rgba(0,0,0,.9);font-weight:500}
.spotlight .banner-genre:not(:last-child)::after{content:'•';margin-left:.8rem;opacity:.6}
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
.spotlight .controls{position:absolute;right:2rem;bottom:2rem;z-index:20;display:flex;gap:.5rem}
.spotlight .control{width:.8rem;height:.8rem;border-radius:50%;background:rgba(255,255,255,.4);border:none;cursor:pointer;transition:background .3s}
.spotlight .control.active{background:#fff}
@media(max-width:768px),(orientation:portrait){.spotlight .control{display:none}}
.spotlight .loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:30;background:rgba(0,0,0,.3)}
`;
    const s = document.createElement("style");
    s.id = "spotlight-css-emby";
    s.innerHTML = css;
    document.head.appendChild(s);
}

function buildQuery(parentId, options) {
    options = options || {};
    const q = { IncludeItemTypes:"Movie,Series", Recursive:true, SortBy:"ProductionYear,SortName", SortOrder:"Descending", EnableImageTypes:"Primary,Backdrop,Thumb,Logo,Banner", EnableUserData:true, EnableTotalRecordCount:options.enableTotal !== false, Fields:"PrimaryImageAspectRatio,BackdropImageTags,ImageTags,ParentLogoImageTag,ParentLogoItemId,CriticRating,CommunityRating,OfficialRating,PremiereDate,ProductionYear,Genres,RunTimeTicks,Taglines,Overview" };
    if (CONFIG.unplayedOnly) q.IsPlayed = false;
    q.Limit = options.limit != null ? options.limit : CONFIG.limit;
    if (options.startIndex != null) q.StartIndex = options.startIndex;
    if (parentId) { q.ParentId = parentId; console.log("[Spotlight] Loading from parentId:", parentId); }
    return q;
}

async function toggleFavorite(itemId, apiClient, isFavorite) {
    try {
        const userId = apiClient.getCurrentUserId();
        const url = apiClient.getUrl(`/Users/${userId}/FavoriteItems/${itemId}`);
        const response = await fetch(url, { method: isFavorite ? 'DELETE' : 'POST', headers: { 'X-Emby-Token': apiClient.accessToken() } });
        if (response.ok) { console.log(`[Spotlight] ${isFavorite?'Removed from':'Added to'} favorites:`, itemId); return !isFavorite; }
    } catch (error) { console.error("[Spotlight] Error toggling favorite:", error); }
    return isFavorite;
}

async function loadCustomItemsList() {
    try {
        const response = await fetch(`${CONFIG.customItemsFile}?t=${Date.now()}`, { cache:'no-store', headers:{'Cache-Control':'no-cache','Pragma':'no-cache'} });
        if (!response.ok) { if (response.status === 404) { console.log("[Spotlight] Custom items file not found, using standard mode"); return null; } throw new Error(`HTTP error! status: ${response.status}`); }
        const text = await response.text();
        const itemIds = text.split('\n').map(l=>l.trim()).filter(l=>l.length>0&&!l.startsWith('#')).filter(l=>/^[a-zA-Z0-9]+$/.test(l));
        if (itemIds.length === 0) { console.warn("[Spotlight] Custom items file is empty"); return null; }
        console.log(`[Spotlight] Custom items loaded: ${itemIds.length} items`);
        return itemIds;
    } catch (error) { console.warn("[Spotlight] Error loading custom items list:", error); return null; }
}

async function fetchItemsByIds(apiClient, itemIds) {
    try {
        const items = []; const userId = apiClient.getCurrentUserId();
        const shuffledIds = shuffleArray(itemIds);
        const idsToFetch = shuffledIds.slice(0, Math.min(CONFIG.limit*2, shuffledIds.length));
        for (const itemId of idsToFetch) {
            try {
                const item = await apiClient.getItem(userId, itemId);
                if (item) {
                    if (item.Type === "BoxSet" || item.CollectionType === "boxsets") {
                        const ci = await apiClient.getItems(userId, { ParentId:itemId, Recursive:true, IncludeItemTypes:"Movie,Series", Limit:CONFIG.limit, SortBy:"Random", Fields:"PrimaryImageAspectRatio,BackdropImageTags,ImageTags,ParentLogoImageTag,ParentLogoItemId,CriticRating,CommunityRating,OfficialRating,PremiereDate,ProductionYear,Genres,RunTimeTicks,Taglines,Overview" });
                        if (ci && ci.Items) items.push(...ci.Items);
                    } else { items.push(item); }
                }
                if (items.length >= CONFIG.limit) break;
            } catch (error) { console.warn(`[Spotlight] Error loading item ${itemId}:`, error); }
        }
        console.log(`[Spotlight] Total ${items.length} items loaded`);
        return items;
    } catch (error) { console.error("[Spotlight] Error fetching custom items:", error); return []; }
}

async function fetchItems(apiClient) {
    const customItemIds = await loadCustomItemsList();
    if (customItemIds && customItemIds.length > 0) {
        console.log("[Spotlight] Custom items mode active");
        const items = await fetchItemsByIds(apiClient, customItemIds);
        if (items.length === 0) { console.warn("[Spotlight] No custom items loaded, falling back"); return fetchStandardItems(apiClient); }
        const shuffled = shuffleArray(items);
        return shuffled.slice(0, Math.min(CONFIG.limit, shuffled.length));
    }
    console.log("[Spotlight] Standard mode active");
    return fetchStandardItems(apiClient);
}

function getRandomStartIndex(batchSize) {
    const total = STATE.totalRecordCount;
    if (!total || total <= batchSize) return 0;
    const maxStart = total - batchSize;
    const possible = [];
    for (let s = 0; s <= maxStart; s += batchSize) { if (!STATE.usedStartIndices.has(s)) possible.push(s); }
    if (possible.length === 0) { STATE.usedStartIndices.clear(); for (let s = 0; s <= maxStart; s += batchSize) possible.push(s); }
    const chosen = possible[Math.floor(Math.random() * possible.length)];
    STATE.usedStartIndices.add(chosen);
    return chosen;
}

async function fetchInitialGroup(apiClient, parentId) {
    const fetchSize = CONFIG.limit * 2;

    // Preflight: tiny query to learn TotalRecordCount so we can pick a random window
    if (STATE.totalRecordCount == null) {
        try {
            const preflightQ = buildQuery(parentId, { limit: 1, enableTotal: true });
            const preflight = await apiClient.getItems(apiClient.getCurrentUserId(), preflightQ);
            if (preflight && typeof preflight.TotalRecordCount === 'number') {
                STATE.totalRecordCount = preflight.TotalRecordCount;
                console.log(`[Spotlight] Preflight total unplayed items: ${STATE.totalRecordCount}`);
            }
        } catch (e) { console.warn("[Spotlight] Preflight count query failed", e); }
    }

    const startIndex = getRandomStartIndex(fetchSize);
    const q = buildQuery(parentId, { limit: fetchSize, startIndex, enableTotal: false });
    console.log(`[Spotlight] Initial fetch: startIndex=${startIndex}, limit=${fetchSize}`);
    const result = await apiClient.getItems(apiClient.getCurrentUserId(), q);
    const allItems = (result && result.Items) || [];
    console.log(`[Spotlight] Initial fetch returned ${allItems.length} items`);
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
        console.log(`[Spotlight] Background batch: startIndex=${startIndex}, limit=${batchSize}`);
        const result = await apiClient.getItems(apiClient.getCurrentUserId(), q);
        const items = (result && result.Items) || [];
        const existingIds = new Set(STATE.itemPool.map(i => i.Id));
        const newItems = items.filter(i => !existingIds.has(i.Id));
        STATE.itemPool.push(...newItems);
        console.log(`[Spotlight] Pool size after batch: ${STATE.itemPool.length} (+${newItems.length} new)`);
    } catch (e) { console.warn("[Spotlight] Background batch fetch failed", e); }
    finally { STATE.isFetchingBatch = false; }
}

function getNextGroupFromPool() {
    const remaining = STATE.itemPool.length - STATE.poolCursor;
    if (remaining < CONFIG.limit && !STATE.isFetchingBatch && STATE.apiClient) { const pid = CONFIG.collectionId || CONFIG.libraryId || null; fetchBatch(STATE.apiClient, pid); }
    if (remaining <= 0) { console.log("[Spotlight] Pool exhausted, no new group yet"); return null; }
    const group = STATE.itemPool.slice(STATE.poolCursor, STATE.poolCursor + CONFIG.limit);
    STATE.poolCursor += group.length;
    console.log(`[Spotlight] Pulled ${group.length} from pool (cursor ${STATE.poolCursor})`);
    return group;
}

async function fetchStandardItems(apiClient) {
    STATE.apiClient = apiClient;
    const parentId = CONFIG.collectionId || CONFIG.libraryId || null;
    try {
        const displayItems = await fetchInitialGroup(apiClient, parentId);
        fetchBatch(apiClient, parentId);
        return displayItems;
    } catch (e) { console.warn("[Spotlight] Error fetching initial items", e); return []; }
}

function createInfoElement(item) {
    const infoContainer = document.createElement("div");
    infoContainer.className = "banner-info";
    if (item.Genres && item.Genres.length > 0) {
        const genresDiv = document.createElement("div");
        genresDiv.className = "banner-genres";
        item.Genres.slice(0,3).forEach(g => { const s=document.createElement("span"); s.className="banner-genre"; s.textContent=g; genresDiv.appendChild(s); });
        infoContainer.appendChild(genresDiv);
    }
    const metaDiv = document.createElement("div");
    metaDiv.className = "banner-meta";
    if (item.ProductionYear) { const y=document.createElement("span"); y.className="banner-meta-item"; y.textContent=item.ProductionYear; metaDiv.appendChild(y); }
    if (item.CriticRating !== null && item.CriticRating !== undefined) {
        const r=document.createElement("div"); r.className="meta-rating-item banner-meta-item";
        const img = item.CriticRating >= 60 ? 'fresh.png' : 'rotten.png';
        r.innerHTML = `<img src="modules/mediainfo/${img}" alt="RT" class="meta-rating-icon"><span class="meta-rating-score">${item.CriticRating}%</span>`;
        metaDiv.appendChild(r);
    }
    if (item.CommunityRating) {
        const i=document.createElement("div"); i.className="meta-rating-item banner-meta-item";
        i.innerHTML = `<svg class="meta-rating-star" viewBox="0 0 24 24"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg><span class="meta-rating-score">${item.CommunityRating.toFixed(1)}</span>`;
        metaDiv.appendChild(i);
    }
    if (item.RunTimeTicks) { const rt=Math.round(item.RunTimeTicks/600000000); const s=document.createElement("span"); s.className="banner-meta-item"; s.textContent=formatRuntime(rt); metaDiv.appendChild(s); }
    if (metaDiv.children.length > 0) infoContainer.appendChild(metaDiv);
    return infoContainer.children.length > 0 ? infoContainer : null;
}

function createBannerElement(item, apiClient) {
    const div = document.createElement("div"); div.className = "banner-item";
    const img = document.createElement("img"); img.className="banner-cover"; img.draggable=false; img.alt=item.Name||""; img.loading="eager"; img.decoding="async";
    img.src = getImageUrl(apiClient, item, { width: CONFIG.imageWidth, prefer: "Backdrop" }); div.appendChild(img);
    ['banner-gradient-left','banner-gradient-right','banner-vignette-top','banner-vignette-bottom'].forEach(c => { const e=document.createElement("div"); e.className=c; div.appendChild(e); });
    const logoUrl = getLogoUrl(apiClient, item);
    if (logoUrl) { const l=document.createElement("img"); l.className="banner-logo"; l.src=logoUrl; l.alt=(item.Name||"")+" Logo"; l.draggable=false; div.appendChild(l); }
    else { const t=document.createElement("div"); t.className="banner-title"; t.textContent=item.Name||""; div.appendChild(t); }
    if (item.Taglines && item.Taglines.length > 0) { const t=document.createElement("div"); t.className="banner-tagline"; t.textContent=item.Taglines[0]; div.appendChild(t); }
    if (item.Overview) { const oc=document.createElement("div"); oc.className="banner-overview"; const ot=document.createElement("div"); ot.className="banner-overview-text"; ot.textContent=item.Overview; oc.appendChild(ot); div.appendChild(oc); }
    const info = createInfoElement(item); if (info) div.appendChild(info);
    div.dataset.itemId = item.Id;
    div.dataset.isFavorite = item.UserData && item.UserData.IsFavorite ? "true" : "false";
    if (item.ServerId) div.dataset.serverId = item.ServerId;
    return div;
}

function buildSlider(items, apiClient) {
    const container = document.createElement("div"); container.className = `spotlight-container ${SPOTLIGHT_CONTAINER_CLASS}`;
    const spotlight = document.createElement("div"); spotlight.className = "spotlight";
    const loader = document.createElement("div"); loader.className = "loader"; loader.innerHTML = "Loading…"; spotlight.appendChild(loader);
    const sliderWrapper = document.createElement("div"); sliderWrapper.className = "banner-slider-wrapper";
    const slider = document.createElement("div"); slider.className = "banner-slider";
    const fragment = document.createDocumentFragment();
    items.forEach(it => fragment.appendChild(createBannerElement(it, apiClient)));
    slider.appendChild(fragment);
    if (items.length > 1) { const first=slider.children[0].cloneNode(true); const last=slider.children[slider.children.length-1].cloneNode(true); slider.appendChild(first); slider.insertBefore(last, slider.children[0]); }
    sliderWrapper.appendChild(slider); spotlight.appendChild(sliderWrapper);
    const btnLeft = document.createElement("button"); btnLeft.className="arrow left"; btnLeft.innerHTML=`<svg width="60" height="60" viewBox="0 0 24 24" fill="white"><path d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>`; btnLeft.setAttribute("aria-label","Previous");
    const btnRight = document.createElement("button"); btnRight.className="arrow right"; btnRight.innerHTML=`<svg width="60" height="60" viewBox="0 0 24 24" fill="white"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>`; btnRight.setAttribute("aria-label","Next");
    spotlight.appendChild(btnLeft); spotlight.appendChild(btnRight);
    const playButtonOverlay = document.createElement("div"); playButtonOverlay.className="play-button-overlay";
    const playButton = document.createElement("button"); playButton.className="play-button"; playButton.setAttribute("aria-label","Play"); playButton.innerHTML=`<svg viewBox="0 0 24 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>`;
    playButtonOverlay.appendChild(playButton); spotlight.appendChild(playButtonOverlay);
    const favoriteButtonOverlay = document.createElement("div"); favoriteButtonOverlay.className="favorite-button-overlay";
    const favoriteButton = document.createElement("button"); favoriteButton.className="favorite-button"; favoriteButton.setAttribute("aria-label","Add to Favorites"); favoriteButton.innerHTML=`<svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/></svg>`;
    favoriteButtonOverlay.appendChild(favoriteButton); spotlight.appendChild(favoriteButtonOverlay);
    const controls = document.createElement("div"); controls.className = "controls";
    for (let i = 0; i < items.length; i++) { const c=document.createElement("button"); c.className="control"; if(i===0)c.classList.add("active"); c.dataset.index=i+1; c.setAttribute("aria-label",`Slide ${i+1}`); controls.appendChild(c); }
    spotlight.appendChild(controls); container.appendChild(spotlight);
    return { container, spotlight, slider, btnLeft, btnRight, controls, sliderWrapper, playButtonOverlay, favoriteButtonOverlay };
}

function playItem(itemId, serverId, apiClient) {
    let sid = serverId;
    if (!sid && apiClient) { sid = apiClient.serverId || apiClient.serverInfo?.Id || apiClient._serverInfo?.Id; }
    if (window.require) { try { window.require(['playbackManager'], function(pm) { if (pm?.play) pm.play({ ids:[itemId], serverId:sid }); }); return; } catch(e){} }
    if (window.appRouter?.showItem) { window.appRouter.showItem(itemId, sid); setTimeout(()=>{ const pb=document.querySelector('.btnPlay'); if(pb)pb.click(); }, 500); }
}

function navigateToItem(itemId, serverId, apiClient) {
    let sid = serverId;
    if (!sid && apiClient) { sid = apiClient.serverId || apiClient.serverInfo?.Id || apiClient._serverInfo?.Id; }
    if (!sid) { try { sid = new URLSearchParams(window.location.search).get("serverId"); } catch(e){} }
    if (!sid && window.localStorage) { try { sid = window.localStorage.getItem("serverId"); } catch(e){} }
    if (window.appRouter?.showItem) { window.appRouter.showItem(itemId, sid); return; }
    if (window.Dashboard?.navigate) { window.Dashboard.navigate(sid?`#!/item?id=${itemId}&serverId=${sid}`:`#!/item?id=${itemId}`); return; }
    if (typeof window.page === "function") { window.page(sid?`#!/item?id=${itemId}&serverId=${sid}`:`#!/item?id=${itemId}`); return; }
    if (typeof require === "function") { try { require(['appRouter'], function(r) { if(r?.showItem) r.showItem(itemId, sid); else if(r?.show) r.show(sid?`#!/item?id=${itemId}&serverId=${sid}`:`#!/item?id=${itemId}`); }); return; } catch(e){} }
    window.location.hash = sid ? `#!/item?id=${itemId}&serverId=${sid}` : `#!/item?id=${itemId}`;
    setTimeout(() => { if (window.location.hash.includes(itemId)) window.location.reload(); }, 100);
}

function attachSliderBehavior(state, apiClient) {
    const { slider, btnLeft, btnRight, controls, spotlight, favoriteButtonOverlay } = state;
    let itemsCount = state.itemsCount;
    let currentIndex = 1;
    let cyclesCompleted = 0;
    let isSwapping = false;
    let touchStartX=0, touchStartY=0, touchEndX=0, touchEndY=0, isSwiping=false, swipeStartTime=0;

    function triggerZoomAnimation() {
        const vi = slider.children[currentIndex];
        if (vi) { const c = vi.querySelector('.banner-cover'); if (c) { c.style.animation='none'; void c.offsetWidth; c.style.animation='zoomOut 8s ease-out forwards'; } }
    }
    function updateFavoriteButton() {
        const vi = slider.children[currentIndex];
        if (vi && favoriteButtonOverlay) { const fb = favoriteButtonOverlay.querySelector('.favorite-button'); const f = vi.dataset.isFavorite === "true"; if(f) fb.classList.add('is-favorite'); else fb.classList.remove('is-favorite'); }
    }
    function updateTransform(index, animate) {
        const w = spotlight.querySelector('.banner-slider-wrapper').getBoundingClientRect().width;
        slider.style.transition = animate ? "transform .5s ease" : "none";
        slider.style.transform = `translate3d(${Math.round(-(index*w))}px,0,0)`;
        void slider.offsetHeight;
    }
    function setActiveDot(idx) {
        controls.querySelectorAll(".control").forEach(d => d.classList.remove("active"));
        const ri = ((idx-1+itemsCount)%itemsCount); const dot = controls.querySelectorAll(".control")[ri]; if(dot) dot.classList.add("active");
    }
    function resetOverviews() {
        slider.querySelectorAll('.banner-item').forEach(item => {
            const o=item.querySelector('.banner-overview'), l=item.querySelector('.banner-logo'), t=item.querySelector('.banner-title'), tg=item.querySelector('.banner-tagline');
            if(o)o.classList.remove('visible'); if(l)l.classList.remove('hidden'); if(t)t.classList.remove('hidden'); if(tg)tg.classList.remove('hidden');
        });
    }
    function swapGroup(newItems) {
        if (!newItems || newItems.length === 0) { console.log("[Spotlight] No new items to swap"); return; }
        isSwapping = true;
        while (slider.firstChild) slider.removeChild(slider.firstChild);
        const frag = document.createDocumentFragment();
        newItems.forEach(it => frag.appendChild(createBannerElement(it, apiClient)));
        slider.appendChild(frag);
        if (newItems.length > 1) { const f=slider.children[0].cloneNode(true); const l=slider.children[slider.children.length-1].cloneNode(true); slider.appendChild(f); slider.insertBefore(l, slider.children[0]); }
        while (controls.firstChild) controls.removeChild(controls.firstChild);
        newItems.forEach((_, i) => { const c=document.createElement("button"); c.className="control"; if(i===0)c.classList.add("active"); c.dataset.index=i+1; c.setAttribute("aria-label",`Slide ${i+1}`); controls.appendChild(c); });
        itemsCount = newItems.length; state.itemsCount = itemsCount; currentIndex = 1;
        updateTransform(currentIndex, false); setActiveDot(currentIndex); updateFavoriteButton(); triggerZoomAnimation();
        isSwapping = false;
        console.log(`[Spotlight] Swapped to new group of ${newItems.length} items (cycle ${cyclesCompleted})`);
    }
    state.swapGroup = swapGroup;
    const resizeHandler = () => { updateTransform(currentIndex, false); void slider.offsetHeight; };
    window.addEventListener("resize", resizeHandler);
    setTimeout(() => { updateTransform(currentIndex, false); setActiveDot(currentIndex); triggerZoomAnimation(); updateFavoriteButton(); }, 50);

    btnRight.addEventListener("click", (e) => { e.stopPropagation(); currentIndex++; animate(); });
    btnLeft.addEventListener("click", (e) => { e.stopPropagation(); currentIndex--; animate(); });
    controls.addEventListener("click", (e) => { e.stopPropagation(); if (e.target.classList.contains("control")) { resetOverviews(); currentIndex = parseInt(e.target.dataset.index,10); updateTransform(currentIndex,true); setActiveDot(currentIndex); updateFavoriteButton(); setTimeout(()=>triggerZoomAnimation(),100); } });

    function animate() {
        resetOverviews(); updateTransform(currentIndex,true); setActiveDot(currentIndex); updateFavoriteButton(); setTimeout(()=>triggerZoomAnimation(),100);
        setTimeout(() => {
            if (currentIndex === 0) { currentIndex = itemsCount; updateTransform(currentIndex,false); setActiveDot(currentIndex); updateFavoriteButton(); setTimeout(()=>triggerZoomAnimation(),100); }
            else if (currentIndex === itemsCount+1) {
                currentIndex = 1; updateTransform(currentIndex,false); setActiveDot(currentIndex); updateFavoriteButton(); setTimeout(()=>triggerZoomAnimation(),100);
                if (CONFIG.autoAdvanceOnCycle && !isSwapping) { cyclesCompleted++; console.log(`[Spotlight] Cycle ${cyclesCompleted} complete — loading next group`); if (typeof state.onCycleComplete === 'function') state.onCycleComplete(); }
            }
        }, 520);
    }

    if (CONFIG.enableSwipe) {
        slider.addEventListener('touchstart', (e) => {
            if (e.target.closest('.play-button-overlay')||e.target.closest('.favorite-button-overlay')||e.target.closest('.arrow')||e.target.closest('.controls')||e.target.closest('.banner-overview.visible')) return;
            touchStartX=e.touches[0].clientX; touchStartY=e.touches[0].clientY; swipeStartTime=Date.now(); isSwiping=false;
        }, { passive: true });
        slider.addEventListener('touchmove', (e) => {
            if (touchStartX === 0) return;
            const cx=e.touches[0].clientX, cy=e.touches[0].clientY, dx=Math.abs(cx-touchStartX), dy=Math.abs(cy-touchStartY);
            if (dx > dy && dx > 10) { isSwiping = true; e.preventDefault(); }
        }, { passive: false });
        slider.addEventListener('touchend', (e) => {
            if (!isSwiping || touchStartX === 0) { touchStartX=0; touchStartY=0; isSwiping=false; return; }
            touchEndX=e.changedTouches[0].clientX; touchEndY=e.changedTouches[0].clientY;
            const sd = touchEndX-touchStartX, st = Date.now()-swipeStartTime, ss = Math.abs(sd)/st;
            if (Math.abs(sd) > CONFIG.swipeThreshold || ss > 0.5) { if (sd < 0) { currentIndex++; } else { currentIndex--; } animate(); }
            touchStartX=0; touchStartY=0; touchEndX=0; touchEndY=0; isSwiping=false;
        }, { passive: true });
        slider.addEventListener('touchcancel', () => { touchStartX=0; touchStartY=0; isSwiping=false; }, { passive: true });
    }

    slider.addEventListener("click", (e) => {
        if (isSwiping) return;
        if (e.target.closest('.arrow')||e.target.closest('.controls')||e.target.closest('.play-button-overlay')||e.target.closest('.favorite-button-overlay')) return;
        const oe = e.target.closest('.banner-overview'), le = e.target.closest('.banner-logo'), te = e.target.closest('.banner-title');
        if (oe) { const bi = oe.closest('.banner-item'); const o=bi.querySelector('.banner-overview'),l=bi.querySelector('.banner-logo'),t=bi.querySelector('.banner-title'),tg=bi.querySelector('.banner-tagline'); if(o)o.classList.remove('visible'); if(l)l.classList.remove('hidden'); if(t)t.classList.remove('hidden'); if(tg)tg.classList.remove('hidden'); return; }
        if (le || te) { const bi = (le||te).closest('.banner-item'); const o=bi.querySelector('.banner-overview'),l=bi.querySelector('.banner-logo'),t=bi.querySelector('.banner-title'),tg=bi.querySelector('.banner-tagline'); if(o){o.classList.add('visible'); if(l)l.classList.add('hidden'); if(t)t.classList.add('hidden'); if(tg)tg.classList.add('hidden');} return; }
        let node = e.target; while (node && node !== slider && !(node.dataset && node.dataset.itemId)) node = node.parentElement;
        if (node && node.dataset && node.dataset.itemId) navigateToItem(node.dataset.itemId, node.dataset.serverId, apiClient);
    });

    const playButtonOverlay = spotlight.querySelector('.play-button-overlay');
    if (playButtonOverlay) playButtonOverlay.addEventListener("click", (e) => { e.stopPropagation(); const vi = slider.children[currentIndex]; if (vi?.dataset?.itemId) playItem(vi.dataset.itemId, vi.dataset.serverId, apiClient); });
    if (favoriteButtonOverlay) favoriteButtonOverlay.addEventListener("click", async (e) => {
        e.stopPropagation(); const vi = slider.children[currentIndex];
        if (vi?.dataset?.itemId) { const itemId = vi.dataset.itemId; const isFav = vi.dataset.isFavorite === "true"; const newState = await toggleFavorite(itemId, apiClient, isFav); vi.dataset.isFavorite = newState ? "true" : "false";
            slider.querySelectorAll(`.banner-item[data-item-id="${itemId}"]`).forEach(c => c.dataset.isFavorite = newState ? "true" : "false"); updateFavoriteButton(); }
    });

    let autoplayTimer = null;
    function startAutoplay() { if (autoplayTimer) clearInterval(autoplayTimer); autoplayTimer = setInterval(() => { currentIndex++; animate(); }, CONFIG.autoplayInterval); }
    function stopAutoplay() { if (autoplayTimer) clearInterval(autoplayTimer); autoplayTimer = null; }
    spotlight.addEventListener("mouseenter", stopAutoplay); spotlight.addEventListener("mouseleave", startAutoplay); startAutoplay();
    state.cleanup = () => { window.removeEventListener("resize", resizeHandler); stopAutoplay(); };
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
        try { if (connectionManager?.[0]?.currentApiClient) apiClient = connectionManager[0].currentApiClient(); } catch(e){}
        if (!apiClient) { try { if (ApiClient?.[0]?.serverAddress) apiClient = ApiClient[0]; } catch(e){} }
        if (!apiClient && window.ApiClient) apiClient = window.ApiClient;
        if (!apiClient) { SPOTLIGHT_INITIALIZED = false; return; }
        const items = await fetchItems(apiClient);
        if (!items || items.length === 0) { SPOTLIGHT_INITIALIZED = false; return; }
        console.log("[Spotlight] Items loaded:", items.length);
        if (CONFIG.enablePreloading) {
            await Promise.all(items.map(item => new Promise(resolve => {
                const img = new Image(); const to = setTimeout(resolve, 2000);
                img.onload = () => { clearTimeout(to); resolve(); }; img.onerror = () => { clearTimeout(to); resolve(); };
                img.src = getImageUrl(apiClient, item, { width: CONFIG.preloadWidth, prefer: "Backdrop" });
            })));
        }
        const { container, spotlight, slider, btnLeft, btnRight, controls, favoriteButtonOverlay } = buildSlider(items, apiClient);
        const reference = home.querySelector ? home.querySelector(".homeSectionsContainer") : null;
        if (reference?.parentNode) reference.parentNode.insertBefore(container, reference);
        else home.insertBefore(container, home.firstChild);
        const loader = container.querySelector(".loader"); if (loader) loader.style.display = "none";
        const sliderState = { slider, itemsCount: items.length, btnLeft, btnRight, controls, spotlight, favoriteButtonOverlay };
        sliderState.onCycleComplete = async function() {
            const nextGroup = getNextGroupFromPool();
            if (nextGroup && nextGroup.length > 0) {
                if (CONFIG.enablePreloading) {
                    await Promise.all(nextGroup.map(item => new Promise(resolve => {
                        const img = new Image(); const to = setTimeout(resolve, 2000);
                        img.onload = () => { clearTimeout(to); resolve(); }; img.onerror = () => { clearTimeout(to); resolve(); };
                        img.src = getImageUrl(apiClient, item, { width: CONFIG.preloadWidth, prefer: "Backdrop" });
                    })));
                }
                if (typeof sliderState.swapGroup === 'function') sliderState.swapGroup(nextGroup);
            } else { console.log("[Spotlight] No next group available yet — will retry on next cycle"); }
        };
        attachSliderBehavior(sliderState, apiClient);
        SPOTLIGHT_INSTANCE = { container, cleanup: null };
        console.log(`[Spotlight] Slider initialized in ${Math.round(performance.now()-initStart)}ms with ${items.length} items`);
    } catch (err) { console.error("[Spotlight] init error", err); SPOTLIGHT_INITIALIZED = false; }
}

function cleanup() {
    if (SPOTLIGHT_INSTANCE?.cleanup) SPOTLIGHT_INSTANCE.cleanup();
    if (SPOTLIGHT_INSTANCE?.container) SPOTLIGHT_INSTANCE.container.remove();
    SPOTLIGHT_INSTANCE = null; SPOTLIGHT_INITIALIZED = false;
    STATE.itemPool = []; STATE.poolCursor = 0; STATE.totalRecordCount = null; STATE.usedStartIndices.clear(); STATE.isFetchingBatch = false;
}

function observeViewAndInit() {
    let homeWasVisible = false; let initTimeout = null;
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
