# Logging with OSLog

## Setup — One Logger per Category

Use the `Logger` struct (not the old `os_log` function). Define all loggers in one place — a `Logger` is a value type (`Sendable`), safe to use from any concurrency context.

```swift
// Core/Logging/AppLogger.swift
import os

public enum AppLogger {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "com.company.app"

    public static let network     = Logger(subsystem: subsystem, category: "network")
    public static let persistence = Logger(subsystem: subsystem, category: "persistence")
    public static let auth        = Logger(subsystem: subsystem, category: "auth")
    public static let repository  = Logger(subsystem: subsystem, category: "repository")
    public static let ui          = Logger(subsystem: subsystem, category: "ui")
    public static let lifecycle   = Logger(subsystem: subsystem, category: "lifecycle")
    public static let imageCache  = Logger(subsystem: subsystem, category: "imageCache")
}
```

---

## Log Level Decision Matrix

Apple's unified logging system has these levels, in order of severity:

| Level | Persisted to disk | When to use |
|---|---|---|
| `.debug` | No (memory only) | Verbose path tracing during development — never ships |
| `.info` | Only with `log` tool | Helpful context, not critical for diagnosing issues |
| `.notice` (default) | Yes, up to limit | Key milestones: request sent, response received |
| `.warning` | Yes, up to limit | Unexpected but recoverable — retried, fallback used |
| `.error` | Yes, up to limit | Operation failed, user is affected |
| `.fault` | Yes, until limit | Programming error — violated invariant, impossible state |

```swift
// Examples of correct level selection:
AppLogger.network.debug("Building request: \(endpoint.path, privacy: .public)")
AppLogger.network.info("Cache hit for \(url.lastPathComponent, privacy: .public)")
AppLogger.network.notice("Fetch started: \(endpoint.path, privacy: .public)")
AppLogger.network.warning("Retry #\(retryCount) for \(endpoint.path, privacy: .public)")
AppLogger.network.error("Request failed: \(error.localizedDescription, privacy: .public)")
AppLogger.network.fault("Unexpected nil URLResponse — this should never happen")
```

---

## Privacy Annotations

The unified logging system **redacts dynamic string values by default** in non-development builds. You must explicitly opt-in to make a value visible.

```swift
// ✗ Redacted in release — shows "<private>"
logger.debug("User email: \(user.email)")

// ✓ Visible in all builds — safe for paths and status codes
logger.notice("Endpoint: \(endpoint.path, privacy: .public)")
logger.error("Status: \(httpResponse.statusCode, privacy: .public)")

// ✓ Consistent hash — correlate logs without exposing the value
logger.info("User: \(userID, privacy: .private(mask: .hash))")

// ✓ Numeric types are public by default — no annotation needed
logger.debug("Response size: \(data.count) bytes")
logger.debug("Cache count: \(cache.countLimit)")
```

**Rules:**
- User PII (email, name, address): never `.public`
- Auth tokens, passwords, keys: never `.public` — they are private by default but add a comment
- Endpoint paths, HTTP status codes, file names: `.public`
- Internal IDs used for correlation: `.private(mask: .hash)`

```swift
// ✗ NEVER do this — token visible in logs
logger.debug("Token: \(authToken, privacy: .public)")

// ✓ Token stays private (default), correlation hash for IDs
logger.info("Authenticated user: \(userID, privacy: .private(mask: .hash))")
```

---

## Signposts — Performance Measurement with Instruments

`OSSignposter` marks time intervals in the unified log. Instruments' os_signposts timeline shows these intervals visually, making it easy to identify bottlenecks without adding custom timing code.

```swift
// Core/Networking/LiveNetworkClient.swift
import os

public final class LiveNetworkClient: NetworkClientProtocol {
    private let signposter = OSSignposter(logger: AppLogger.network)

    public func fetch<T: Decodable & Sendable>(
        _ endpoint: some APIEndpoint
    ) async throws(AppError) -> T {
        // makeSignpostID() generates a unique ID per concurrent request
        // so overlapping intervals for the same endpoint are distinguishable
        let id = signposter.makeSignpostID()
        let state = signposter.beginInterval(
            "fetch", id: id,
            "\(endpoint.method.rawValue, privacy: .public) \(endpoint.path, privacy: .public)"
        )
        defer { signposter.endInterval("fetch", state) }

        // ... execute request ...
    }
}

// Repository — mark decode and persistence phases separately
actor ArticleRepositoryImpl: ArticleRepository {
    private let signposter = OSSignposter(logger: AppLogger.repository)

    func fetchAll() async throws(AppError) -> [Article] {
        let id = signposter.makeSignpostID()
        let state = signposter.beginInterval("fetchAll", id: id)

        let dtos: [ArticleDTO] = try await networkClient.fetch(ArticlesEndpoint.list(page: 1, limit: 20))
        signposter.emitEvent("decode complete", id: id)

        let articles = dtos.map(ArticleMapper.domain)
        signposter.emitEvent("mapping complete", id: id)

        signposter.endInterval("fetchAll", state)
        return articles
    }
}
```

### Reading signposts in Instruments

1. Open **Instruments** → **os_signposts** instrument
2. Filter by subsystem (`Bundle.main.bundleIdentifier`)
3. Intervals appear as coloured spans on the timeline — overlapping spans for the same category name are disambiguated by `signpostID`

---

## App Lifecycle Logging

Log key lifecycle events at `.notice` — they persist to disk and are available in crash reports via `log collect`:

```swift
// App/MyApp.swift
@main
struct MyApp: App {
    init() {
        AppLogger.lifecycle.notice("App init — version \(AppVersion.current, privacy: .public)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    AppLogger.lifecycle.notice("Root view appeared")
                }
        }
    }
}
```

---

## Viewing Logs

**During development (Xcode):**
- Console pane in Xcode shows all log levels including `.debug`
- Filter by subsystem: `Bundle.main.bundleIdentifier`
- Filter by category: `network`, `persistence`, etc.

**In Console.app:**
- `.debug` is NOT shown unless "Include Debug Messages" is enabled
- Filter: subsystem = `com.company.app`

**On device / TestFlight:**
```bash
# Collect logs from a connected device
xcrun devicectl device info files --device <device-id>

# Stream logs
log stream --predicate 'subsystem == "com.company.app"' --level debug

# Collect from device
log collect --device --start "2025-01-01 00:00:00" --output app.logarchive
```

---

## Rules

- One `Logger` per architectural category — never create ad-hoc loggers inline
- `.debug` is for development only — always verbose, never persisted
- `.error` and `.fault` must always be persisted — use them for conditions that affect the user
- PII and credentials must never use `.public` — the default is private; add a comment to make intent clear
- `OSSignposter` for any operation you'd want to see in Instruments — network, disk, image decode
- Use `makeSignpostID()` per concurrent operation — avoids interval collisions in async code
- The subsystem must be the app's bundle identifier — this is what `log collect` and crash reports filter on
