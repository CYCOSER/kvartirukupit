FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
WORKDIR /opt/upscale
RUN python -m pip install --no-cache-dir --no-deps torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
RUN python -m pip install --no-cache-dir torch==2.6.0 torchvision==0.21.0 numpy==1.26.4 opencv-python-headless==4.11.0.86 addict future lmdb pillow pyyaml requests scikit-image scipy tensorboard tqdm yapf
RUN python -m pip install --no-cache-dir --no-deps basicsr==1.4.2 realesrgan==0.3.0
COPY setup-models.py ./
RUN python setup-models.py
COPY server.py test_server.py LICENSE-Real-ESRGAN ./
RUN python -m unittest test_server
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8080/health', timeout=3).read()"
ENTRYPOINT ["python", "/opt/upscale/server.py"]
