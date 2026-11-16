# Everything the film scripts need, for rendering without installing Python on your computer:
# Python with the packages from requirements.txt in a virtual environment, Node, Chromium and the Kokoro voice model.
# The project itself is not copied in: `npm run film:tour -- --docker ...` mounts it at /work.
#
#   docker build -t crowdpulse-film film
#   docker run --rm -v "<project folder>:/work" crowdpulse-film film/render_tour.py --storyboard
FROM node:24-bookworm-slim AS node

FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    KOKORO_DIR=/opt/kokoro \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
 && pip install --no-cache-dir -r /tmp/requirements.txt \
 && playwright install --with-deps chromium \
 && apt-get install -y --no-install-recommends fonts-noto-color-emoji fonts-inter \
 && rm -rf /var/lib/apt/lists/*

COPY get_voice.py /tmp/get_voice.py
RUN python /tmp/get_voice.py /opt/kokoro

WORKDIR /work
ENTRYPOINT ["python"]
