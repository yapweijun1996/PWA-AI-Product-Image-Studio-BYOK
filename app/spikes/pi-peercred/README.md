# Pi IPC peer identity feasibility probe

This opt-in Linux ARM64 experiment is synthetic and **not a production broker or isolation boundary**. It mounts only a fresh disposable Docker volume into three short-lived clients and a server; no project files, user data, keys or provider endpoints are used. The build downloads public Alpine packages. Docker build-cache layers may remain after cleanup.

Run from the repository root with `sh app/spikes/pi-peercred/run.sh`. The probe reads Linux `SO_PEERCRED` at the server, permits UID 1002 and rejects UID 1003. Two independent clients running as UID 1002 are both accepted, demonstrating that a UID cannot distinguish individual runs or principals sharing that identity. The temporary socket directory is deliberately world-writable for the experiment and is unsuitable for production.

This does not authenticate the server to clients, bind a run or browser principal, test capabilities, isolate a real Pi process or provider secret, or address namespace remapping, inherited descriptors, process compromise, revocation, replay, concurrency and crash recovery. See [the candidate boundary](../../../docs/02-architecture/PI_TEXT_BOUNDARY.md). Do not reuse this program or its permissions as production security.
