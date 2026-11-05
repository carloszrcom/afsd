# Migration Guide — GCD to Swift Concurrency

## Incremental Migration Strategy

Do not enable Swift 6 language mode in one step. The recommended path goes through three checking levels that progressively surface more issues:

| Level | How to enable | What it checks |
|---|---|---|
| `minimal` | `SWIFT_STRICT_CONCURRENCY = minimal` | Explicit `Sendable` annotations only |
| `targeted` | `SWIFT_STRICT_CONCURRENCY = targeted` | Sendable on function boundaries; actor isolation in most contexts |
| `complete` | `SWIFT_STRICT_CONCURRENCY = complete` | Full data race detection, equivalent to Swift 6 language mode |
| Swift 6 | `swiftLanguageVersion(.v6)` | All of `complete` + violations are errors, not warnings |

**Recommended sequence:**
1. Start at `minimal` — fix explicit annotation issues
2. Move to `targeted` — fix cross-boundary Sendable errors
3. Move to `complete` — fix remaining isolation errors
4. Switch to Swift 6 language mode

In Xcode build settings: `SWIFT_STRICT_CONCURRENCY = targeted`
In Package.swift: `.swiftSetting(.strictConcurrency(.targeted))`

---

## Common Migration Patterns

### GCD → async/await

```swift
// ❌ Before: GCD
func loadData(completion: @escaping (Data?) -> Void) {
    DispatchQueue.global().async {
        let data = fetchFromDisk()
        DispatchQueue.main.async {
            completion(data)
        }
    }
}

// ✅ After: async/await
func loadData() async -> Data? {
    await Task.detached(priority: .userInitiated) {
        fetchFromDisk()
    }.value
}
```

### DispatchGroup → TaskGroup / async let

```swift
// ❌ Before: DispatchGroup
let group = DispatchGroup()
var user: User?
var posts: [Post] = []

group.enter()
fetchUser(id: id) { result in user = result; group.leave() }
group.enter()
fetchPosts(for: id) { result in posts = result; group.leave() }
group.notify(queue: .main) { updateUI(user: user, posts: posts) }

// ✅ After: async let
async let user = fetchUser(id: id)
async let posts = fetchPosts(for: id)
let (u, p) = try await (user, posts)
updateUI(user: u, posts: p)
```

### DispatchSemaphore → actor

```swift
// ❌ Before: DispatchSemaphore for mutual exclusion
class Cache {
    private var data: [String: Any] = [:]
    private let semaphore = DispatchSemaphore(value: 1)

    func get(_ key: String) -> Any? {
        semaphore.wait()
        defer { semaphore.signal() }
        return data[key]
    }
}

// ✅ After: actor
actor Cache {
    private var data: [String: Any] = [:]
    func get(_ key: String) -> Any? { data[key] }
    func set(_ value: Any, for key: String) { data[key] = value }
}
```

### Callback-based API → Continuation

```swift
// ❌ Before: @escaping callback
func authenticate(user: String, password: String, completion: @escaping (Result<Token, Error>) -> Void) {
    authService.login(user, password) { token, error in
        if let token { completion(.success(token)) }
        else { completion(.failure(error ?? AuthError.unknown)) }
    }
}

// ✅ After: withCheckedThrowingContinuation
func authenticate(user: String, password: String) async throws -> Token {
    try await withCheckedThrowingContinuation { continuation in
        authService.login(user, password) { token, error in
            if let token { continuation.resume(returning: token) }
            else { continuation.resume(throwing: error ?? AuthError.unknown) }
        }
    }
}
```

### NotificationCenter → AsyncSequence

```swift
// ❌ Before: NotificationCenter observer
var token: NSObjectProtocol?
token = NotificationCenter.default.addObserver(
    forName: .appDidBecomeActive, object: nil, queue: .main
) { _ in
    Task { await store.refresh() }
}

// ✅ After: AsyncSequence (no token management needed)
Task {
    for await _ in NotificationCenter.default
        .notifications(named: UIApplication.didBecomeActiveNotification) {
        await store.refresh()
    }
}
```

---

## `@preconcurrency` — Suppressing Third-Party Warnings

When importing a module that has not adopted Swift 6 concurrency, its types may not conform to `Sendable`. `@preconcurrency import` suppresses these warnings without affecting your own code:

```swift
@preconcurrency import FirebaseFirestore
@preconcurrency import SomeLegacyObjCFramework
```

> `@preconcurrency import` is the right tool for third-party modules. Do not use `@unchecked Sendable` on your own types to silence errors originating from unannotated imports.

### `@preconcurrency` on protocol conformances

When conforming to a protocol from a non-concurrency-aware module:

```swift
// The protocol was defined without @MainActor awareness
@preconcurrency @MainActor
extension MyView: SomeLegacyProtocol {
    func legacyMethod() { ... }
}
```

---

## Suppression Attributes Reference

| Attribute | Use case | Risk |
|---|---|---|
| `@preconcurrency import` | Third-party module not yet on Swift 6 | Low — scoped to import |
| `nonisolated(unsafe)` | Property provably safe but unverifiable | Medium — you assert correctness |
| `@unchecked Sendable` | Class with manual synchronization | High — no compiler checking |
| `nonisolated` | Actor method that doesn't touch state | None — compiler verified |

---

## Common Compile Errors and Fixes

### "Passing argument of non-Sendable type across concurrency boundary"

```swift
// ❌ Error
class MyController { var title = "" }   // Not Sendable

Task {
    let controller = MyController()
    controller.title = await fetchTitle()   // Error: MyController not Sendable
}

// ✅ Fix option 1: make it a struct
struct MyController: Sendable { var title = "" }

// ✅ Fix option 2: make it an actor
actor MyController { var title = "" }

// ✅ Fix option 3: use within actor isolation without crossing boundary
@MainActor final class MyController { var title = "" }
```

### "Expression is 'async' but is not marked with 'await'"

You called an `async` function without `await`. Add `await`:

```swift
// ❌
let result = someAsyncFunction()

// ✅
let result = await someAsyncFunction()
```

### "Cannot call actor-isolated property from non-isolated context"

```swift
// ❌
func syncFunction() {
    let value = myActor.isolatedProperty   // Error: not in async context
}

// ✅ Option 1: make the function async
func asyncFunction() async {
    let value = await myActor.isolatedProperty
}

// ✅ Option 2: use nonisolated property if it doesn't touch mutable state
extension MyActor {
    nonisolated var safeProperty: String { constantValue }
}
```

### "Stored property 'x' of 'Sendable'-conforming class is mutable"

```swift
// ❌ — Sendable class with mutable state
final class Config: Sendable {
    var apiURL: URL = defaultURL   // Error: mutable stored property
}

// ✅ Fix: use let
final class Config: Sendable {
    let apiURL: URL

    init(apiURL: URL = defaultURL) { self.apiURL = apiURL }
}

// ✅ Fix: use actor instead
actor Config {
    var apiURL: URL = defaultURL
}
```

---

## Rules

- Migrate incrementally: `minimal` → `targeted` → `complete` → Swift 6 language mode
- Fix `complete` warnings before switching to Swift 6 — they become errors
- `@preconcurrency import` for third-party modules; `@unchecked Sendable` only for your own classes with manual synchronization
- Never suppress a concurrency error without understanding why it fired
- Replace `DispatchSemaphore` with `actor` — semaphores are fundamentally incompatible with Swift's cooperative thread pool (they block threads)
- Replace `DispatchGroup` with `async let` (fixed count) or `TaskGroup` (dynamic count)
- Replace callback-based APIs with `withCheckedThrowingContinuation`
