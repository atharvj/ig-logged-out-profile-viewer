# IG Logged-Out Profile Viewer

Tampermonkey userscript that leaves Instagram alone when you are logged in, but redirects public Instagram profile, post, and reel links to Imginn when you are logged out or hit a login gate.

## Features

- Lets Instagram work normally when you are logged in.
- Redirects public Instagram profile/post/reel URLs to Imginn when logged out.
- Handles Instagram login redirect URLs with `next=` by sending the public target to Imginn.
- Opens Imginn post/reel links in an in-page popup.
- Sends detected private accounts to their normal Instagram profile, including notices that load after the profile header.
- Keeps Imginn's native story/highlight viewer. A failed click shows an optional Instagram profile link after five seconds, without automatically leaving the page. Cloudflare verification pauses that wait.
- Plays linked Instagram CDN videos inside the page or popup, including Play overlays backed by media data attributes or an existing video. Guards pointer/touch and click events before site document handlers can navigate away. Explicit Download commands are left alone.
- On browsers with the Navigation API, also cancels same-tab, script-triggered departures to `cdninstagram.com`. Recognized video URLs open in a dismissible on-page player; bare server URLs are blocked without attempting playback. Download commands and history traversal remain unaffected.
- Uses a single canonical fallback for flaky Imginn post detail links instead of repeatedly requesting unrelated URL variants.
- Removes Imginn's variable-height profile ad slots and share/download rows without repositioning the profile or post grid.
- Removes identifiable ad slots and ad-only wrappers above popup media, including ads inserted after loading, without changing carousel sizing or hiding lazy media placeholders.
- Includes Imginn's `demand-supply[data-ad]` post slots, which can reserve 616px above the media even when no ad loads.

## Install

1. Install Tampermonkey or another userscript manager.
2. Open the [installation page](https://greasyfork.org/en/scripts/584998-ig-logged-out-profile-viewer) on Greasy Fork.
3. Press **Install this script**.

## Notes

This script depends on what Imginn exposes publicly. If Imginn only has a thumbnail and returns `Content Not Found` for the detail page, the script cannot create missing comments, tagged users, or videos.

Account privacy cannot be determined from a username alone. The script redirects when Imginn identifies a private account or cannot provide its profile. Instagram may require login to show stories or private content.

On Imginn's Stories page, the first circle labeled Stories is intended for current stories; named circles are highlights. A circle does not guarantee playable media is available. Imginn can return errors or older profile data, and Instagram CDN links can expire. This script cannot force Imginn to fetch the latest posts or recover unavailable stories.

The extra navigation guard uses cancelable [`navigate` events](https://developer.chrome.com/docs/web-platform/navigation-api). On browsers without that API, the click/Play guards still run, but script-triggered redirects cannot be caught by that additional check. It does not intercept separate tabs opened by the site.

## Browser Checks

Install Python's `playwright` package and its Chromium browser, then run `python3 tests/browser_regressions.py`. To use an existing Chromium-based browser, set `IGIV_BROWSER` to its executable path. The tests use local fixtures and do not request live Instagram or Imginn pages.

Optionally set `IGIV_SAVED_POST` to a saved Imginn post HTML file to check its popup layout on desktop and mobile. Saved-page scripts and external requests are blocked during this check; it verifies layout, not live media availability.

## License

MIT
