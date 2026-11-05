---
name: building-core-layer
description: Builds the Core layer of a professional iOS/macOS app — NetworkClient, AppError with typed throws, OSLog logging, dependency injection via the SwiftUI Environment (@Entry or manual EnvironmentKey), and App.swift composition root. Use when setting up a new app, adding networking, designing error handling, or wiring dependencies.
---

# Building the Core Layer

## Context
- iOS 26+ / macOS 26+, Swift 6.2, strict concurrency
- Projects may set `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` — unannotated code runs on the main actor; move blocking work to actors or `nonisolated` code
- No singletons — all dependencies injected from a single composition root
- `throws(AppError)` typed throws throughout — no `any Error` boxing

## Architecture Layers

Full code with rules and decisions for each area:

- **NetworkClient — URLSession, APIEndpoint, TokenProvider** → [resources/network-client.md](resources/network-client.md)
- **AppError — typed throws hierarchy, LocalizedError, propagation** → [resources/app-error.md](resources/app-error.md)
- **Logging — OSLog, privacy annotations, signposts** → [resources/logging.md](resources/logging.md)
- **Dependency Injection — @Entry / manual EnvironmentKey, composition root, mocks** → [resources/dependency-injection.md](resources/dependency-injection.md)
- **App setup, file structure, testing helpers** → [resources/app-setup.md](resources/app-setup.md)

---

## Absolute Rules

### Never:
- Singletons for dependencies (`NetworkClient.shared`, `Repository.shared`) — use environment keys + composition root
- `throws` (untyped) at internal boundaries — use `throws(AppError)`
- `any Error` in catch blocks at the Store layer — typed throws delivers `AppError` directly
- PII, tokens, or passwords with `.public` log privacy — they are private by default
- Instantiate concrete types outside `App.init` — the composition root is the only factory
- `@MainActor` on `NetworkClient` — network I/O must not touch the main thread. Exception: repositories that wrap SwiftData's `ModelContext.mainContext` are `@MainActor` by design (see the project's CLAUDE.md)
- `fatalError` in `ModelContainer` creation without first logging at `.fault` and attempting recovery

### Always:
- `NetworkClientProtocol: Sendable` — enables actor-safe injection and mock substitution
- `throws(AppError)` on every `async` function from Repository through Store
- One `Logger` per architectural category, all sharing the app's bundle ID as subsystem
- `OSSignposter` with `makeSignpostID()` in `LiveNetworkClient` and repositories
- Environment keys for protocol dependencies (`@Entry`, or the project's manual `EnvironmentKey` pattern — follow its CLAUDE.md); `.environment(store)` for `@Observable` stores
- `URLCache.shared` configured before first view renders (`App.init`)
- In-memory `ModelContainer` per test suite — never share across tests

---

## Dependency Graph

```
App.init (composition root)
 ├── LiveTokenProvider (actor)
 ├── RequestBuilder
 ├── LiveNetworkClient ────────────────────────────┐
 │    └── URLSession.makeProduction()              │
 ├── Live*Repository (@ModelActor) ────────────────┤
 │    └── ModelContainer.mainContext               │
 └── *Store (@Observable @MainActor) ──────────────┘
      └── protocol dependency (injected via init)

Environment
 ├── .environment(articleStore)      ← @Observable
 ├── .environment(authStore)
 ├── .environment(\.networkClient)   ← @Entry protocol
 └── .environment(\.tokenProvider)
```

---

## Core Patterns

### NetworkClient fetch

```swift
// Generic, typed throws, Sendable result
public protocol NetworkClientProtocol: Sendable {
    func fetch<T: Decodable & Sendable>(
        _ endpoint: some APIEndpoint
    ) async throws(AppError) -> T
}

// Usage in a repository:
let dtos: [ArticleDTO] = try await networkClient.fetch(
    ArticlesEndpoint.list(page: 1, limit: 20)
)
```

### Typed throws propagation

```swift
// Repository
func fetchAll() async throws(AppError) -> [Article] {
    let dtos: [ArticleDTO] = try await networkClient.fetch(ArticlesEndpoint.list(page: 1, limit: 20))
    return dtos.map(ArticleMapper.domain)
}

// Store — no cast, error is already AppError
func load() async {
    do {
        articles = try await repository.fetchAll()
    } catch {
        appError = error   // error: AppError — typed throws
    }
}

// View — error modifier, no coupling to concrete types
.appErrorAlert(error: $store.appError, retryAction: store.load)
```

### Logger usage

```swift
// Definition (one time)
AppLogger.network.notice("Fetch started: \(endpoint.path, privacy: .public)")
AppLogger.network.error("Failed: \(error.localizedDescription, privacy: .public)")

// Signpost (per concurrent operation)
let id = signposter.makeSignpostID()
let state = signposter.beginInterval("fetch", id: id, "\(endpoint.path, privacy: .public)")
defer { signposter.endInterval("fetch", state) }
```

### @Entry DI

```swift
// Definition
extension EnvironmentValues {
    @Entry var articleRepository: any ArticleRepository = PlaceholderArticleRepository()
}

// Injection at root
.environment(\.articleRepository, liveArticleRepository)

// Consumption
@Environment(\.articleRepository) private var repository
```

### TokenProvider — refresh coalescing

```swift
public actor LiveTokenProvider: TokenProviderProtocol {
    private var refreshTask: Task<Void, any Error>?

    public func refreshToken() async throws(AppError) {
        if let existing = refreshTask {
            try? await existing.value   // Wait for in-flight refresh
            return
        }
        // ... single refresh call
    }
}
```

---

## Error Hierarchy at a Glance

```
AppError
 ├── .network(NetworkError)
 │    ├── .urlError(URLError)     — no connectivity, timeout
 │    ├── .notFound(String)       — 404
 │    ├── .rateLimited            — 429
 │    ├── .serverError(Int)       — 5xx
 │    └── .decodingFailed(Error)  — JSON mismatch
 ├── .auth(AuthError)
 │    ├── .sessionExpired         — 401 after retry
 │    └── .forbidden              — 403
 ├── .persistence(PersistenceError)
 │    └── .saveFailed / .fetchFailed / .migrationFailed
 └── .validation(ValidationError)
      └── .required / .tooShort / .invalidFormat / ...
```

---

## Log Level Summary

| Level | Persisted | Use for |
|---|---|---|
| `.debug` | No | Development verbose tracing |
| `.info` | Log tool only | Cache hits, non-critical flow |
| `.notice` | Yes | Key milestones (request sent, response received) |
| `.warning` | Yes | Retries, fallbacks |
| `.error` | Yes | User-affecting failures |
| `.fault` | Yes | Invariant violations, impossible states |

---

## Implementation Checklist

### Network:
- [ ] `NetworkClientProtocol: Sendable` defined
- [ ] `APIEndpoint` protocol with default extensions
- [ ] `HTTPMethod` as `RawRepresentable` struct
- [ ] `RequestBuilder` separate from `LiveNetworkClient`
- [ ] `LiveNetworkClient` marked `@unchecked Sendable`; `decoder` marked `nonisolated(unsafe)`
- [ ] 401 handled linearly — `send()` returns `(Data, 401)`, retry via second `send()` call (no recursion)
- [ ] `send()` and `decode()` extracted as private methods
- [ ] `URLSession.makeProduction()` with `waitsForConnectivity = true`
- [ ] `LiveTokenProvider` as `actor` with refresh coalescing

### Errors:
- [ ] `AppError` enum with `NetworkError`, `AuthError`, `PersistenceError`, `ValidationError`
- [ ] `LocalizedError` in separate extension file
- [ ] `throws(AppError)` at every repository and network method
- [ ] `View+AppErrorAlert.swift` modifier — views use it, never switch on error cases directly

### Logging:
- [ ] `AppLogger` enum with one `Logger` per category
- [ ] `OSSignposter` with `makeSignpostID()` in `LiveNetworkClient`
- [ ] PII and tokens never marked `.public`
- [ ] `.fault` used for `ModelContainer` creation failure before `fatalError`

### DI:
- [ ] Environment keys for all protocol dependencies (`@Entry` or manual `EnvironmentKey`, per project convention)
- [ ] Placeholder implementations as `@Entry` defaults
- [ ] All `Live*` types instantiated only in `App.init`
- [ ] Stores as `@State` on `App` (not singletons)
- [ ] Mock implementations for every protocol (used in previews and tests)

### App Setup:
- [ ] `URLCache.shared` configured in `App.init`
- [ ] `ModelContainer` factory with `.fault` log + in-memory fallback before `fatalError`
- [ ] `AppEnvironment` enum for dev/staging/production base URLs
- [ ] In-memory `ModelContainer` helper for test suites
