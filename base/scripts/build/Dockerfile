# Build environment for the vendored engines: the same image definition builds
# x86-64 and ARM64 (docker build --platform linux/arm64).
# The base image is pinned by its multi-architecture digest (node:22-bookworm-slim).
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bison build-essential ca-certificates cmake flex git ninja-build perl pkg-config python3 zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

# The build runs as the host user (container.sh passes its UID); PostgreSQL's initdb
# refuses to run as a UID that has no passwd entry.
ARG DMB_UID=1000
RUN getent passwd "$DMB_UID" >/dev/null || useradd --uid "$DMB_UID" --no-create-home --home-dir /tmp builder

# The repository is mounted from the host and owned by the host user.
RUN git config --system --add safe.directory /repo
WORKDIR /repo
ENTRYPOINT ["node", "scripts/build/build.ts"]
