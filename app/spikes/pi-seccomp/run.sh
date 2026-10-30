#!/bin/sh
# Opt-in synthetic experiment. Never mount the project or pass real credentials.
set -eu
cd "$(dirname "$0")"
image="pwa-pi-seccomp-spike:run-$$"
cleanup() { docker image rm "$image" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker build --platform linux/arm64 --tag "$image" .
for mode in control filtered; do
  if [ "$mode" = filtered ]; then
    docker run --rm --platform linux/arm64 --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --pids-limit 64 --memory 512m \
      --tmpfs /tmp:rw,noexec,nosuid,size=16m -e LD_PRELOAD=/probe/filter.so \
      -e SYNTHETIC_BROKER_MARKER=test-fixture "$image" "$mode"
  else
    docker run --rm --platform linux/arm64 --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --pids-limit 64 --memory 512m \
      --tmpfs /tmp:rw,noexec,nosuid,size=16m \
      -e SYNTHETIC_BROKER_MARKER=test-fixture "$image" "$mode"
  fi
done
