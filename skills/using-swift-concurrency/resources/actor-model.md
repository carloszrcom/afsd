# Actor Isolation Model

## What an Actor Is

An `actor` is a reference type with a built-in serial executor. All stored properties and methods are isolated to that executor by default — only one task can access them at a time. Accessing actor state from outside requires `await`.

```swift
actor ImageCache {
    private var cache: [URL: UIImage] = [:]

    // Isolated: callers outside the actor must await
    func image(for url: URL) -> UIImage? {
        cache[url]
    }

    func store(_ image: UIImage, for url: URL) {
        cache[url] = image
    }
}

// From outside:
let cached = await imageCache.image(for: url)     // ✓ await required
```

---

## `nonisolated` — Escaping the Actor's Executor

A method or computed property on an actor can be `nonisolated` if it does not touch the actor's stored state. `nonisolated` members run on the caller's executor, not the actor's.

**Use cases:**
- Protocol conformances that don't access mutable state (`Hashable`, `CustomStringConvertible`, `Identifiable`)
- Computed properties derived only from `let` constants
- Static methods

```swift
actor UserSession {
    let userID: UUID             // let — accessible nonisolated ✓
    var displayName: String      // var — isolated ✗ from nonisolated context

    // ✓ Correct: only accesses `let` property
    nonisolated var id: UUID { userID }

    // ✗ Error: accesses `var` property from nonisolated context
    // nonisolated var label: String { displayName }
}

extension UserSession: Identifiable {}   // uses nonisolated var id — compiles ✓
```

> `nonisolated` computed properties can only read `let` stored properties and call other `nonisolated` members. Accessing any `var` property from `nonisolated` context is a compile error.

---

## `isolated` Parameters — Parameterized Isolation

A function can accept an actor instance as an `isolated` parameter. The function then runs on that actor's executor, with direct (non-`await`) access to its state.

```swift
// Runs on whichever actor is passed — no await needed inside
func resetSession(_ session: isolated UserSession) {
    session.displayName = "Guest"    // direct access, no await ✓
}

// Call site:
await resetSession(mySession)        // await because we hop to the actor
```

This is the mechanism behind the `isolation: isolated (any Actor)? = #isolation` parameter pattern used throughout Swift 6.2 stdlib APIs.

---

## `#isolation` — Capturing Caller Context

`#isolation` is a compiler macro that captures the actor isolation of the call site at compile time. Use it when writing utility functions that need to resume or deliver results on the same actor as the caller.

```swift
// The isolation parameter defaults to the caller's actor context
func fetchUser(
    id: UUID,
    isolation: isolated (any Actor)? = #isolation
) async throws -> User {
    let dto = try await networkClient.fetch(id)
    return User(dto: dto)
    // Result is delivered on the caller's actor automatically
}

// Called from @MainActor context: result delivered on main actor
// Called from a background actor: result delivered there
@MainActor func loadProfile() async throws {
    let user = try await fetchUser(id: currentUserID)
    // No actor hop needed — already on MainActor
    self.user = user
}
```

> Add `isolation: isolated (any Actor)? = #isolation` to any async function in a library or utility layer that callers invoke from various actor contexts. It eliminates unnecessary actor hops and is now the recommended pattern in Apple's own documentation.

---

## `assumeIsolated` — Synchronous Callbacks

Delegate callbacks from UIKit, AppKit, or any legacy Objective-C framework often arrive on the main thread but are not annotated with `@MainActor`. Use `MainActor.assumeIsolated` to access `@MainActor`-isolated state synchronously from these callbacks.

```swift
// CLLocationManagerDelegate — arrives on main thread, but not annotated
final class LocationDelegate: NSObject, CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager,
                         didUpdateLocations locations: [CLLocation]) {
        // We know this is called on main thread — assert it
        MainActor.assumeIsolated {
            // Can now access @MainActor state synchronously
            AppState.shared.lastLocation = locations.last
        }
    }
}
```

**On actors:**

```swift
actor DataProcessor {
    var pendingCount = 0

    // Synchronous callback from a C library — known to be on this actor's thread
    func handleCallback() {
        self.assumeIsolated { isolated in
            isolated.pendingCount -= 1
        }
    }
}
```

> `assumeIsolated` crashes at runtime if the current thread is NOT on the expected actor's executor. Use it only when you have an external guarantee (documentation, contract, test coverage) that the callback arrives on the correct thread.

**Lighter-weight assertions (debug only):**

```swift
MainActor.assertIsolated("Expected to be called on main actor")
MainActor.preconditionIsolated("Expected to be called on main actor")
```

---

## Actor Reentrancy — The Most Common Correctness Bug

When an actor `await`s an operation, it suspends and **other tasks can run on that actor** before the `await` resumes. Invariants that held before the suspension point may not hold after.

```swift
actor BankAccount {
    var balance: Double = 1000

    func withdraw(_ amount: Double) async throws {
        // Check invariant BEFORE suspension
        guard balance >= amount else { throw BankError.insufficientFunds }

        // ⚠️ Suspension point — another task may call withdraw() here
        try await processTransaction(amount)

        // balance may have changed since the guard above!
        balance -= amount   // Potential overdraft
    }
}
```

**Fix:** Re-check the invariant after every suspension point, or model the state machine so the invariant holds regardless of interleaving:

```swift
func withdraw(_ amount: Double) async throws {
    // Reserve the funds atomically before suspending
    guard balance >= amount else { throw BankError.insufficientFunds }
    balance -= amount          // Update state before any await

    do {
        try await processTransaction(amount)
    } catch {
        balance += amount      // Rollback on failure
        throw error
    }
}
```

> Rule: treat every `await` in an actor method as a point where the world may have changed. Re-validate state after every suspension, or move state mutations to before the first `await`.

---

## Actor `init` — `nonisolated` by Default

In Swift 6, actor `init` methods are `nonisolated` by default. This means any non-`Sendable` value you capture during `init` must be fully initialized before being handed off to the actor's storage.

```swift
actor DataManager {
    var delegate: DataDelegate?   // DataDelegate is not Sendable

    // ✗ Error in Swift 6: delegate is non-Sendable, crossing into isolated storage
    init(delegate: DataDelegate) {
        self.delegate = delegate
    }
}

// Fix: make DataDelegate Sendable, or use a class/actor for the delegate
```

---

## `GlobalActor` — Subsystem-Level Isolation

When multiple types must share the same isolation domain (not just one actor instance), define a `@globalActor`:

```swift
// DatabaseActor.swift
@globalActor
actor DatabaseActor {
    static let shared = DatabaseActor()
}

// Types isolated to DatabaseActor — all share the same serial executor
@DatabaseActor
final class UserRepository {
    func fetchAll() -> [User] { ... }
}

@DatabaseActor
final class ArticleRepository {
    func fetchRecent() -> [Article] { ... }
}

// Cross-actor call
@MainActor
func loadData() async {
    let users = await UserRepository().fetchAll()     // hops to DatabaseActor
    let articles = await ArticleRepository().fetchRecent()
}
```

> `@MainActor` is itself a `@globalActor`. Use custom global actors to isolate subsystems like database access, audio processing, or network I/O to a single serial executor without coordinating actor instances manually.

---

## Rules

- All actor `var` properties require `await` from outside — no exceptions
- `nonisolated` methods can only read `let` properties and call other `nonisolated` members
- Add `isolation: isolated (any Actor)? = #isolation` to library async functions that deliver results to callers
- `assumeIsolated` requires an external guarantee that the current thread IS on the actor — it crashes otherwise
- After every `await` in an actor method, treat all state as potentially changed (reentrancy)
- Prefer modifying state before the first `await` or implement explicit rollback logic
- Use `@globalActor` when multiple types must share one isolation domain
- Actor `init` is `nonisolated` in Swift 6 — non-`Sendable` captured values require careful handling
