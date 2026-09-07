# IG Logged-Out Profile Viewer

Tampermonkey userscript that leaves Instagram alone when you are logged in, but redirects public Instagram profile, post, and reel links to Imginn when you are logged out or hit a login gate.

## Features

- Lets Instagram work normally when you are logged in.
- Redirects public Instagram profile/post/reel URLs to Imginn when logged out.
- Handles Instagram login redirect URLs with `next=` by sending the public target to Imginn.
- Opens Imginn post/reel links in an in-page popup.
- Sends detected private accounts to their normal Instagram profile, including notices that load after the profile header.
- Keeps Imginn's native story/highlight viewer. A failed click shows an optional Instagram profile link after five seconds, without automatically leaving the page. Cloudflare verification pauses that wait.
- Plays linked Instagram CDN videos inside the page or popup, with native video controls and an in-place error if the media cannot load. Explicit Download links are left alone.
- Uses a single canonical fallback for flaky Imginn post detail links instead of repeatedly requesting unrelated URL variants.
- Removes Imginn's variable-height profile ad slots and share/download rows without repositioning the profile or post grid.
- Removes identifiable ad slots and ad-only wrappers above popup media, including ads inserted after loading, without changing carousel sizing or hiding lazy media placeholders.

## Install

1. Install Tampermonkey or another userscript manager.
2. Open the [installation page](https://greasyfork.org/en/scripts/584998-ig-logged-out-profile-viewer) on Greasy Fork.
3. Press **Install this script**.

## Notes

This script depends on what Imginn exposes publicly. If Imginn only has a thumbnail and returns `Content Not Found` for the detail page, the script cannot create missing comments, tagged users, or videos.

Account privacy cannot be determined from a username alone. The script redirects when Imginn identifies a private account or cannot provide its profile. Instagram may require login to show stories or private content.

On Imginn's Stories page, the first circle labeled Stories is intended for current stories; named circles are highlights. A circle does not guarantee playable media is available. Imginn can return errors or older profile data, and Instagram CDN links can expire. This script cannot force Imginn to fetch the latest posts or recover unavailable stories.

## Browser Checks

Install Python's `playwright` package and its Chromium browser, then run `python3 tests/browser_regressions.py`. To use an existing Chromium-based browser, set `IGIV_BROWSER` to its executable path. The tests use local fixtures and do not request live Instagram or Imginn pages.

## License

MIT
