"""Run with Python and playwright installed; uses local fixtures, no live requests.

IGIV_BROWSER can point to a Chromium browser; otherwise Playwright's Chromium is used.
"""

import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


SCRIPT = (Path(__file__).resolve().parents[1] / 'ig-logged-out-profile-viewer.user.js').read_text()
PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
HEADER = '''<div class="userinfo">Account <p>This account is private is an example phrase in this bio.</p></div>
<nav class="tabs"><a href="/kingjames/">POSTS</a> <a href="/stories/kingjames/">STORIES</a>
<a href="/reels/kingjames/">REELS</a> <a href="/tagged/kingjames/">TAGGED</a></nav>'''


def profile(content='', extra_script=''):
    return f'''<!doctype html><html><head><title>Imginn</title><style>
body {{ margin:0; font:14px sans-serif; }} .page-user {{ max-width:900px; margin:auto; }}
.userinfo {{ height:120px; }} .tabs {{ height:48px; }} .items {{ display:flex; gap:12px; }}
.items img {{ width:220px; height:300px; background:#269b9b; }}
[data-igiv-story-control] img {{ width:70px; height:70px; background:#369; border:3px solid #09f; border-radius:50%; }}
</style></head><body><main class="page-user">{HEADER}{content}</main>{extra_script}</body></html>'''


def post():
    return f'''<!doctype html><html><head><style>
body {{ margin:0; font:14px sans-serif; }} header {{ height:90px; }}
.page-post {{ max-width:650px; margin:auto; }} .userinfo {{ height:80px; }}
.co-creators {{ height:50px; }} .wrapper {{ min-height:750px; }}
.block-sulvo {{ height:700px; }}
.media img {{ display:block; width:100%; height:360px; background:#329b94; }}
.carousel-controls {{ height:32px; }}
</style></head><body><header>Imginn Search Users</header><main class="page-post">
<div class="userinfo">Chris Johnson</div><div class="co-creators">Co Creator: Three accounts</div>
<div class="wrapper"><div class="block-sulvo"><ins class="adsbygoogle"></ins></div></div>
<div class="blank"></div><div class="media"><div class="swiper-button-prev" role="button" tabindex="0" aria-label="Previous"></div><img id="post-image" src="{PIXEL}" alt="Post">
<div class="carousel-controls"><button id="next" onclick="this.dataset.clicked='true'">Next</button></div></div>
<p id="caption">Post caption</p></main></body></html>'''


class BrowserRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        options = {'headless': True}
        if os.environ.get('IGIV_BROWSER'):
            options['executable_path'] = os.environ['IGIV_BROWSER']
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900})
        self.addCleanup(self.context.close)
        # Userscript metadata prevents injection in frames; reproduce that restriction.
        self.context.add_init_script(script='if (window.top === window) {\n' + SCRIPT + '\n}')
        self.page = self.context.new_page()
        self.errors = []
        self.requests = []
        self.video_bytes = None
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.documents = {'/kingjames/': profile()}
        self.context.route('**/*', self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        self.requests.append(route.request.url)
        if url.hostname == 'www.instagram.com':
            route.fulfill(content_type='text/html', body='<main id="instagram">Instagram</main>')
        elif url.hostname == 'imginn.com' and url.path in self.documents:
            route.fulfill(content_type='text/html', body=self.documents[url.path])
        elif url.hostname == 'scontent-test.cdninstagram.com' and self.video_bytes:
            route.fulfill(content_type='video/webm', body=self.video_bytes)
        else:
            route.abort()

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def open_profile(self, path='/kingjames/'):
        self.page.goto('https://imginn.com' + path, wait_until='commit')

    def test_private_notice_initial_and_late(self):
        for late in (False, True):
            with self.subTest(late=late):
                self.documents['/kingjames/'] = profile('' if late else '<div class="items"><p>This account is private.</p></div>')
                self.open_profile()
                if late:
                    self.page.wait_for_selector('.tabs')
                    self.page.wait_for_timeout(300)
                    self.page.evaluate('''() => {
                      const p = document.createElement('p'); p.textContent = 'You visit a private account.';
                      document.querySelector('.page-user').append(p);
                    }''')
                self.page.wait_for_selector('#instagram', timeout=1500)
                self.assertEqual(self.page.url, 'https://www.instagram.com/kingjames/')

    def test_public_profile_and_tabs_stay_visible(self):
        self.documents['/kingjames/'] = profile(f'<div class="block-money" style="height:700px"></div><div class="items"><a href="/p/code/"><img src="{PIXEL}"></a></div>')
        self.open_profile()
        self.page.wait_for_selector('.items img')
        self.page.wait_for_timeout(5300)
        self.assertIn('imginn.com', self.page.url)
        tabs = self.page.locator('.tabs').bounding_box()
        media = self.page.locator('.items img').bounding_box()
        self.assertLessEqual(media['y'] - tabs['y'] - tabs['height'], 12)
        self.assertTrue(self.page.get_by_text('STORIES', exact=True).is_visible())

    def story_document(self, native=False):
        script = ''
        if native:
            script = f'''<script>document.querySelector('#story').onclick = () => {{
              const img = document.createElement('img'); img.src = '{PIXEL}';
              img.style.cssText = 'width:300px;height:500px;background:#f00';
              img.id = 'native-story'; document.body.append(img);
            }};</script>'''
        return profile(f'<div class="stories"><a id="story" href="#"><img src="{PIXEL}" width="70" height="70"><span>Stories</span></a></div>', script)

    def test_dead_story_circle_stays_with_optional_profile_link(self):
        self.documents['/stories/kingjames/'] = self.story_document()
        self.open_profile('/stories/kingjames/')
        self.page.wait_for_selector('[data-igiv-story-control]')
        self.page.locator('#story').click()
        self.page.wait_for_selector('[data-igiv-story-status]', timeout=6500)
        self.assertIn('imginn.com/stories/kingjames/', self.page.url)
        self.page.locator('[data-igiv-story-status] a').click()
        self.page.wait_for_selector('#instagram')
        self.assertEqual(self.page.url, 'https://www.instagram.com/kingjames/')

    def test_working_native_story_does_not_fall_back(self):
        self.documents['/stories/kingjames/'] = self.story_document(native=True)
        self.open_profile('/stories/kingjames/')
        self.page.wait_for_selector('[data-igiv-story-control]')
        self.page.locator('#story').click()
        self.page.wait_for_selector('#native-story')
        self.page.wait_for_timeout(5400)
        self.assertIn('imginn.com/stories/kingjames/', self.page.url)

    def test_story_keyboard_and_verification_pause(self):
        self.documents['/stories/kingjames/'] = self.story_document().replace('<a id="story" href="#">', '<div id="story">').replace('</span></a>', '</span></div>')
        self.open_profile('/stories/kingjames/')
        self.page.wait_for_selector('[data-igiv-story-control]')
        self.page.locator('#story').focus()
        self.page.keyboard.press('Enter')
        self.page.evaluate("() => { const p = document.createElement('p'); p.id = 'challenge-running'; p.textContent = 'Verifying you are human'; document.body.append(p); }")
        self.page.wait_for_timeout(5300)
        self.assertIn('imginn.com', self.page.url)
        self.page.evaluate("() => document.querySelector('#challenge-running').remove()")
        self.page.wait_for_timeout(2800)
        self.assertIn('imginn.com', self.page.url)
        self.page.wait_for_selector('[data-igiv-story-status]', timeout=3500)
        self.assertIn('imginn.com', self.page.url)

    def test_popup_gap_and_dynamic_ads_desktop_mobile(self):
        for width, kind in [(1280, 'p'), (390, 'reel')]:
            with self.subTest(width=width, kind=kind):
                self.page.set_viewport_size({'width': width, 'height': 850})
                self.documents['/kingjames/'] = profile(f'<div class="items"><a id="post" href="/{kind}/code/"><img src="{PIXEL}"></a></div>')
                self.documents[f'/{kind}/code/'] = post()
                self.open_profile()
                self.page.locator('#post').click()
                frame = self.page.frame_locator('#igiv-post-modal iframe')
                frame.locator('#post-image').wait_for()
                image = frame.locator('#post-image')
                self.page.wait_for_timeout(100)
                # Coordinates are relative to the iframe viewport.
                self.assertLessEqual(image.evaluate('(e) => e.getBoundingClientRect().top'), 142)
                self.assertTrue(frame.locator('.userinfo').is_visible())
                self.assertTrue(frame.locator('.co-creators').is_visible())
                self.assertTrue(frame.locator('#caption').is_visible())
                self.assertIsNone(frame.locator('.swiper-button-prev').get_attribute('data-igiv-post-spacer'))
                frame.locator('#next').click()
                self.assertEqual(frame.locator('#next').get_attribute('data-clicked'), 'true')
                image.evaluate('''e => {
                  const ad = e.ownerDocument.createElement('div'); ad.style.height='600px';
                  ad.innerHTML='<div class="block-money" style="height:600px"></div>';
                  e.closest('.media').before(ad);
                }''')
                self.page.wait_for_timeout(200)
                self.assertLessEqual(image.evaluate('(e) => e.getBoundingClientRect().top'), 142)
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'igiv-popup-{width}.png'))
                frame.locator('.blank').evaluate('(e) => { e.textContent = "Late post content"; }')
                self.page.wait_for_timeout(100)
                self.assertTrue(frame.get_by_text('Late post content', exact=True).is_visible())

    def test_login_redirect_with_fallback_marker_stays_on_instagram(self):
        self.page.goto('https://www.instagram.com/accounts/login/?next=%2Fkingjames%2F%3Figiv_stay%3D1')
        self.page.wait_for_selector('#instagram')
        self.assertTrue(self.page.url.startswith('https://www.instagram.com/accounts/login/'))
        self.assertFalse(any('imginn.com' in url for url in self.requests))

    def test_popup_preserves_padding_sized_carousel(self):
        self.documents['/kingjames/'] = profile(f'<a id="post" href="/p/code/"><img src="{PIXEL}" width="220" height="300"></a>')
        self.documents['/p/code/'] = f'''<html><head><style>
          .page-post {{ width:90%;margin:auto }}
          .swiper-slide {{ position:relative;height:0;padding-top:80%;overflow:hidden }}
          .swiper-slide img {{ position:absolute;inset:0;width:100%;height:100%;background:rgb(30,160,110) }}
          </style></head><body><main class="page-post"><div class="userinfo">Author</div>
          <div class="block-money" style="height:700px"></div>
          <div class="swiper-slide"><img id="real-media" src="{PIXEL}"></div></main></body></html>'''
        self.open_profile()
        self.page.locator('#post').click()
        frame = self.page.frame_locator('#igiv-post-modal iframe')
        frame.locator('#real-media').wait_for(state='attached')
        self.page.wait_for_timeout(400)
        self.assertGreater(frame.locator('.swiper-slide').evaluate('(e) => e.getBoundingClientRect().height'), 200)
        self.assertTrue(frame.locator('#real-media').is_visible())
        for width in (1280, 390):
            self.page.set_viewport_size({'width': width, 'height': 850})
            self.page.wait_for_timeout(200)
            self.assertGreater(frame.locator('.swiper-slide').evaluate('(e) => e.getBoundingClientRect().height'), 200)
            self.assertTrue(frame.locator('#real-media').is_visible())
            self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'igiv-carousel-{width}.png'))

    def test_story_highlight_error_stays_and_late_media_clears_notice(self):
        self.documents['/stories/kingjames/'] = self.story_document().replace(
            '</span></a></div>', f'</span></a><a id="highlight" href="#"><img src="{PIXEL}" width="70" height="70">Highlights</a></div>')
        self.open_profile('/stories/kingjames/')
        self.page.wait_for_selector('#highlight[data-igiv-story-control]')
        self.page.locator('#highlight').click()
        self.page.evaluate("() => { const p=document.createElement('p'); p.textContent='Server Error, Refresh later'; document.body.append(p); }")
        self.page.wait_for_selector('[data-igiv-story-status]', timeout=6500)
        self.assertIn('imginn.com', self.page.url)
        self.page.evaluate(f"() => {{ const img=new Image(); img.src='{PIXEL}'; img.style.cssText='width:300px;height:500px'; document.body.append(img); }}")
        self.page.locator('[data-igiv-story-status]').wait_for(state='detached')

    def test_cdn_video_play_stays_inline_on_story_page_and_popup(self):
        media_url = 'https://scontent-test.cdninstagram.com/story.mp4?token=a%2Bb&oh=signature'
        links = f'<a id="play" href="{media_url}">Play</a><a id="download" href="{media_url}" download>Download</a>'
        for framed in (False, True):
            with self.subTest(framed=framed):
                if framed:
                    self.documents['/kingjames/'] = profile(f'<a id="post" href="/p/code/"><img src="{PIXEL}" width="220" height="300"></a>')
                    self.documents['/p/code/'] = f'<html><body><main class="page-post">{links}</main></body></html>'
                    self.open_profile()
                    self.page.locator('#post').click()
                    scope = self.page.frame_locator('#igiv-post-modal iframe')
                else:
                    self.documents['/stories/kingjames/'] = profile(links)
                    self.open_profile('/stories/kingjames/')
                    scope = self.page
                scope.locator('#play').wait_for()
                if framed:
                    scope.locator('html[data-igiv-click-handler="true"]').wait_for(state='attached')
                original_url = self.page.url
                scope.locator('#play').click()
                video = scope.locator('[data-igiv-video-player] video')
                video.wait_for()
                self.assertEqual(video.get_attribute('src'), media_url)
                self.assertTrue(video.evaluate('(e) => e.controls && e.playsInline'))
                # All external media requests are blocked by the fixture router.
                scope.locator('[data-igiv-video-player] [role="status"]').wait_for()
                self.assertEqual(self.page.url, original_url)
                self.assertEqual(scope.locator('#download').get_attribute('href'), media_url)
                self.assertTrue(scope.locator('#download').is_visible())

    def test_linked_video_actually_plays_without_navigation(self):
        self.video_bytes = bytes(self.page.evaluate('''async () => {
          const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=240;
          const ctx = canvas.getContext('2d'); ctx.fillStyle='#159c79'; ctx.fillRect(0,0,160,240);
          const stream=canvas.captureStream(10); const recorder=new MediaRecorder(stream, {mimeType:'video/webm'});
          const chunks=[]; recorder.ondataavailable=e=>chunks.push(e.data);
          const done=new Promise(resolve=>recorder.onstop=resolve);
          recorder.start(); await new Promise(resolve=>setTimeout(resolve,400)); recorder.stop(); await done;
          stream.getTracks().forEach(track=>track.stop());
          return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
        }'''))
        self.documents['/stories/kingjames/'] = profile('<a id="play" href="https://scontent-test.cdninstagram.com/story.webm?token=unchanged">Play</a>')
        self.open_profile('/stories/kingjames/')
        self.page.locator('#play').click()
        self.page.wait_for_function('document.querySelector("video")?.currentTime > 0')
        self.assertIn('imginn.com/stories/kingjames/', self.page.url)
        self.assertTrue(self.page.locator('video').is_visible())
        self.assertTrue(self.page.locator('[data-igiv-video-player] [role="status"]').is_hidden())

    def test_server_error_and_loading_timeout(self):
        self.documents['/kingjames/'] = '<html><body>Server error, please try again later.</body></html>'
        self.open_profile()
        self.page.wait_for_selector('#instagram', timeout=1500)
        self.documents['/kingjames/'] = '<html><body>Loading</body></html>'
        self.open_profile()
        self.page.wait_for_timeout(3000)
        self.assertIn('imginn.com', self.page.url)
        self.page.wait_for_selector('#instagram', timeout=3500)


if __name__ == '__main__':
    unittest.main(verbosity=2)
