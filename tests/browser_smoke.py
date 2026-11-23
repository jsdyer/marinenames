"""CI-only browser checks with saved real WoRMS fixtures; no live provider traffic."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):pass

def main():
    manifest=json.loads((ROOT/'web/data/index.json').read_text())
    capture=json.loads((ROOT/'web'/manifest['captures'][0]['file']).read_text())
    example=capture['records'][0]
    shots=ROOT/'browser-checks';shots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT/'dist',Path(temporary)/'marinenames')
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=temporary))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000})
                errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.route('**/assets/tool-metrics.js',lambda route:route.fulfill(status=200,body=''))
                page.goto(f'http://127.0.0.1:{server.server_port}/marinenames/')
                page.locator('#detail h2').wait_for()
                assert page.locator('#results .name-card').count()==len(capture['records'])
                assert page.locator('#detail h2').inner_text()==example['record']['scientificname']
                page.locator('#results .name-card').nth(1).click()
                assert page.locator('#detail h2').inner_text()==capture['records'][1]['record']['scientificname']
                with page.expect_download() as event:page.get_by_role('button',name='Save record JSON',exact=True).click()
                assert event.value.suggested_filename.endswith('.json')
                def api(route):
                    url=route.request.url
                    field=next((field for fragment,field in [('Classification','classification'),('Synonyms','synonyms'),('Distributions','distributions'),('Sources','sources')] if fragment in url),None)
                    payload=example[field] if field else example['record']
                    route.fulfill(status=200,content_type='application/json',body=json.dumps(payload),headers={'Access-Control-Allow-Origin':'*'})
                page.route('https://www.marinespecies.org/rest/**',api)
                page.locator('#query').fill(str(example['record']['AphiaID']));page.locator('#search').click()
                page.wait_for_function("document.querySelector('#status').textContent.includes('Live WoRMS record retrieved')")
                assert page.locator('#detail h2').inner_text()==example['record']['scientificname']
                page.unroute('https://www.marinespecies.org/rest/**')
                page.route('https://www.marinespecies.org/rest/**',lambda route:route.fulfill(status=503,content_type='application/json',body='{}',headers={'Access-Control-Allow-Origin':'*'}))
                page.locator('#query').fill('Unknown taxon');page.locator('#search').click()
                page.wait_for_function("document.querySelector('#status').textContent.includes('Previous results are unchanged')")
                assert page.locator('#detail h2').inner_text()==example['record']['scientificname']
                page.locator('#saved').click()
                page.wait_for_function("document.querySelector('#results-title').textContent === 'Saved names'")
                page.screenshot(path=str(shots/'desktop.png'),full_page=True)
                for width in [390, 360]:
                    page.set_viewport_size({'width':width,'height':844})
                    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'Overflow at {width}px'
                    page.screenshot(path=str(shots/f'mobile-{width}.png'),full_page=True)
                hostile=json.loads(json.dumps(capture));hostile['records'][0]['record']['scientificname']='<img src=x onerror=alert(1)>'
                page.locator('#import').set_input_files({'name':'receipt.json','mimeType':'application/json','buffer':json.dumps(hostile).encode()})
                page.wait_for_function("document.querySelector('#results-title').textContent === 'Imported names'")
                assert page.locator('#detail img').count()==0
                assert '<img' in page.locator('#detail h2').inner_text()
                assert not errors,errors
                browser.close()
        finally:server.shutdown()
    print('Browser checks passed: saved and live records, error retention, export/import, safe text, mobile width')
if __name__=='__main__':main()
