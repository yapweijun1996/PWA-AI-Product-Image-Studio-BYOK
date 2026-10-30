#!/bin/sh
# Synthetic only. No repository mount, provider credentials, or external network.
set -eu
cd "$(dirname "$0")"
id="$(date +%s)-$$"
image="pwa-pi-peercred:$id"
volume="pwa-pi-peercred-$id"
server="pwa-pi-peercred-server-$id"
cleanup() {
  docker rm -f "$server" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
docker build --platform linux/arm64 --tag "$image" .
docker volume create "$volume" >/dev/null
# World-writable only to expose the same-UID limitation in this disposable probe.
docker run --rm --network none --user 0:0 --mount "type=volume,src=$volume,dst=/ipc" --entrypoint /bin/sh "$image" -c 'chmod 1777 /ipc'
docker run -d --name "$server" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --user 1001:1001 --mount "type=volume,src=$volume,dst=/ipc" "$image" server >/dev/null
ready=false
for n in 1 2 3 4 5 6 7 8 9 10; do
  if docker logs "$server" 2>&1 | grep -q '^READY$'; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker logs "$server"; exit 1; fi
for pair in '1002 allowed' '1003 denied' '1002 allowed'; do
  set -- $pair
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --user "$1:$1" --mount "type=volume,src=$volume,dst=/ipc" "$image" client "$2"
done
status=$(docker wait "$server")
docker logs "$server"
[ "$status" = 0 ]
