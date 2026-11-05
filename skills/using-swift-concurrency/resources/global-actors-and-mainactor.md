# Global Actors & @MainActor

## What Is a Global Actor?

A global actor is a shared, singleton actor that acts as an isolation domain for types and functions across a module. Any number of types can be annotated with the same global actor, and they all share that actor's serial executor.

`@MainActor` is the most important global actor — it isolates all UI-related work to the main thread.

---

## Defining a Custom Global Actor

```swift
// DatabaseActor.swift
@globalActor
actor DatabaseActor {
    static let shared = DatabaseActor()
}
```

The `@globalActor` attribute requires a `static let shared` property returning an instance of the actor type. This instance is the shared executor for all `@DatabaseActor`-annotated code.

```swift
@DatabaseActor
final class UserRepository {
    private var cache: [UUID: User] = [:]

    func fetchAll() async -> [User] {
        // Runs on DatabaseActor's serial executor
        if cache.isEmpty {
            cache = await loadFromStore()
        }
        return Array(cache.values)
    }
}

@DatabaseActor
final class ArticleRepository {
    func fetchRecent(limit: Int) async -> [Article] { ... }
}

// Cross-actor call — hops to DatabaseActor
@MainActor
func loadData() async {
    let users = await UserRepository().fetchAll()      // hops to DatabaseActor
    await updateUI(with: users)                        // returns to MainActor
}
```

> Use custom global actors to isolate a subsystem (database, audio, networking) without distributing actor instances throughout the codebase.

---

## `@MainActor` — Nuances

### `@MainActor` on a type

All stored properties and methods are isolated to the main thread. This is the standard pattern for SwiftUI `@Observable` stores.

```swift
@MainActor
@Observable
final class ArticleStore {
    var articles: [Article] = []
    var isLoading = false

    func load() async {
        isLoading = true
        articles = (try? await repository.fetchAll()) ?? []
        isLoading = false
    }
}
```

### `MainActor.run { }` — Dispatching from non-isolated context

Use `MainActor.run` to execute a closure on the main actor from a context that is not `@MainActor`. Prefer this over `await MainActor.run` from `@MainActor` context (it's a no-op hop there).

```swift
// From a background actor or nonisolated context:
Task.detached {
    let result = await heavyComputation()
    await MainActor.run {
        store.result = result    // Now on main actor
    }
}
```

### `Task { }` inherits actor context — the common pitfall

A `Task { }` created inside a `@MainActor` context runs **on the main actor**. It does not automatically move to a background thread.

```swift
@MainActor
func onButtonTap() {
    Task {
        // ⚠️ Still on main actor — blocks UI if work is heavy
        let data = expensiveTransformation(rawData)
        self.result = data
    }
}
```

**Fix:** Use `Task.detached` or an explicit actor hop for CPU-intensive work:

```swift
@MainActor
func onButtonTap() {
    Task.detached(priority: .userInitiated) {
        // Now on background thread pool
        let data = expensiveTransformation(rawData)
        await MainActor.run {
            self.result = data
        }
    }
}
```

### `nonisolated` on `@MainActor` types

Methods on a `@MainActor` type that don't access main-actor state can be `nonisolated`:

```swift
@MainActor
final class Router {
    var path = NavigationPath()

    // Doesn't access any main-actor state — can be nonisolated
    nonisolated func makeDeepLinkURL(destination: Destination) -> URL {
        // Pure computation — no actor hop needed at call site
        URL(string: "myapp://\(destination.rawValue)")!
    }
}
```

---

## `MainActor.assumeIsolated` — Synchronous Bridging

See actor-model.md for the full pattern. The short version: use this for UIKit/AppKit delegate callbacks that arrive on the main thread but are not annotated:

```swift
func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    MainActor.assumeIsolated {
        viewModel.selectItem(at: indexPath.row)
    }
}
```

---

## `Clock` API — Modern `Task.sleep`

`Task.sleep(nanoseconds:)` is deprecated-adjacent. Use the `Clock`-based API:

```swift
// Default — uses ContinuousClock
try await Task.sleep(for: .seconds(3))
try await Task.sleep(for: .milliseconds(500))
try await Task.sleep(until: .now + .seconds(10))
```

### `ContinuousClock` vs. `SuspendingClock`

| Clock | Behavior while device sleeps |
|---|---|
| `ContinuousClock` (default) | Keeps incrementing — use for timeouts |
| `SuspendingClock` | Pauses — use for real-world time delays |

```swift
// Timeout: device sleep should not extend the deadline
try await Task.sleep(for: .seconds(30), clock: .continuous)

// Delay until tomorrow morning: device sleep should count
try await Task.sleep(for: .hours(8), clock: .suspending)
```

### Testable clock injection

The `Clock` protocol is testable. Inject a clock into types that need time-based behavior:

```swift
final class RetryPolicy<C: Clock> where C.Duration == Duration {
    let clock: C
    let maxAttempts: Int

    init(clock: C = ContinuousClock(), maxAttempts: Int = 3) {
        self.clock = clock
        self.maxAttempts = maxAttempts
    }

    func execute<T>(_ operation: () async throws -> T) async throws -> T {
        for attempt in 1...maxAttempts {
            do {
                return try await operation()
            } catch {
                if attempt < maxAttempts {
                    try await Task.sleep(
                        for: .seconds(pow(2.0, Double(attempt))),
                        clock: clock
                    )
                } else {
                    throw error
                }
            }
        }
        fatalError("unreachable")
    }
}

// In tests: inject ManualClock to control time without real delays
```

---

## `defaultIsolation(MainActor.self)` — Swift 6.2 Package Setting

New in Swift 6.2 / PackageDescription 6.2. Makes all unannotated declarations in a target implicitly `@MainActor`. Useful for SwiftUI app targets where nearly everything runs on the main actor.

```swift
// Package.swift
.target(
    name: "MyApp",
    swiftSettings: [
        .swiftLanguageVersion(.v6),
        .defaultIsolation(MainActor.self)
    ]
)
```

Types that need background execution opt out explicitly:

```swift
// This file is in the MyApp target with defaultIsolation(MainActor.self)

// Automatically @MainActor — no annotation needed
final class HomeStore { ... }

// Opt out — needs to run on background thread
nonisolated final class JSONParser { ... }

// Custom isolation
@DatabaseActor
final class UserRepository { ... }
```

> `defaultIsolation(MainActor.self)` is a strong choice for UI-heavy app targets. Avoid it in framework/library targets where callers control isolation.

---

## Rules

- `@globalActor` requires `static let shared` on the actor type — this is the shared executor
- Use custom global actors for subsystem isolation (database, audio) rather than passing actor instances around
- `Task { }` inherits caller's actor — use `Task.detached` for work that must NOT run on the main actor
- `MainActor.assumeIsolated` requires an external guarantee of main-thread execution — it crashes otherwise
- Use `ContinuousClock` for timeouts; `SuspendingClock` for real-world time delays
- Inject `Clock` protocol into types that sleep or retry — enables deterministic testing
- `defaultIsolation(MainActor.self)` is appropriate for SwiftUI app targets; avoid in libraries
