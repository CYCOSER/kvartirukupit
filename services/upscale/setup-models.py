import hashlib
import importlib.util
from pathlib import Path
from urllib.request import urlopen

# BasicSR 1.4.2 uses the old torchvision path; use torchvision's public import.
package = Path(importlib.util.find_spec('basicsr').origin).parent
degradations = package / 'data' / 'degradations.py'
source = degradations.read_text()
old = 'from torchvision.transforms.functional_tensor import rgb_to_grayscale'
assert old in source
degradations.write_text(source.replace(old, 'from torchvision.transforms.functional import rgb_to_grayscale'))

weights = Path('/opt/upscale/weights')
weights.mkdir(exist_ok=True)
name = 'realesr-general-wdn-x4v3.pth'
url = f'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/{name}'
with urlopen(url, timeout=120) as response:
    data = response.read(5_000_000)
assert hashlib.sha256(data).hexdigest() == '1641f8c4464b9f097c9fdda5589273713f67cf59f3d909e0bd688f0cee269dca', 'Unexpected model checksum'
(weights / name).write_bytes(data)
from realesrgan.archs.srvgg_arch import SRVGGNetCompact
print('Verified official Real-ESRGAN model and imports')
