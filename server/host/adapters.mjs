import { DevMoterHost, HOST_CAPABILITY_IDS } from "./protocol.mjs";

function unavailableCapabilities(reason) {
  return Object.fromEntries(HOST_CAPABILITY_IDS.map(id => [id, {
    state: "unavailable",
    reason,
    features: []
  }]));
}

export class LinuxHost extends DevMoterHost {
  constructor(options = {}) {
    super({ ...options, platform: "linux", runtime: "native" });
  }
}

export class WindowsWSLHost extends DevMoterHost {
  constructor({ connected = false, capabilities, ...options } = {}) {
    super({
      ...options,
      platform: "windows",
      runtime: connected ? "wsl" : "wsl_disconnected",
      capabilities: connected
        ? (capabilities || {})
        : unavailableCapabilities("wsl_engine_not_connected")
    });
  }
}

export class MacOSHost extends DevMoterHost {
  constructor(options = {}) {
    super({
      ...options,
      platform: "macos",
      runtime: "native",
      capabilities: unavailableCapabilities("macos_adapter_not_implemented")
    });
  }
}

export class UnknownHost extends DevMoterHost {
  constructor(options = {}) {
    super({
      ...options,
      platform: "unknown",
      runtime: "unknown",
      capabilities: unavailableCapabilities("host_adapter_not_implemented")
    });
  }
}

export function createHostAdapter({
  platform = process.platform,
  architecture = process.arch,
  env = process.env,
  capabilities = {}
} = {}) {
  const common = { id: "local", architecture };
  if (platform === "linux") {
    if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
      return new WindowsWSLHost({
        ...common,
        connected: true,
        capabilities: {
          ...capabilities,
          terminal: capabilities.terminal || { state: "unavailable", reason: "wsl_terminal_not_implemented" }
        }
      });
    }
    return new LinuxHost({ ...common, capabilities });
  }
  if (platform === "darwin") return new MacOSHost(common);
  if (platform === "win32") return new WindowsWSLHost(common);
  return new UnknownHost(common);
}
