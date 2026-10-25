# CPU photo upscaler

Private HTTP service using Real-ESRGAN's compact `realesr-general-wdn-x4v3`
weights (the soft, zero-denoise variant). No GPU or external inference API is
required. The web app supplies the durable queue and authorization. Do not
publish this service's port to the internet.

Build with `docker build -t newh-upscale:local services/upscale`.
The build downloads CPU PyTorch and the official model once; model SHA-256 is
verified. Runtime needs no internet. Allow 2 CPU cores and 4 GiB RAM.

- `GET /health`: JSON `{"ok":true}`; remains responsive during inference.
- `POST /upscale`: raw JPEG/PNG/WebP bytes, required `Content-Length` and
  `X-Upscale-Mode: auto` or `manual`; returns `image/webp` and
  `X-Image-Width` / `X-Image-Height` headers.
- Only one inference runs at a time; another request receives 503.
- At most 15 MiB and 8 million source pixels; still images only. Bad input is
  rejected with 4xx JSON. Internal inference errors return 500 and leave the
  service available for later requests.

Automatic mode reaches both 1920 pixels on the long edge and 1080 on the short
edge. Manual mode targets 2×. Both preserve aspect ratio, cap enlargement at 4×
and enlargement at 4096 pixels on the long edge. Sources already at or above
that limit retain their dimensions and bypass inference. Very small or panoramic
sources may therefore remain below Full HD. Already sufficient images bypass inference.

Inference uses FP32 CPU, two threads, 192-pixel tiles and 40-pixel overlap.
The 4× intermediate canvas is uint8 to bound RAM usage for larger sources.
EXIF orientation is applied before measuring; transparency is retained.
Original files are never written by this service. Results use WebP quality 94.

Run validation with `python -m unittest test_server` inside the service image.
The model and Real-ESRGAN code are BSD-3-Clause (see `LICENSE-Real-ESRGAN`).
Other dependencies retain their installed distribution license notices.
