// ==UserScript==
// @name         IG Logged-Out Profile Viewer
// @namespace    https://github.com/atharvj/ig-to-imginn-viewer
// @version      0.5.10
// @description  Opens public Instagram links in Imginn only when logged out, and shows Imginn posts in a popup without losing your place.
// @author       Intellectual07
// @license      MIT
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @match        https://m.instagram.com/*
// @match        https://imginn.com/*
// @match        https://www.imginn.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const VIEWER_ORIGIN = "https://imginn.com";
  const SCRIPT_NAME = "IG Logged-Out Profile Viewer";
  const MODAL_ID = "igiv-post-modal";
  const STYLE_ID = "igiv-style";
  const FRAME_STYLE_ID = "igiv-frame-style";
  const MODAL_OPEN_CLASS = "igiv-modal-open";
  const HIDDEN_CLASS = "igiv-hidden";
  const INSTAGRAM_STAY_PARAM = "igiv_stay";
  const INSTAGRAM_STAY_VALUE = "1";
  const VIEWER_PROFILE_LOAD_TIMEOUT_MS = 5000;
  const VIEWER_AD_SELECTOR = [
    "ins.adsbygoogle",
    'iframe[id^="aswift_"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="doubleclick"]',
    '[id*="google_ads"]',
    '[class*="adsbygoogle"]',
  ].join(", ");
  const POST_AD_SELECTOR = `${VIEWER_AD_SELECTOR}, .block-sulvo, .block-money, .demand-supply__display, .demand-supply[data-ad]`;
  const LOGIN_PATH_RE = /^\/accounts\/login\/?$/;
  const INSTAGRAM_POST_PATH_RE = /^\/p\/([^/?#]+)\/?$/;
  const INSTAGRAM_REEL_PATH_RE = /^\/reel\/([^/?#]+)\/?$/;
  const INSTAGRAM_TV_PATH_RE = /^\/tv\/([^/?#]+)\/?$/;
  const PROFILE_PATH_RE = /^\/([A-Za-z0-9._]{1,30})(?:\/(reels|tagged|channel|guides))?\/?$/;
  const VIEWER_PROFILE_TAB_PATH_RE = /^\/(?:stories|reels|tagged)\/([A-Za-z0-9._]{1,30})\/?$/;
  const VIEWER_POST_PATH_RE = /^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|tv)\/([^/?#]+)\/?$/;

  const RESERVED_PROFILE_SEGMENTS = new Set([
    "about",
    "accounts",
    "api",
    "challenge",
    "developer",
    "direct",
    "explore",
    "graphql",
    "legal",
    "oauth",
    "p",
    "privacy",
    "reel",
    "stories",
    "terms",
    "tv",
  ]);

  let activeFrame = null;
  let activeOpenLink = null;
  let activeTitle = null;
  let activePostCandidates = [];
  let activePostCandidateIndex = -1;
  let activePreview = null;
  let viewerChallengeDetected = false;

  function parseUrl(value, base) {
    try {
      return new URL(value, base || window.location.href);
    } catch (_) {
      return null;
    }
  }

  function isInstagramHost(hostname) {
    return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
  }

  function isViewerHost(hostname) {
    return hostname === "imginn.com" || hostname.endsWith(".imginn.com");
  }

  function isModifiedClick(event) {
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  function cleanPathPart(value) {
    return encodeURIComponent(decodeURIComponent(value));
  }

  function closestAnchor(target) {
    return target && typeof target.closest === "function" ? target.closest("a[href]") : null;
  }

  function isProfilePath(pathname) {
    const match = pathname.match(PROFILE_PATH_RE);
    return Boolean(match && !RESERVED_PROFILE_SEGMENTS.has(match[1].toLowerCase()));
  }

  function viewerProfileUsernameFromPath(pathname) {
    const tabMatch = pathname.match(VIEWER_PROFILE_TAB_PATH_RE);
    if (tabMatch) return tabMatch[1];

    const match = pathname.match(PROFILE_PATH_RE);
    if (!match || RESERVED_PROFILE_SEGMENTS.has(match[1].toLowerCase())) return "";

    return match[1];
  }

  function currentViewerProfileUsername() {
    const currentUrl = parseUrl(window.location.href);
    if (!currentUrl || !isViewerHost(currentUrl.hostname)) return "";

    return viewerProfileUsernameFromPath(currentUrl.pathname);
  }

  function viewerPostInfo(url) {
    if (!url || !isViewerHost(url.hostname)) return null;

    const match = url.pathname.match(VIEWER_POST_PATH_RE);
    if (!match) return null;

    const owner = match[1] || "";
    if (owner && RESERVED_PROFILE_SEGMENTS.has(owner.toLowerCase())) return null;

    return {
      owner,
      kind: match[2],
      code: match[3],
    };
  }

  function isViewerPostUrl(url) {
    return Boolean(viewerPostInfo(url));
  }

  function isViewerProfileUrl(url) {
    return Boolean(url && isViewerHost(url.hostname) && viewerProfileUsernameFromPath(url.pathname));
  }

  function sameViewerOriginUrl(url) {
    const nextUrl = new URL(url.href);
    nextUrl.protocol = window.location.protocol;
    nextUrl.hostname = window.location.hostname;
    nextUrl.port = window.location.port;
    return nextUrl.href;
  }

  function viewerPostUrl(owner, kind, code) {
    const ownerPath = owner ? `/${cleanPathPart(owner)}` : "";
    return `${window.location.origin}${ownerPath}/${kind}/${cleanPathPart(code)}/`;
  }

  function addUniqueUrl(urls, value) {
    if (!urls.includes(value)) {
      urls.push(value);
    }
  }

  function candidateUrlsForPost(url) {
    const info = viewerPostInfo(url);
    if (!info) return [];

    const urls = [];
    addUniqueUrl(urls, sameViewerOriginUrl(url));
    addUniqueUrl(urls, viewerPostUrl("", info.kind, info.code));
    return urls;
  }

  function instagramUrlFromLoginRedirect(url) {
    if (!LOGIN_PATH_RE.test(url.pathname)) return null;

    const next = url.searchParams.get("next");
    if (!next) return null;

    const target = parseUrl(next, url.origin);
    if (!target || !isInstagramHost(target.hostname)) return null;

    return target;
  }

  function hasReadableInstagramAuthCookie() {
    return /(?:^|;\s*)(?:ds_user_id|sessionid)=/.test(document.cookie || "");
  }

  function isInstagramStayUrl(url) {
    if (!url) return false;
    if (url.searchParams.get(INSTAGRAM_STAY_PARAM) === INSTAGRAM_STAY_VALUE) return true;

    const loginTarget = instagramUrlFromLoginRedirect(url);
    return Boolean(loginTarget && loginTarget.searchParams.get(INSTAGRAM_STAY_PARAM) === INSTAGRAM_STAY_VALUE);
  }

  function removeInstagramStayMarker(url) {
    const cleanUrl = new URL(url.href);
    cleanUrl.searchParams.delete(INSTAGRAM_STAY_PARAM);

    try {
      window.history.replaceState(window.history.state, "", cleanUrl.href);
    } catch (_) {
      // The marker is harmless if Instagram blocks history changes.
    }
  }

  function imginnUrlForInstagramUrl(url) {
    const loginTarget = instagramUrlFromLoginRedirect(url);
    if (loginTarget) return imginnUrlForInstagramUrl(loginTarget);

    const postMatch = url.pathname.match(INSTAGRAM_POST_PATH_RE) || url.pathname.match(INSTAGRAM_TV_PATH_RE);
    if (postMatch) {
      return `${VIEWER_ORIGIN}/p/${cleanPathPart(postMatch[1])}/`;
    }

    const reelMatch = url.pathname.match(INSTAGRAM_REEL_PATH_RE);
    if (reelMatch) {
      return `${VIEWER_ORIGIN}/reel/${cleanPathPart(reelMatch[1])}/`;
    }

    const profileMatch = url.pathname.match(PROFILE_PATH_RE);
    if (!profileMatch) return null;

    const username = profileMatch[1];
    if (RESERVED_PROFILE_SEGMENTS.has(username.toLowerCase())) return null;

    const tab = profileMatch[2];
    if (tab === "reels" || tab === "tagged") {
      return `${VIEWER_ORIGIN}/${tab}/${cleanPathPart(username)}/`;
    }

    return `${VIEWER_ORIGIN}/${cleanPathPart(username)}/`;
  }

  function redirectInstagramToViewer() {
    const currentUrl = parseUrl(window.location.href);
    if (!currentUrl || !isInstagramHost(currentUrl.hostname)) return;

    const viewerUrl = imginnUrlForInstagramUrl(currentUrl);
    if (!viewerUrl) return;

    window.stop();
    window.location.replace(viewerUrl);
    console.info(`${SCRIPT_NAME}: redirected to ${viewerUrl}`);
  }

  function installInstagramLoggedOutRedirect() {
    const currentUrl = parseUrl(window.location.href);
    if (!currentUrl || !isInstagramHost(currentUrl.hostname)) return;
    if (isInstagramStayUrl(currentUrl)) {
      removeInstagramStayMarker(currentUrl);
      return;
    }
    if (!imginnUrlForInstagramUrl(currentUrl)) return;
    if (hasReadableInstagramAuthCookie()) return;

    redirectInstagramToViewer();
  }

  function onReady(callback) {
    if (document.readyState !== "loading" && document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function isViewerNotFoundPage() {
    const title = (document.title || "").toLowerCase();
    const text = document.body ? (document.body.innerText || "").replace(/\s+/g, " ").toLowerCase() : "";

    return Boolean(
      document.querySelector(".page-error.notfound, .page-error--not-found") ||
        title.includes("page not found") ||
        title.includes("content not found") ||
        (text.includes("content not found") && text.includes("content has been deleted"))
    );
  }

  function isViewerServerErrorPage() {
    const title = (document.title || "").replace(/\s+/g, " ").toLowerCase();
    const text = document.body ? (document.body.innerText || "").replace(/\s+/g, " ").toLowerCase() : "";

    return title.includes("server error") || /server error,? please try again later\.?/.test(text);
  }

  function hasViewerProfileContent() {
    const page = document.querySelector(".page-user");
    return Boolean(page && page.querySelector(".userinfo") && page.querySelector(".tabs"));
  }

  function isViewerPrivateProfile() {
    const page = document.querySelector(".page-user, .page-error");
    if (!page) return false;
    if (page.matches('[data-is-private="true"]')) return true;

    return [page, ...page.querySelectorAll("p, div, span, h1, h2, h3")].some((element) => {
      if (element.closest(".userinfo, .item, article, .tabs")) return false;
      const text = normalizedText(element);
      return text.length < 180 && /^(?:(?:this|the) (?:account|profile) is private|you (?:visit|are visiting) a private (?:account|profile)|private (?:account|profile))(?:[.!:\s]|$)/i.test(text);
    });
  }

  function instagramProfileFallbackUrl(username) {
    const url = new URL(`/${cleanPathPart(username)}/`, "https://www.instagram.com");
    url.searchParams.set(INSTAGRAM_STAY_PARAM, INSTAGRAM_STAY_VALUE);
    return url.href;
  }

  function installViewerProfileRecovery() {
    const currentUrl = parseUrl(window.location.href);
    if (!isViewerProfileUrl(currentUrl)) return;

    const username = viewerProfileUsernameFromPath(currentUrl.pathname);
    if (!username) return;

    let handled = false;
    let observer = null;
    let fallbackTimer = 0;
    let deadline = performance.now() + VIEWER_PROFILE_LOAD_TIMEOUT_MS;
    let profileLoaded = false;

    const stopWatching = () => {
      if (observer) observer.disconnect();
      observer = null;
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
    };

    const openInstagramFallback = () => {
      if (handled) return;

      handled = true;
      stopWatching();
      const fallbackUrl = instagramProfileFallbackUrl(username);
      window.stop();
      window.location.replace(fallbackUrl);
      console.info(`${SCRIPT_NAME}: Imginn could not show @${username}; opening the Instagram profile instead.`);
    };

    const check = () => {
      if (handled) return;

      if (isViewerPrivateProfile()) {
        openInstagramFallback();
        return;
      }
      if (profileLoaded) return;

      const verificationWidget = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]'))
        .some((frame) => frame.getBoundingClientRect().height > 0);
      if (isCloudflareChallengeFrame(document) || verificationWidget) {
        // Verification needs user input; allow a fresh loading window after it ends.
        deadline = performance.now() + VIEWER_PROFILE_LOAD_TIMEOUT_MS;
        return;
      }

      if (isViewerServerErrorPage()) {
        openInstagramFallback();
        return;
      }

      if (isProfilePath(currentUrl.pathname) && isViewerNotFoundPage()) {
        openInstagramFallback();
        return;
      }

      if (hasViewerProfileContent()) {
        // Private-account notices can arrive after the profile header.
        profileLoaded = true;
        window.clearTimeout(fallbackTimer);
        fallbackTimer = 0;
        return;
      }

      if (performance.now() >= deadline) openInstagramFallback();
    };

    const start = () => {
      check();
      if (handled || !document.body) return;

      observer = new MutationObserver(check);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };

    const tick = () => {
      check();
      if (!handled && !profileLoaded) fallbackTimer = window.setTimeout(tick, 250);
    };

    tick();
    onReady(start);
    window.addEventListener("load", check, { once: true });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const styleParent = document.head || document.documentElement;
    if (!styleParent) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[data-igiv-viewer-page="true"] ins.adsbygoogle,
      html[data-igiv-viewer-page="true"] iframe[id^="aswift_"],
      html[data-igiv-viewer-page="true"] iframe[src*="googlesyndication"],
      html[data-igiv-viewer-page="true"] iframe[src*="doubleclick"],
      html[data-igiv-viewer-page="true"] [id*="google_ads"],
      html[data-igiv-viewer-page="true"] [class*="adsbygoogle"] {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        padding: 0 !important;
      }

      html[data-igiv-viewer-page="true"] .page-user > .block-sulvo,
      html[data-igiv-viewer-page="true"] .page-user > .block-money,
      html[data-igiv-viewer-page="true"] .page-user .demand-supply__display,
      html[data-igiv-viewer-page="true"] .page-user > .share-to,
      html[data-igiv-viewer-page="true"] .page-user > .download-wrap {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
        padding: 0 !important;
      }

      html[data-igiv-viewer-page="true"] .page-user > .items {
        margin-top: 0 !important;
        position: static !important;
        transform: none !important;
      }

      html[data-igiv-viewer-page="true"] .page-user > .tabs {
        margin-bottom: 0 !important;
      }

      [data-igiv-story-control="true"] {
        cursor: pointer !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-gap-block="true"] {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
        padding: 0 !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-post-grid="true"],
      html[data-igiv-viewer-page="true"] [data-igiv-grid-branch="true"] {
        margin-top: 0 !important;
        min-height: 0 !important;
        padding-top: 0 !important;
        top: auto !important;
        transform: none !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-post-grid="true"] {
        position: static !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-grid-branch="true"]::before {
        content: none !important;
        display: none !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-hidden-spacer="true"] {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        padding: 0 !important;
      }

      html[data-igiv-viewer-page="true"] [data-igiv-hidden-spacer="true"][data-igiv-protected-tabs="true"] {
        display: revert !important;
        height: auto !important;
        margin-left: revert !important;
        margin-right: revert !important;
        min-height: revert !important;
        opacity: 1 !important;
        overflow: visible !important;
        padding: revert !important;
        visibility: visible !important;
      }

      .${HIDDEN_CLASS} {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
        padding: 0 !important;
      }

      body.${MODAL_OPEN_CLASS} {
        overflow: hidden !important;
      }

      #${MODAL_ID} {
        align-items: center !important;
        background: rgba(0, 0, 0, 0.66) !important;
        box-sizing: border-box !important;
        display: none !important;
        inset: 0 !important;
        justify-content: center !important;
        padding: 18px !important;
        position: fixed !important;
        z-index: 2147483647 !important;
      }

      #${MODAL_ID}[data-visible="true"] {
        display: flex !important;
      }

      #${MODAL_ID} [data-igiv-panel] {
        background: #fff !important;
        border-radius: 8px !important;
        box-shadow: 0 18px 55px rgba(0, 0, 0, 0.42) !important;
        display: flex !important;
        flex-direction: column !important;
        height: min(860px, calc(100vh - 36px)) !important;
        max-width: 1120px !important;
        min-height: 420px !important;
        overflow: hidden !important;
        width: min(1120px, calc(100vw - 36px)) !important;
      }

      #${MODAL_ID} [data-igiv-bar] {
        align-items: center !important;
        border-bottom: 1px solid #dbdbdb !important;
        box-sizing: border-box !important;
        display: none !important;
        flex: 0 0 auto !important;
        gap: 10px !important;
        height: 0 !important;
        min-height: 48px !important;
        overflow: hidden !important;
        padding: 8px 10px !important;
      }

      #${MODAL_ID} [data-igiv-title] {
        color: #111 !important;
        flex: 1 1 auto !important;
        font: 700 14px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      #${MODAL_ID} a,
      #${MODAL_ID} button {
        align-items: center !important;
        appearance: none !important;
        background: #fff !important;
        border: 1px solid #cfcfcf !important;
        border-radius: 6px !important;
        box-sizing: border-box !important;
        color: #111 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        flex: 0 0 auto !important;
        font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        height: 32px !important;
        justify-content: center !important;
        letter-spacing: 0 !important;
        padding: 0 10px !important;
        text-decoration: none !important;
      }

      #${MODAL_ID} [data-igiv-open] {
        background: #0095f6 !important;
        border-color: #0095f6 !important;
        color: #fff !important;
      }

      #${MODAL_ID} [data-igiv-frame-wrap] {
        background: #fff !important;
        display: flex !important;
        flex: 1 1 auto !important;
        min-height: 0 !important;
        position: relative !important;
      }

      #${MODAL_ID} iframe {
        background: #fff !important;
        border: 0 !important;
        flex: 1 1 auto !important;
        height: 100% !important;
        width: 100% !important;
      }

      #${MODAL_ID} [data-igiv-loading] {
        align-items: center !important;
        background: #fff !important;
        color: #555 !important;
        display: none !important;
        font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        inset: 0 !important;
        justify-content: center !important;
        letter-spacing: 0 !important;
        position: absolute !important;
      }

      #${MODAL_ID}[data-loading="true"] [data-igiv-loading] {
        display: flex !important;
      }

      @media (max-width: 760px) {
        #${MODAL_ID} {
          padding: 0 !important;
        }

        #${MODAL_ID} [data-igiv-panel] {
          border-radius: 0 !important;
          height: 100vh !important;
          max-width: none !important;
          min-height: 100vh !important;
          width: 100vw !important;
        }

        #${MODAL_ID} [data-igiv-bar] {
          gap: 6px !important;
        }

        #${MODAL_ID} a,
        #${MODAL_ID} button {
          font-size: 12px !important;
          padding: 0 8px !important;
        }
      }
    `;

    styleParent.appendChild(style);
  }

  function createModal() {
    ensureStyles();

    const existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Imginn post popup");

    const panel = document.createElement("section");
    panel.setAttribute("data-igiv-panel", "true");

    const bar = document.createElement("div");
    bar.setAttribute("data-igiv-bar", "true");

    activeTitle = document.createElement("strong");
    activeTitle.setAttribute("data-igiv-title", "true");
    activeTitle.textContent = "Post";

    activeOpenLink = document.createElement("a");
    activeOpenLink.setAttribute("data-igiv-open", "true");
    activeOpenLink.target = "_blank";
    activeOpenLink.rel = "noopener noreferrer";
    activeOpenLink.textContent = "Open Page";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", closeModal);

    bar.append(activeTitle, activeOpenLink, closeButton);

    const frameWrap = document.createElement("div");
    frameWrap.setAttribute("data-igiv-frame-wrap", "true");

    activeFrame = document.createElement("iframe");
    activeFrame.title = "Imginn post";
    activeFrame.loading = "eager";
    activeFrame.addEventListener("load", handleFrameLoad);

    const loading = document.createElement("div");
    loading.setAttribute("data-igiv-loading", "true");
    loading.textContent = "Loading post...";

    frameWrap.append(activeFrame, loading);
    panel.append(bar, frameWrap);
    modal.appendChild(panel);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function openPostModal(url, sourceElement) {
    onReady(() => {
      const modal = createModal();

      modal.dataset.visible = "true";
      document.body.classList.add(MODAL_OPEN_CLASS);

      activeTitle.textContent = postTitleFromUrl(url);
      activePostCandidates = candidateUrlsForPost(url);
      activePostCandidateIndex = 0;
      activePreview = postPreviewFromElement(sourceElement);

      if (viewerChallengeDetected) {
        activeOpenLink.href = activePostCandidates[0] || sameViewerOriginUrl(url);
        showPreviewFallback("challenge");
        return;
      }

      loadActivePostCandidate();
    });
  }

  function loadActivePostCandidate() {
    const modal = document.getElementById(MODAL_ID);
    const postUrl = activePostCandidates[activePostCandidateIndex];
    if (!modal || !postUrl) return;

    modal.dataset.loading = "true";
    activeOpenLink.href = postUrl;

    delete activeFrame.dataset.igivFallback;
    activeFrame.removeAttribute("srcdoc");
    activeFrame.src = postUrl;
  }

  function tryNextPostCandidate() {
    if (activePostCandidateIndex + 1 >= activePostCandidates.length) {
      showPreviewFallback();
      return false;
    }

    activePostCandidateIndex += 1;
    loadActivePostCandidate();
    return true;
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    modal.dataset.visible = "false";
    modal.dataset.loading = "false";
    document.body.classList.remove(MODAL_OPEN_CLASS);

    try {
      activeFrame.contentDocument.querySelectorAll("audio, video").forEach((media) => {
        media.pause();
      });
    } catch (_) {
      // The iframe can still be closed even if the browser blocks media access.
    }

    if (activeFrame) {
      activeFrame.removeAttribute("src");
      activeFrame.removeAttribute("srcdoc");
    }

    activePostCandidates = [];
    activePostCandidateIndex = -1;
    activePreview = null;
  }

  function postTitleFromUrl(url) {
    const info = viewerPostInfo(url);
    if (!info) return "Post";

    const kind = info.kind === "reel" ? "Reel" : "Post";
    const code = info.code || "";
    return code ? `${kind} ${code}` : kind;
  }

  function postPreviewFromElement(sourceElement) {
    if (!sourceElement) return null;

    const container =
      sourceElement.closest("article, li, [class*='post'], [class*='item'], [class*='photo'], [class*='media']") ||
      sourceElement;
    const image = sourceElement.querySelector("img") || container.querySelector("img");
    const video = sourceElement.querySelector("video") || container.querySelector("video");
    const textCandidates = [
      image && image.alt,
      sourceElement.getAttribute("aria-label"),
      sourceElement.getAttribute("title"),
      container.textContent,
    ]
      .filter(Boolean)
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    return {
      imageSrc: image ? image.currentSrc || image.src : "",
      imageAlt: image ? image.alt || "" : "",
      videoSrc: video ? video.currentSrc || video.src : "",
      text: textCandidates[0] || "",
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function isContentNotFoundFrame(frameDocument) {
    const title = (frameDocument.title || "").toLowerCase();
    const text = (frameDocument.body ? frameDocument.body.innerText || "" : "").replace(/\s+/g, " ").toLowerCase();

    return (
      title.includes("content not found") ||
      text.includes("content not found") ||
      text.includes("content has been deleted")
    );
  }

  function isCloudflareChallengeFrame(frameDocument) {
    if (!frameDocument || !frameDocument.documentElement) return false;

    const title = (frameDocument.title || "").toLowerCase();
    const text = (frameDocument.body ? frameDocument.body.innerText || "" : "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    return Boolean(
      frameDocument.querySelector(
        "#cf-wrapper, #challenge-running, [id^='cf-chl-'], script[src*='/cdn-cgi/challenge-platform/']"
      ) ||
        title.includes("just a moment") ||
        text.includes("verifying you are human") ||
        text.includes("performing security verification")
    );
  }

  function showPreviewFallback(reason) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    modal.dataset.loading = "false";
    activeFrame.dataset.igivFallback = "true";

    const preview = activePreview || {};
    const explanation =
      reason === "challenge"
        ? "Imginn requested Cloudflare verification for the post detail page. This preview uses the media already loaded on the profile and prevents more detail-page requests for this profile view."
        : "The profile card loaded, but every known Imginn detail URL returned Content Not Found. Comments and tagged users are only available if Imginn exposes the post page.";
    const mediaHtml = preview.videoSrc
      ? `<video controls playsinline src="${escapeHtml(preview.videoSrc)}"></video>`
      : preview.imageSrc
        ? `<img src="${escapeHtml(preview.imageSrc)}" alt="${escapeHtml(preview.imageAlt || "Post preview")}">`
        : `<div data-empty-preview>No preview image was available from this card.</div>`;
    const triedLinks = activePostCandidates
      .map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></li>`)
      .join("");

    activeFrame.srcdoc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      color: #111;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      min-height: 100vh;
    }
    [data-media] {
      align-items: center;
      background: #050505;
      display: flex;
      justify-content: center;
      min-height: 420px;
    }
    img, video {
      display: block;
      max-height: 100vh;
      max-width: 100%;
      object-fit: contain;
    }
    [data-info] {
      border-left: 1px solid #dbdbdb;
      box-sizing: border-box;
      padding: 18px;
    }
    h1 {
      font-size: 17px;
      line-height: 1.3;
      margin: 0 0 10px;
    }
    p {
      color: #555;
      margin: 0 0 14px;
    }
    [data-caption] {
      color: #111;
      overflow-wrap: anywhere;
    }
    ul {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    a {
      color: #00376b;
      overflow-wrap: anywhere;
    }
    [data-empty-preview] {
      color: #ddd;
      padding: 20px;
      text-align: center;
    }
    @media (max-width: 760px) {
      main {
        display: block;
      }
      [data-info] {
        border-left: 0;
        border-top: 1px solid #dbdbdb;
      }
    }
  </style>
</head>
<body>
  <main>
    <section data-media>${mediaHtml}</section>
    <section data-info>
      <h1>Imginn could not open the post detail page</h1>
      <p>${explanation}</p>
      ${preview.text ? `<p data-caption>${escapeHtml(preview.text)}</p>` : ""}
      <p>URLs tried:</p>
      <ul>${triedLinks}</ul>
    </section>
  </main>
</body>
</html>`;
  }

  function visibleRect(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return null;
    }

    return rect;
  }

  function viewerPostLinksIn(element) {
    return Array.from(element.querySelectorAll("a[href]")).filter((link) => {
      const targetUrl = parseUrl(link.href, window.location.href);
      return isViewerPostUrl(targetUrl) && Boolean(link.querySelector("img, video, picture"));
    });
  }

  function largeMediaElementsIn(element, minimumTop) {
    return Array.from(element.querySelectorAll("img, video")).filter((media) => {
      if (media.closest(`#${MODAL_ID}`)) return false;

      const rect = visibleRect(media);
      return Boolean(rect && rect.top > minimumTop && rect.width >= 120 && rect.height >= 120);
    });
  }

  function mediaCountIn(element, minimumTop) {
    return largeMediaElementsIn(element, minimumTop).length;
  }

  function distinctMediaColumnCount(element, minimumTop) {
    const columns = [];

    for (const media of largeMediaElementsIn(element, minimumTop)) {
      const rect = media.getBoundingClientRect();
      if (!columns.some((left) => Math.abs(left - rect.left) < 40)) {
        columns.push(rect.left);
      }
    }

    return columns.length;
  }

  function isPostGridCandidate(element, minimumTop) {
    const rect = visibleRect(element);
    if (!rect || rect.width < 300) return false;
    if (rect.top < minimumTop - 12) return false;
    if (isProtectedProfileTabsArea(element)) return false;

    const count = mediaCountIn(element, minimumTop);
    if (count < 3) return false;

    return window.innerWidth < 760 || rect.width >= 640 || distinctMediaColumnCount(element, minimumTop) >= 2;
  }

  function findFirstPostMedia(minimumTop) {
    return largeMediaElementsIn(document.body, minimumTop).sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    })[0] || null;
  }

  function findPostGridContainer(minimumTop) {
    const firstMedia = findFirstPostMedia(minimumTop);
    if (firstMedia) {
      const mediaRect = visibleRect(firstMedia);
      let candidate = firstMedia.closest("a[href]") || firstMedia;

      while (candidate && candidate !== document.body && candidate.nodeType === Node.ELEMENT_NODE) {
        if (mediaRect && isPostGridCandidate(candidate, minimumTop)) {
          return candidate;
        }

        candidate = candidate.parentElement;
      }

      if (mediaCountIn(document.body, minimumTop) < 3) return null;
    }

    const firstPostLink = viewerPostLinksIn(document).find((link) => {
      const rect = visibleRect(link);
      return Boolean(rect && rect.top > minimumTop);
    });
    if (!firstPostLink) return null;

    let node = firstPostLink;
    while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE) {
      const postLinkCount = viewerPostLinksIn(node).length;
      const rect = visibleRect(node);

      if (rect && rect.top > minimumTop && postLinkCount >= 3 && !isProtectedProfileTabsArea(node)) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function firstPostMediaTop(grid, minimumTop) {
    const media = largeMediaElementsIn(grid, minimumTop).sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    })[0];
    const rect = media ? visibleRect(media) : visibleRect(grid);

    return rect ? rect.top : 0;
  }

  function hideFloatingDownloadAll(gridTop) {
    for (const element of document.querySelectorAll("a, button, span, div")) {
      if ((element.textContent || "").trim() !== "Download All") continue;

      const rect = visibleRect(element);
      if (!rect || rect.top > gridTop || gridTop - rect.bottom > 700) continue;

      const target = element.closest("a, button") || element;
      target.dataset.igivHiddenSpacer = "true";
    }
  }

  function normalizedText(element) {
    return (element.textContent || "").trim().replace(/\s+/g, " ");
  }

  function isViewerStoriesPath(pathname) {
    return /^\/stories\/[A-Za-z0-9._]{1,30}\/?$/.test(pathname);
  }

  function installStoryFallback() {
    if (!isViewerStoriesPath(window.location.pathname)) return;

    const username = currentViewerProfileUsername();
    if (!username) return;
    let timer = 0;
    let notice = null;
    let originalSources = new Set();

    const visibleStorySources = () => new Set(
      Array.from(document.querySelectorAll("img, video")).filter((media) => {
        if (media.closest(".userinfo, .tabs")) return false;
        const rect = visibleRect(media);
        if (!rect || rect.width < 160 || rect.height < 160) return false;
        return media.tagName === "IMG" ? media.complete && media.naturalWidth > 0 : media.readyState > 0;
      }).map((media) => media.currentSrc || media.src).filter(Boolean)
    );

    const markControls = () => {
      const page = document.querySelector(".page-user");
      if (!page) return;

      for (const label of page.querySelectorAll("a, button, div, span, p")) {
        if (!/^stories$/i.test(normalizedText(label)) || label.closest(".tabs, .userinfo")) continue;

        let control = label;
        while (control && control !== page && !control.querySelector("img")) control = control.parentElement;
        if (!control || control === page || control.querySelector(".tabs") || control.querySelectorAll("img").length !== 1) continue;
        // Highlight circles share the current-Stories control's parent.
        for (const item of control.parentElement.children) {
          if (item.querySelectorAll("img").length !== 1 || item.querySelector(".tabs, .userinfo") ||
              normalizedText(item).length > 80 || item.dataset.igivStoryControl === "true") continue;
          item.dataset.igivStoryControl = "true";
          if (!item.matches("a[href], button")) {
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            item.addEventListener("keydown", (event) => {
              if (event.target === item && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                item.click();
              }
            });
          }
        }
      }
    };

    document.addEventListener("click", (event) => {
      if (event.button !== 0 || isModifiedClick(event)) return;
      const control = event.target.closest && event.target.closest('[data-igiv-story-control="true"]');
      if (!control) return;

      // Give Imginn's own handler a chance to open available story media.
      originalSources = visibleStorySources();
      if (notice) notice.remove();
      notice = null;
      const originalUrl = new URL(window.location.href);
      originalUrl.hash = "";
      let deadline = performance.now() + VIEWER_PROFILE_LOAD_TIMEOUT_MS;
      window.clearTimeout(timer);

      const check = () => {
        const currentUrl = new URL(window.location.href);
        currentUrl.hash = "";
        if (currentUrl.href !== originalUrl.href) return;
        if (Array.from(visibleStorySources()).some((src) => !originalSources.has(src))) return;
        const widget = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]')).some(visibleRect);
        if (isCloudflareChallengeFrame(document) || widget) {
          deadline = performance.now() + VIEWER_PROFILE_LOAD_TIMEOUT_MS;
        } else if (performance.now() >= deadline) {
          notice = document.createElement("p");
          notice.dataset.igivStoryStatus = "true";
          notice.setAttribute("role", "status");
          notice.textContent = "Imginn has not supplied this story or highlight. ";
          const link = document.createElement("a");
          link.href = instagramProfileFallbackUrl(username);
          link.textContent = "Open Instagram profile";
          notice.append(link);
          control.parentElement.after(notice);
          return;
        }
        timer = window.setTimeout(check, 250);
      };
      timer = window.setTimeout(check, 250);
    }, true);

    onReady(() => {
      markControls();
      const observer = new MutationObserver(() => {
        markControls();
        if (notice && Array.from(visibleStorySources()).some((src) => !originalSources.has(src))) {
          notice.remove();
          notice = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("load", () => {
        if (notice && Array.from(visibleStorySources()).some((src) => !originalSources.has(src))) {
          notice.remove();
          notice = null;
        }
      }, true);
      window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    });
    window.addEventListener("pagehide", () => window.clearTimeout(timer));
  }

  function lowestCommonElementAncestor(first, second, boundary) {
    const ancestors = new Set();

    for (let node = first; node && node !== boundary.parentElement; node = node.parentElement) {
      ancestors.add(node);
    }

    for (let node = second; node && node !== boundary.parentElement; node = node.parentElement) {
      if (ancestors.has(node)) return node;
    }

    return null;
  }

  function directChildUnder(ancestor, element) {
    let node = element;

    while (node && node.parentElement !== ancestor) {
      node = node.parentElement;
    }

    return node;
  }

  function findProfilePostGrid(page, tabs) {
    const candidates = Array.from(page.querySelectorAll(".items")).filter((element) =>
      Boolean(tabs.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    );

    return (
      candidates.find((element) => element.querySelector("a[href] img, a[href] video, picture, video")) ||
      candidates[0] ||
      null
    );
  }

  function clearProfileGapMarkers(page) {
    for (const element of page.querySelectorAll(
      "[data-igiv-gap-block='true'], [data-igiv-post-grid='true'], [data-igiv-grid-branch='true']"
    )) {
      delete element.dataset.igivGapBlock;
      delete element.dataset.igivPostGrid;
      delete element.dataset.igivGridBranch;
    }
  }

  function collapseProfilePostGap() {
    const currentUrl = parseUrl(window.location.href);
    const page = document.querySelector(".page-user");
    if (!currentUrl || !page) return false;

    clearProfileGapMarkers(page);
    if (isViewerStoriesPath(currentUrl.pathname)) return false;

    const tabs = Array.from(page.querySelectorAll(".tabs, nav, [role='tablist']")).find((element) =>
      isViewerProfileTabsText(normalizedText(element))
    );
    if (!tabs) return false;

    const grid = findProfilePostGrid(page, tabs);
    if (!grid) return false;

    const commonAncestor = lowestCommonElementAncestor(tabs, grid, page);
    if (!commonAncestor) return false;

    const tabsBranch = directChildUnder(commonAncestor, tabs);
    const gridBranch = directChildUnder(commonAncestor, grid);
    if (!tabsBranch || !gridBranch || tabsBranch === gridBranch) return false;
    if (!(tabsBranch.compareDocumentPosition(gridBranch) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;

    for (let sibling = tabsBranch.nextElementSibling; sibling && sibling !== gridBranch; sibling = sibling.nextElementSibling) {
      sibling.dataset.igivGapBlock = "true";
    }

    grid.dataset.igivPostGrid = "true";
    gridBranch.dataset.igivGridBranch = "true";
    return true;
  }

  function isViewerProfileTabsText(text) {
    return /posts/i.test(text) && /stories/i.test(text) && /reels/i.test(text);
  }

  function isViewerProfileTabsElement(element) {
    return Boolean(element && isViewerProfileTabsText(normalizedText(element)));
  }

  function restoreProfileTabs() {
    for (const element of document.body.querySelectorAll("[data-igiv-protected-tabs='true']")) {
      delete element.dataset.igivProtectedTabs;
    }

    for (const element of document.body.querySelectorAll("div, section, nav, ul")) {
      if (!isViewerProfileTabsElement(element)) continue;

      let node = element;
      let depth = 0;
      while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE && depth < 4) {
        const rect = visibleRect(node);
        if (rect && rect.height > 240) break;

        delete node.dataset.igivHiddenSpacer;
        node.dataset.igivProtectedTabs = "true";
        node = node.parentElement;
        depth += 1;
      }
    }
  }

  function isProtectedProfileTabsArea(element) {
    return Boolean(
      element &&
        (element.dataset.igivProtectedTabs === "true" ||
          element.querySelector("[data-igiv-protected-tabs='true']") ||
          isViewerProfileTabsElement(element))
    );
  }

  function hideCompactTextBlock(element) {
    const initialText = normalizedText(element);
    let target = element;
    let parent = element.parentElement;

    while (parent && parent !== document.body) {
      const parentText = normalizedText(parent);
      const parentRect = visibleRect(parent);
      if (!parentRect || parentText.length > 260 || parentRect.height > 170) break;
      if (/share\s*to\s*:/i.test(initialText) && /posts\s+stories\s+reels/i.test(parentText)) break;

      target = parent;
      parent = parent.parentElement;
    }

    if (isProtectedProfileTabsArea(target)) return;
    target.dataset.igivHiddenSpacer = "true";
  }

  function hideShareAndDownloadRows() {
    for (const element of document.body.querySelectorAll("div, section, p, span, nav, ul, li, a, button")) {
      if (element.id === MODAL_ID || element.closest(`#${MODAL_ID}`)) continue;

      const text = normalizedText(element);
      if (!text) continue;
      if (isViewerProfileTabsText(text)) continue;

      if (/share\s*to\s*:/i.test(text) && /twitter|reddit|line|snap/i.test(text)) {
        hideCompactTextBlock(element);
        continue;
      }

      if (text === "Download All") {
        hideCompactTextBlock(element);
      }
    }
  }

  function hideEmptySpacersBeforeGrid(gridTop) {
    for (const element of document.body.querySelectorAll("div, section, aside")) {
      if (element.id === MODAL_ID || element.closest(`#${MODAL_ID}`)) continue;
      if (isProtectedProfileTabsArea(element)) continue;
      if (element.querySelector("img, video, picture, input, textarea, select")) continue;

      const rect = visibleRect(element);
      if (!rect || rect.bottom > gridTop || rect.height < 96 || rect.width < 240) continue;

      const text = (element.textContent || "").trim().replace(/\s+/g, " ");
      if (isViewerProfileTabsText(text)) continue;
      if (text.length > 40) continue;

      element.dataset.igivHiddenSpacer = "true";
    }
  }

  function hideAdContainers() {
    for (const ad of document.body.querySelectorAll(VIEWER_AD_SELECTOR)) {
      let target = ad;
      let parent = ad.parentElement;

      while (parent && parent !== document.body) {
        const rect = visibleRect(parent);
        const text = normalizedText(parent);

        if (
          !rect ||
          rect.height > Math.max(window.innerHeight * 1.2, 900) ||
          text.length > 80 ||
          isViewerProfileTabsText(text) ||
          isProtectedProfileTabsArea(parent) ||
          parent.querySelector("img, video, picture, input, textarea, select")
        ) {
          break;
        }

        target = parent;
        parent = parent.parentElement;
      }

      if (target && target.nodeType === Node.ELEMENT_NODE) {
        if (isProtectedProfileTabsArea(target)) continue;
        target.dataset.igivHiddenSpacer = "true";
      }
    }
  }

  function hideTallBlankBlocksBetween(startTop, endTop) {
    for (const element of document.body.querySelectorAll("div, section, aside")) {
      if (element.id === MODAL_ID || element.closest(`#${MODAL_ID}`)) continue;
      if (isProtectedProfileTabsArea(element)) continue;
      if (element.querySelector("img, video, picture, input, textarea, select")) continue;

      const rect = visibleRect(element);
      if (!rect || rect.height < 90 || rect.width < 240) continue;
      if (rect.top < startTop - 8 || rect.bottom > endTop + 8) continue;

      const text = normalizedText(element);
      if (isViewerProfileTabsText(text)) continue;
      if (text.length > 60) continue;

      element.dataset.igivHiddenSpacer = "true";
    }
  }

  function bottomOfProfileControlsBefore(gridTop) {
    const controlPatterns = [/share\s*to/i, /posts\s+stories\s+reels\s+tagged/i, /posts\s+stories\s+reels/i];
    let bestBottom = 0;

    for (const element of document.body.querySelectorAll("div, section, nav, ul, p")) {
      if (element.id === MODAL_ID || element.closest(`#${MODAL_ID}`)) continue;

      const rect = visibleRect(element);
      if (!rect || rect.top >= gridTop || rect.height > 180) continue;

      const text = (element.textContent || "").trim().replace(/\s+/g, " ");
      if (!text || text === "Download All") continue;

      if (controlPatterns.some((pattern) => pattern.test(text))) {
        bestBottom = Math.max(bestBottom, rect.bottom);
      }
    }

    return bestBottom;
  }

  function bottomOfPostTabsBefore(gridTop) {
    let bestBottom = 0;

    for (const element of document.body.querySelectorAll("div, section, nav, ul")) {
      if (element.id === MODAL_ID || element.closest(`#${MODAL_ID}`)) continue;

      const rect = visibleRect(element);
      if (!rect || rect.top >= gridTop || rect.height > 120 || rect.width < 240) continue;

      const text = normalizedText(element);
      if (isViewerProfileTabsText(text)) {
        bestBottom = Math.max(bestBottom, rect.bottom);
      }
    }

    return bestBottom;
  }

  function compactViewerProfilePage() {
    if (!isViewerProfileUrl(parseUrl(window.location.href))) return;

    document.documentElement.dataset.igivViewerPage = "true";
    restoreProfileTabs();
    hideAdContainers();
    hideShareAndDownloadRows();

    const pageTabsBottom = bottomOfPostTabsBefore(Number.POSITIVE_INFINITY);
    const profileControlsBottom = bottomOfProfileControlsBefore(Number.POSITIVE_INFINITY);
    const minimumTop = pageTabsBottom || profileControlsBottom || 0;
    if (!pageTabsBottom) return;

    const grid = findPostGridContainer(minimumTop);
    if (!grid) return;

    grid.style.removeProperty("margin-top");
    grid.style.removeProperty("transform");
    grid.style.removeProperty("position");
    const originalGridRect = visibleRect(grid);
    if (!originalGridRect) return;

    const originalMediaTop = firstPostMediaTop(grid, minimumTop) || originalGridRect.top;
    hideFloatingDownloadAll(originalMediaTop);
    hideEmptySpacersBeforeGrid(originalMediaTop);
    hideTallBlankBlocksBetween(minimumTop, originalMediaTop);
    hideAdContainers();
    hideShareAndDownloadRows();
  }

  function handleFrameLoad() {
    const modal = document.getElementById(MODAL_ID);

    try {
      const frameDocument = activeFrame.contentDocument;

      if (activeFrame.dataset.igivFallback !== "true" && isCloudflareChallengeFrame(frameDocument)) {
        viewerChallengeDetected = true;
        showPreviewFallback("challenge");
        return;
      }

      if (activeFrame.dataset.igivFallback !== "true" && frameDocument && isContentNotFoundFrame(frameDocument)) {
        tryNextPostCandidate();
        return;
      }

      if (modal) modal.dataset.loading = "false";
      prepareFrameDocument(frameDocument, activeFrame.contentWindow.location.href);
    } catch (_) {
      // If Imginn changes origins or browser isolation blocks access, the iframe still works normally.
      if (modal) modal.dataset.loading = "false";
    }
  }

  function frameVisibleRect(element) {
    const view = element.ownerDocument.defaultView;
    if (!view) return null;

    const rect = element.getBoundingClientRect();
    const style = view.getComputedStyle(element);

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return null;
    }

    return rect;
  }

  function hideFrameElement(element) {
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      element.classList.add(HIDDEN_CLASS);
    }
  }

  function frameChromeBlockFor(element) {
    let target = element;
    let parent = element.parentElement;

    while (parent && parent !== element.ownerDocument.body) {
      const rect = frameVisibleRect(parent);
      const text = normalizedText(parent);

      if (!rect || rect.top > 285 || rect.height > 180 || text.length > 320) {
        break;
      }

      target = parent;
      parent = parent.parentElement;
    }

    return target;
  }

  function hideFrameChrome(frameDocument) {
    if (!frameDocument.body) return;

    for (const element of frameDocument.querySelectorAll("header, nav, [role='banner']")) {
      hideFrameElement(element);
    }

    for (const input of frameDocument.querySelectorAll("input, textarea")) {
      const label = `${input.getAttribute("placeholder") || ""} ${input.getAttribute("aria-label") || ""}`;
      if (/search\s*users/i.test(label) || /search/i.test(label)) {
        hideFrameElement(frameChromeBlockFor(input.closest("form") || input));
      }
    }

    for (const element of frameDocument.body.querySelectorAll("div, section, p, span, h1, h2, a")) {
      const rect = frameVisibleRect(element);
      if (!rect || rect.top > 285 || rect.height > 180) continue;

      const text = normalizedText(element);
      if (!text) continue;

      if (/^imginn$/i.test(text) || /instagram story viewer/i.test(text) || /search\s*users/i.test(text)) {
        hideFrameElement(frameChromeBlockFor(element));
      }
    }
  }

  function prepareFrameDocument(frameDocument, frameHref) {
    if (!frameDocument || !frameDocument.documentElement) return;

    frameDocument.documentElement.dataset.igivFramed = "true";

    if (!frameDocument.getElementById(FRAME_STYLE_ID)) {
      const style = frameDocument.createElement("style");
      style.id = FRAME_STYLE_ID;
      style.textContent = `
        body {
          background: #fff !important;
          margin: 0 !important;
        }

        body > header,
        body > footer,
        body > nav,
        header,
        nav,
        [role="banner"],
        ${POST_AD_SELECTOR},
        [data-igiv-post-spacer="true"],
        .${HIDDEN_CLASS} {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          min-height: 0 !important;
          overflow: hidden !important;
          padding: 0 !important;
        }

        a {
          cursor: pointer !important;
        }
      `;
      (frameDocument.head || frameDocument.documentElement).appendChild(style);
    }

    hideFrameChrome(frameDocument);
    installPostGapCleanup(frameDocument);

    if (frameDocument.documentElement.dataset.igivClickHandler !== "true") {
      frameDocument.documentElement.dataset.igivClickHandler = "true";

      frameDocument.addEventListener(
        "click",
        (event) => {
          if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) return;
          if (playLinkedVideo(event)) return;
          const link = closestAnchor(event.target);
          if (!link) return;

          const targetUrl = parseUrl(link.href, frameHref);
          if (!targetUrl || !isViewerHost(targetUrl.hostname)) return;

          if (isViewerPostUrl(targetUrl)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openPostModal(targetUrl, link);
            return;
          }

          if (isViewerProfileUrl(targetUrl)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
            window.location.assign(sameViewerOriginUrl(targetUrl));
          }
        },
        true
      );
    }
  }

  function installPostGapCleanup(frameDocument) {
    if (frameDocument.documentElement.dataset.igivPostCleanup === "true") return;
    frameDocument.documentElement.dataset.igivPostCleanup = "true";

    const isEmptyWrapper = (element) => {
      const copy = element.cloneNode(true);
      copy.querySelectorAll(`${POST_AD_SELECTOR}, script, style, [data-igiv-post-spacer="true"]`).forEach((node) => node.remove());
      const contentSelector = "img, video, picture, audio, iframe, input, button, a, canvas, svg, form, [role], [tabindex], [data-src], [data-srcset], [class*='swiper'], [class*='slide'], [class*='media']";
      if (copy.matches(contentSelector) || normalizedText(copy) || copy.querySelector(contentSelector)) return false;
      // Background images and lazy placeholders are content even without child images.
      return [element, ...element.querySelectorAll("*")].every((node) =>
        node.matches(POST_AD_SELECTOR) || frameDocument.defaultView.getComputedStyle(node).backgroundImage === "none"
      );
    };
    const markSpacer = (element) => {
      if (element.dataset.igivPostSpacer !== "true") element.dataset.igivPostSpacer = "true";
    };

    const cleanup = () => {
      for (const spacer of Array.from(frameDocument.querySelectorAll('[data-igiv-post-spacer="true"]')).reverse()) {
        if (!spacer.matches(POST_AD_SELECTOR) && !isEmptyWrapper(spacer)) delete spacer.dataset.igivPostSpacer;
      }

      for (const ad of frameDocument.querySelectorAll(POST_AD_SELECTOR)) {
        markSpacer(ad);
        for (let parent = ad.parentElement; parent && parent !== frameDocument.body; parent = parent.parentElement) {
          if (!isEmptyWrapper(parent)) break;
          markSpacer(parent);
        }
      }
    };

    cleanup();
    const view = frameDocument.defaultView;
    let queued = false;
    const schedule = () => {
      if (queued || !view) return;
      queued = true;
      view.requestAnimationFrame(() => {
        queued = false;
        cleanup();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(frameDocument.body, { childList: true, subtree: true });
    frameDocument.addEventListener("load", schedule, true);
    if (view) view.addEventListener("resize", schedule, { passive: true });
    if (view) view.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  function handleViewerClick(event) {
    if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) return;
    if (playLinkedVideo(event)) return;

    const link = closestAnchor(event.target);
    if (!link) return;

    const targetUrl = parseUrl(link.href, window.location.href);
    if (!isViewerPostUrl(targetUrl)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openPostModal(targetUrl, link);
  }

  function playLinkedVideo(event) {
    const link = closestAnchor(event.target);
    if (!link || link.hasAttribute("download") || /\bdownload\b/i.test(normalizedText(link))) return false;
    const url = parseUrl(link.href);
    if (!url || url.protocol !== "https:" ||
        !(url.hostname === "cdninstagram.com" || url.hostname.endsWith(".cdninstagram.com")) ||
        !/\.(mp4|webm)$/i.test(url.pathname)) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    const doc = link.ownerDocument;
    const container = doc.createElement("div");
    container.dataset.igivVideoPlayer = "true";
    const video = doc.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url.href;
    video.style.cssText = "display:block;width:100%;max-width:640px;max-height:80vh;aspect-ratio:9/16;object-fit:contain;background:#000";
    const poster = link.querySelector("img");
    if (poster) video.poster = poster.currentSrc || poster.src;
    const status = doc.createElement("p");
    status.setAttribute("role", "status");
    status.hidden = true;
    video.addEventListener("error", () => {
      status.textContent = "This video could not load from Instagram's media server. Its link may have expired.";
      status.hidden = false;
    });
    container.append(video, status);
    link.replaceWith(container);
    // Playback stays in this document; an expired media URL must never navigate the page.
    video.play().catch(() => {});
    return true;
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeModal();
    }
  }

  function installProfileGapCleanup() {
    onReady(() => {
      let queued = false;
      let retries = 0;

      const schedule = () => {
        if (queued) return;
        queued = true;

        window.requestAnimationFrame(() => {
          queued = false;
          collapseProfilePostGap();
        });
      };

      const observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      document.addEventListener("load", schedule, true);
      window.addEventListener("resize", schedule, { passive: true });
      schedule();

      const retryTimer = window.setInterval(() => {
        retries += 1;
        schedule();

        if (retries >= 20) {
          window.clearInterval(retryTimer);
        }
      }, 500);
    });
  }

  function installProfileCompactor() {
    onReady(() => {
      ensureStyles();
      compactViewerProfilePage();

      let queued = false;
      const schedule = () => {
        if (queued) return;
        queued = true;

        window.requestAnimationFrame(() => {
          queued = false;
          compactViewerProfilePage();
        });
      };

      const observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      document.addEventListener("load", schedule, true);
      window.addEventListener("load", schedule, { once: true });
      window.addEventListener("resize", schedule, { passive: true });

      let retries = 0;
      const retryTimer = window.setInterval(() => {
        retries += 1;
        schedule();

        if (retries >= 30 || document.querySelector("[data-igiv-compacted='true']")) {
          window.clearInterval(retryTimer);
        }
      }, 500);
    });
  }

  function installViewerModal() {
    document.addEventListener("click", handleViewerClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    installViewerProfileRecovery();
    installStoryFallback();

    if (isViewerProfileUrl(parseUrl(window.location.href))) {
      const enableViewerPageStyles = () => {
        if (!document.documentElement) return;

        document.documentElement.dataset.igivViewerPage = "true";
        ensureStyles();
      };

      enableViewerPageStyles();
      onReady(enableViewerPageStyles);
      installProfileGapCleanup();
    }

    console.info(`${SCRIPT_NAME}: Imginn popup mode is active.`);
  }

  const currentUrl = parseUrl(window.location.href);
  if (!currentUrl) return;

  if (isInstagramHost(currentUrl.hostname)) {
    installInstagramLoggedOutRedirect();
    return;
  }

  if (isViewerHost(currentUrl.hostname)) {
    installViewerModal();
  }
})();
