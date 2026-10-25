import io
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

import server


def encoded(size=(20, 10), mode='RGB', format='PNG'):
    data = io.BytesIO()
    Image.new(mode, size, 'white').save(data, format=format)
    return data.getvalue()


class UpscaleTest(unittest.TestCase):
    def test_targets_preserve_orientation_and_bound_memory(self):
        self.assertEqual(server.target_size(800, 600, 'auto'), (1920, 1440))
        self.assertEqual(server.target_size(600, 800, 'auto'), (1440, 1920))
        self.assertEqual(server.target_size(1920, 1080, 'auto'), (1920, 1080))
        self.assertEqual(server.target_size(100, 100, 'auto'), (400, 400))
        self.assertEqual(server.target_size(3000, 600, 'auto'), (4096, 819))
        self.assertEqual(server.target_size(3000, 2000, 'manual'), (4096, 2731))
        self.assertEqual(server.target_size(5000, 600, 'auto'), (5000, 600))
        self.assertEqual(server.target_size(5000, 600, 'manual'), (5000, 600))
        self.assertEqual(server.target_size(4096, 600, 'auto'), (4096, 600))
        with self.assertRaises(ValueError):
            server.target_size(100, 100, 'anything')

    def test_reject_invalid_or_large_images(self):
        with self.assertRaises(Exception):
            server.decode_image(b'not an image')
        with self.assertRaises(ValueError):
            server.decode_image(b'x' * (server.MAX_BYTES + 1))
        with self.assertRaises(ValueError):
            server.decode_image(encoded((3000, 3000)))
        with self.assertRaises(ValueError):
            server.decode_image(encoded(format='GIF'))

    def test_exif_orientation_and_alpha(self):
        data = io.BytesIO()
        exif = Image.Exif()
        exif[274] = 6
        Image.new('RGB', (20, 10)).save(data, format='JPEG', exif=exif)
        pixels, _ = server.decode_image(data.getvalue())
        self.assertEqual(pixels.shape, (20, 10, 3))
        _, alpha = server.decode_image(encoded(mode='RGBA'))
        self.assertIsNotNone(alpha)

    def test_auto_fullhd_does_not_run_model(self):
        with patch.object(server, 'enhance_tiles', side_effect=AssertionError('unneeded inference')):
            data, size = server.upscale(encoded((1920, 1080)), 'auto')
        self.assertEqual(size, (1920, 1080))
        with Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.format, 'WEBP')

    def test_long_panorama_never_downscales_or_runs_model(self):
        with patch.object(server, 'enhance_tiles', side_effect=AssertionError('unneeded inference')):
            for mode in ('auto', 'manual'):
                data, size = server.upscale(encoded((5000, 600)), mode)
                self.assertEqual(size, (5000, 600))
                with Image.open(io.BytesIO(data)) as result:
                    self.assertEqual(result.size, (5000, 600))

    def test_resizes_real_model_output_to_target(self):
        with patch.object(server, 'enhance_tiles', side_effect=lambda a: np.repeat(np.repeat(a, 4, axis=0), 4, axis=1)):
            data, size = server.upscale(encoded((800, 600), mode='RGBA'), 'auto')
        self.assertEqual(size, (1920, 1440))
        with Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.size, size)

    def test_http_errors_and_health_during_inference(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{http.server_address[1]}'
        try:
            request = Request(base + '/upscale', data=b'bad', headers={'X-Upscale-Mode': 'auto'})
            with self.assertRaises(HTTPError) as failed:
                urlopen(request)
            self.assertEqual(failed.exception.code, 422)
            with server.INFERENCE:
                self.assertEqual(urlopen(base + '/health').status, 200)
                with self.assertRaises(HTTPError) as busy:
                    urlopen(request)
                self.assertEqual(busy.exception.code, 503)
            with patch.object(server, 'upscale', return_value=(b'webp', (1920, 1080))):
                response = urlopen(request)
                self.assertEqual(response.read(), b'webp')
                self.assertEqual(response.headers['X-Image-Width'], '1920')
                self.assertEqual(response.headers['X-Image-Height'], '1080')
        finally:
            http.shutdown()
            http.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
