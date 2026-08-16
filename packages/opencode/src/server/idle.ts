// Process-global activity tracking for `serve --idle-timeout`. Stamped by the
// global request middleware, the GlobalBus subscription, and connection
// disposers; read only by the idle watcher in the serve command.
let lastActivity = Date.now()
let openConnections = 0

export function stamp() {
  lastActivity = Date.now()
}

// Long-lived connections (SSE streams, PTY websockets) count as activity for
// their whole lifetime; the returned disposer also stamps so a just-closed
// connection leaves the clock fresh.
export function trackOpen() {
  openConnections++
  return () => {
    openConnections--
    stamp()
  }
}

export function shouldIdle(now: number, idleTimeout: number) {
  return idleTimeout > 0 && openConnections === 0 && now - lastActivity >= idleTimeout
}

export * as ServerIdle from "./idle"
