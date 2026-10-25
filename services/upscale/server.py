"""Private CPU Real-ESRGAN service. The web app owns authorization and the queue."""
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 8_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
WEIGHTS = Path('/opt/upscale/weights/realesr-general-wdn-x4v3.pth')
MODEL = None
INFERENCE = threading.Lock()


def target_size(width, height, mode):
    if mode not in ('auto', 'manual'):
        raise ValueError('Mode must be auto or manual')
    long, short = max(width, height), min(width, height)
    scale = max(1, 1920 / long, 1080 / short) if mode == 'auto' else 2
    scale = max(1, min(scale, 4, 4096 / long))
    return max(1, round(width * scale)), max(1, round(height * scale))


def decode_image(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError('Image must be between 1 byte and 15 MiB')
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP') or getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Only still JPEG, PNG and WebP images are supported')
        if source.width * source.height > MAX_PIXELS:
            raise ValueError('Image must contain at most 8 million pixels')
        image = ImageOps.exif_transpose(source)
        alpha = image.getchannel('A').copy() if image.mode in ('RGBA', 'LA') else None
        if image.mode == 'P' and 'transparency' in image.info:
            alpha = image.convert('RGBA').getchannel('A')
        return np.array(image.convert('RGB')), alpha


def get_model():
    global MODEL
    if MODEL is None:
        import torch
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        cv2.setNumThreads(1)
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64,
                               num_conv=32, upscale=4, act_type='prelu')
        weights = torch.load(WEIGHTS, map_location='cpu', weights_only=True)
        model.load_state_dict(weights.get('params_ema', weights.get('params', weights)), strict=True)
        MODEL = model.eval()
    return MODEL


def enhance_tiles(image):
    import torch
    model = get_model()
    height, width = image.shape[:2]
    # A uint8 canvas avoids RealESRGANer's full-size float32 output allocation.
    output = np.empty((height * 4, width * 4, 3), dtype=np.uint8)
    tile, pad = 192, 40
    with torch.inference_mode():
        for top in range(0, height, tile):
            bottom = min(top + tile, height)
            for left in range(0, width, tile):
                right = min(left + tile, width)
                x0, y0 = max(0, left - pad), max(0, top - pad)
                x1, y1 = min(width, right + pad), min(height, bottom + pad)
                patch = torch.from_numpy(image[y0:y1, x0:x1].copy()).permute(2, 0, 1).float().div_(255).unsqueeze(0)
                result = model(patch)[0].clamp_(0, 1)
                result = result[:, (top-y0)*4:(bottom-y0)*4, (left-x0)*4:(right-x0)*4]
                pixels = result.mul(255).round_().byte().permute(1, 2, 0).numpy()
                output[top*4:bottom*4, left*4:right*4] = pixels
    return output


def upscale(data, mode):
    image, alpha = decode_image(data)
    height, width = image.shape[:2]
    target = target_size(width, height, mode)
    if target[0] > width or target[1] > height:
        image = enhance_tiles(image)
    if (image.shape[1], image.shape[0]) != target:
        image = cv2.resize(image, target, interpolation=cv2.INTER_LANCZOS4)
    result = Image.fromarray(image)
    if alpha is not None:
        result.putalpha(alpha.resize(target, Image.Resampling.LANCZOS))
    buffer = io.BytesIO()
    result.save(buffer, format='WEBP', quality=94, method=4)
    return buffer.getvalue(), target


class Handler(BaseHTTPRequestHandler):
    server_version = 'RealESRGAN'

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def respond(self, status, data, content_type='application/json', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message):
        self.respond(status, json.dumps({'error': message}).encode())

    def do_GET(self):
        if self.path != '/health':
            self.error(404, 'Not found')
            return
        self.respond(200, b'{"ok":true}')

    def do_POST(self):
        if self.path != '/upscale':
            self.error(404, 'Not found')
            return
        mode = self.headers.get('X-Upscale-Mode', '')
        if mode not in ('auto', 'manual'):
            self.error(400, 'X-Upscale-Mode must be auto or manual')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_BYTES or self.headers.get('Transfer-Encoding'):
            self.error(413, 'Content-Length must be between 1 byte and 15 MiB')
            return
        if not INFERENCE.acquire(blocking=False):
            self.error(503, 'Upscaler is busy')
            return
        try:
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('Incomplete image body')
            result, (width, height) = upscale(data, mode)
            self.respond(200, result, 'image/webp', {'X-Image-Width': width, 'X-Image-Height': height})
        except (ValueError, UnidentifiedImageError, Image.DecompressionBombError, OSError) as error:
            self.error(422, str(error))
        except Exception:
            import traceback
            traceback.print_exc()
            self.error(500, 'Image processing failed')
        finally:
            INFERENCE.release()


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
