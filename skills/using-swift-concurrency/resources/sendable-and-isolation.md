# Sendable & Isolation Boundaries

## Why Sendable Matters

In Swift 6 strict concurrency mode, the compiler checks that every value crossing an actor boundary (or task boundary) is safe to use from multiple concurrent contexts. A type is safe to share if it is `Sendable`. Getting this wrong used to be a runtime data race; in Swift 6 it is a compile error.

---

## The Full Sendable Taxonomy

### 1. Implicit conformance — value types

Structs and enums whose stored properties are all `Sendable` get conformance automatically. No annotation needed.

```swift
struct User: Sendable {          // All stored properties are Sendable
    let id: UUID                 // UUID: Sendable ✓
    let name: String             // String: Sendable ✓
    var score: Int               // Int: Sendable ✓
}
```

> Enums with associated values follow the same rule — all associated values must be `Sendable`.

---

### 2. `@unchecked Sendable` — classes with manual safety

When you own a class and protect its state with a lock or other synchronization mechanism that the compiler cannot see, use `@unchecked Sendable`. **You** are asserting correctness; the compiler trusts you.

```swift
// A lock-protected mutable class — you guarantee no concurrent access to value
final class AtomicBox<T: Sendable>: @unchecked Sendable {
    private var value: T
    private let lock = NSLock()

    init(_ value: T) { self.value = value }

    func read() -> T { lock.withLock { value } }
    func write(_ newValue: T) { lock.withLock { value = newValue } }
}
```

> Prefer `actor` over `@unchecked Sendable` for new code. Use `@unchecked Sendable` only when wrapping legacy synchronization primitives or ObjC types.

---

### 3. `nonisolated(unsafe)` — opt-out for specific stored properties

When a class has one property that you know is safe to access from any context (e.g., it is write-once or externally synchronized), but the compiler rejects it, use `nonisolated(unsafe)`:

```swift
final class SDKWrapper: NSObject, Sendable {
    // Written once in init; immutable after that — safe to share
    nonisolated(unsafe) let handle: OpaquePointer

    init() {
        handle = sdk_create_handle()
    }
}
```

> `nonisolated(unsafe)` silences Sendable checking for that property. Do not use it to suppress errors you haven't reasoned about.

---

### 4. `@Sendable` closures — functions crossing boundaries

A closure type and a function type that is `Sendable` is spelled `@Sendable`:

```swift
// The closure passed to Task.init must be @Sendable
func scheduleWork(_ work: @Sendable @escaping () async -> Void) {
    Task { await work() }
}

// Common source of errors: capturing a non-Sendable type in a @Sendable closure
class NotSendable { var x = 0 }

let obj = NotSendable()
Task {
    obj.x += 1          // ✗ Error: capture of non-Sendable type in @Sendable closure
}
```

`@Sendable` is a requirement on the closure itself, not on the types it captures. All captured values must be `Sendable` (or be captured by value with no shared mutable state).

---

### 5. `sending` parameters and return values — transferring ownership

`sending` is a Swift 6 parameter and return-type modifier that allows transferring a non-`Sendable` value across isolation boundaries, provided the compiler can prove that no other reference to that value exists at the point of transfer.

```swift
// The compiler proves that `image` is not accessible from the caller
// after it is passed — so it can cross the actor boundary safely.
func process(sending image: UIImage) async -> ProcessedImage {
    // UIImage is not Sendable, but we own it exclusively here
    return await imageProcessor.process(image)
}
```

You will see `sending` in stdlib APIs:

```swift
// withCheckedContinuation returns `sending T` — allows returning non-Sendable results
func withCheckedContinuation<T>(
    isolation: isolated (any Actor)? = #isolation,
    function: String = #function,
    _ body: (CheckedContinuation<T, Never>) -> Void
) async -> sending T
```

> `sending` eliminates many false-positive "value of non-Sendable type" errors in Swift 6. You do not need to annotate most return values yourself — the compiler infers it. You will see it in function signatures when reading stdlib and framework documentation.

---

## Isolation Boundaries — Where Sendable Is Checked

A value must be `Sendable` (or use `sending`) whenever it crosses one of these boundaries:

| Boundary | Example |
|---|---|
| Actor method call from outside the actor | `await myActor.update(value)` |
| Task creation | `Task { use(value) }` |
| `Task.detached` creation | `Task.detached { use(value) }` |
| `withTaskGroup addTask` | `group.addTask { use(value) }` |
| `@Sendable` closure capture | `scheduleWork { use(value) }` |

---

## Common Patterns

### Making a DTO safe to send from background to main actor

```swift
// Network layer runs on a background context
// UI layer runs on @MainActor
// DTO must be Sendable to cross the boundary

struct ArticleDTO: Sendable, Codable {
    let id: String
    let title: String
    let publishedAt: Date
}

@MainActor
final class ArticleStore {
    var articles: [ArticleDTO] = []

    func load() async {
        // fetch runs off main actor; ArticleDTO crosses the boundary safely
        let dtos = try? await networkClient.fetchArticles()
        articles = dtos ?? []
    }
}
```

### Suppressing false-positive errors from `@preconcurrency` modules

When importing a module that hasn't adopted Swift 6 concurrency, use `@preconcurrency`:

```swift
@preconcurrency import SomeLegacySDK   // suppresses Sendable warnings from this module
```

---

## Rules

- Prefer `actor` or `struct` over `@unchecked Sendable` for new types
- `nonisolated(unsafe)` is for properties provably safe but unverifiable by the compiler — always add a comment explaining why it is safe
- `@Sendable` on a closure type means all captured values must be `Sendable`
- `sending` on a parameter or return type transfers ownership; the compiler proves single-ownership at the call site — you cannot use `sending` to smuggle shared mutable state
- `@preconcurrency import` is the correct suppression for unmodified third-party modules — not `@unchecked Sendable` on your own types
- In Swift 6 language mode, all violations are errors; in `complete` checking mode (Swift 5.x), they are warnings — see migration-guide.md
