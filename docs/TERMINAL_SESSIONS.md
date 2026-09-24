# Persistent terminal sessions — foundation

This MAR-15 slice adds named sessions backed by `tmux` where it is installed. A persistent session is opt-in at creation; ordinary PTYs keep their existing lifecycle.

## Lifecycle

- The Host creates a random, server-owned tmux session name in a dedicated `devmoter-fast` tmux socket namespace, starts it without loading the user's personal tmux configuration, and runs the selected login shell in the registered project directory. User-visible names are metadata only and never become shell arguments.
- Closing the phone/browser WebSocket detaches the client. The tmux job continues while the DevMoter host service remains running.
- Session metadata is stored at the configured host state path with owner-only directory/file permissions and atomic replacement. It includes the project binding, cwd, expiry, and a SHA-256 hash of the session capability; it never stores the bearer value.
- A trusted device can list sessions and explicitly claim a persistent session. Claim rotates the capability and binds the session to the claiming device; requests from the former device are rejected. Device revocation closes active sockets and terminates that device's managed terminal sessions.
- Persistent session capabilities are delivered only in an HttpOnly, SameSite=Strict cookie scoped to that session path. HTTPS requests receive Secure cookies. WebSocket attachment still uses a short-lived, single-use, same-Origin ticket.
- The default absolute TTL is 12 hours. Expired sessions are killed and stale metadata is removed. The existing maximum of four live sessions applies to both persistent and ordinary PTYs.
- Explicit termination kills the tmux session, expires its cookie, and removes its persisted metadata. DevMoter shutdown detaches the tmux client instead of terminating the named job.

## Platform and operational boundaries

- Persistent mode requires `tmux` and a functioning `node-pty`. If tmux is missing, the API returns an unavailable response and ordinary PTYs remain usable. The host capability list advertises named persistence only when tmux is detected at startup.
- The expected supported environments are Linux, macOS, and a Linux environment under WSL. A native Windows shell without tmux does not advertise persistent sessions.
- Browser disconnect persistence is supported. Surviving a DevMoter service restart depends on the service supervisor preserving the tmux server. The current systemd unit uses `KillMode=control-group`, which can terminate all processes in the service cgroup during a stop/restart; this slice does not change that unit or promise restart survival. A later service-supervisor integration must define a managed, cleanup-safe tmux scope before claiming that guarantee.
- This remains a single-user host feature. A DevMoter owner credential alone is insufficient: terminal APIs also require a valid trusted-device token. Any trusted device can explicitly transfer a persistent session to itself; device identity is not separate human-user authorization.
- The device token is currently kept in script-readable browser local storage, so same-origin XSS remains a token-theft risk. Session metadata is private but includes local project paths.
- Persistent sessions created before device binding have no owner device ID and require an explicit claim before use under the device-bound policy.

## Verification boundary

Unit tests cover browser detach, server-manager reconstruction from private metadata when the tmux session remains available, capability claim/rotation, project revalidation, metadata permissions, stale/malformed state, session cap, and explicit termination. Tests using a fake tmux runner do not establish native Windows/macOS/WSL acceptance or systemd restart behavior.
