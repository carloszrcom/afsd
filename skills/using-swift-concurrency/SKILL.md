---
name: using-swift-concurrency
description: Enforces modern Swift concurrency patterns with async/await, actors, TaskGroup, and Sendable. Prohibits GCD usage. Use when writing any asynchronous code, migrating from GCD, working with actors or shared state, or using AsyncStream.
---

# Swift Concurrency — Professional Patterns

## Context
- Swift 6.2, iOS 26+ / macOS 26+, Xcode 26, strict concurrency enabled by default
- `Synchronization` framework available for lock-free atomic operations
- All isolation violations are **compile errors** in Swift 6 language mode
- Projects may set `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` — unannotated code is main-actor isolated; use `nonisolated` or actors to move work off the main actor

## Architecture Layers

Full code with rules and decisions for each area:

- **Sendable taxonomy & isolation boundaries** → [resources/sendable-and-isolation.md](resources/sendable-and-isolation.md)
- **Actor isolation model, reentrancy, GlobalActor** → [resources/actor-model.md](resources/actor-model.md)
- **Continuations — bridging callback APIs** → [resources/continuations.md](resources/continuations.md)
- **Task cancellation** → [resources/task-cancellation.md](resources/task-cancellation.md)
- **Structured concurrency: async let, TaskGroup, @TaskLocal** → [resources/structured-concurrency.md](resources/structured-concurrency.md)
- **AsyncSequence & AsyncStream** → [resources/asyncsequence-and-streams.md](resources/asyncsequence-and-streams.md)
- **@MainActor nuances, GlobalActor, Clock API** → [resources/global-actors-and-mainactor.md](resources/global-actors-and-mainactor.md)
- **GCD migration & strict concurrency levels** → [resources/migration-guide.md](resources/migration-guide.md)

---

## Absolute Rules

### Never:
- `DispatchQueue`, `DispatchGroup`, `DispatchSemaphore` in new code
- `OperationQueue` unless cancellation complexity justifies it
- `@escaping` callbacks when an `async` alternative exists
- `Thread.sleep` — blocks a thread from the cooperative pool
- `@unchecked Sendable` without a comment explaining why it is safe
- Wrap an existing async API in a continuation — call it directly

### Always:
- `async/await` for asynchronous operations
- `actor` or `@globalActor` for shared mutable state
- `@MainActor` on all `@Observable` stores and SwiftUI-facing types
- `Sendable` on all types that cross actor boundaries
- `withTaskCancellationHandler` when wrapping cancellable system APIs
- `try Task.checkCancellation()` in long-running loops
- `isolation: isolated (any Actor)? = #isolation` on library async functions

---

## Core Patterns

### `@MainActor` store

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

### Actor for shared state

```swift
actor ImageCache {
    private var cache: [URL: UIImage] = [:]

    func image(for url: URL) -> UIImage? { cache[url] }
    func store(_ image: UIImage, for url: URL) { cache[url] = image }
}
```

### `async let` for fixed parallel work

```swift
func loadProfile(id: UUID) async throws -> ProfileViewModel {
    async let user  = userService.fetchUser(id: id)
    async let posts = postService.fetchPosts(for: id)
    let (u, p) = try await (user, posts)
    return ProfileViewModel(user: u, posts: p)
}
```

### `TaskGroup` for dynamic parallel work

```swift
func fetchAll(ids: [Int]) async throws -> [Article] {
    try await withThrowingTaskGroup(of: Article.self) { group in
        for id in ids {
            group.addTask { try await api.fetch(id: id) }
        }
        var results: [Article] = []
        for try await article in group { results.append(article) }
        return results
    }
}
```

### Continuation — bridging a callback API

```swift
func fetchToken() async throws -> Token {
    try await withCheckedThrowingContinuation { continuation in
        authService.login { result in
            continuation.resume(with: result)
        }
    }
}
```

### `withTaskCancellationHandler`

```swift
func fetch(url: URL) async throws -> Data {
    try await withTaskCancellationHandler {
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    } onCancel: {
        // Cancel underlying request here if needed
    }
}
```

### `AsyncStream` for event feeds

```swift
func locationStream() -> AsyncStream<CLLocation> {
    AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
        let delegate = LocationDelegate(continuation: continuation)
        manager.delegate = delegate
        manager.startUpdatingLocation()
        continuation.onTermination = { _ in manager.stopUpdatingLocation() }
    }
}
```

### `Atomic` — lock-free counter

```swift
import Synchronization

final class RequestCounter: Sendable {
    private let count = Atomic<Int>(0)
    func increment() { count.wrappingAdd(1, ordering: .relaxed) }
    func current() -> Int { count.load(ordering: .relaxed) }
}
```

---

## Concurrency Decision Table

| Situation | Solution |
|---|---|
| Call async from sync context | `Task { await ... }` |
| CPU work off main actor | `Task.detached(priority: .userInitiated)` |
| Fixed count of concurrent ops | `async let` |
| Dynamic count of concurrent ops | `withThrowingTaskGroup` |
| Fire-and-forget batch | `withDiscardingTaskGroup` |
| Shared mutable state | `actor` |
| Shared state across multiple types | `@globalActor` |
| Bridge callback API | `withCheckedThrowingContinuation` |
| Event stream / notifications | `AsyncStream` or `NotificationCenter.notifications(named:)` |
| Cancel underlying OS resource | `withTaskCancellationHandler` |
| Request-scoped context (logging) | `@TaskLocal` |
| Time delay | `Task.sleep(for: .seconds(n))` |
| High-frequency counter, no async | `Atomic` (Synchronization) |

---

## `#isolation` — The Swift 6.2 Standard Pattern

All stdlib async functions accept `isolation: isolated (any Actor)? = #isolation`. Add this to any async utility function you write:

```swift
func fetchUser(
    id: UUID,
    isolation: isolated (any Actor)? = #isolation
) async throws -> User {
    let dto = try await networkClient.fetch(id)
    return User(dto: dto)
    // Result delivered on the caller's actor — no extra hop
}
```

---

## Sendable Quick Reference

| Type | Sendable? | Notes |
|---|---|---|
| `struct` with all-`Sendable` properties | Implicit ✓ | Free |
| `enum` with all-`Sendable` cases | Implicit ✓ | Free |
| `actor` | Always ✓ | Inherent |
| `final class` with only `let` | Explicit annotation | Annotate manually |
| Class with mutable state + lock | `@unchecked Sendable` | You assert safety |
| Closure crossing boundary | `@Sendable` | On the closure type |
| Non-`Sendable` with single owner | `sending` | Compiler proves ownership |

---

## Strict Concurrency Migration

Incremental path (see migration-guide.md for full patterns):

```
minimal → targeted → complete → Swift 6 language mode
```

For third-party modules not yet on Swift 6:
```swift
@preconcurrency import SomeLegacySDK
```

---

## Implementation Checklist

### Core:
- [ ] All async state mutations on `@MainActor` or a custom actor
- [ ] `actor` for any class with shared mutable state
- [ ] Types crossing actor boundaries conform to `Sendable`
- [ ] No `DispatchQueue`, `DispatchSemaphore`, or `DispatchGroup` in new code

### Structured Concurrency:
- [ ] `async let` for 2–5 fixed concurrent operations
- [ ] `withThrowingTaskGroup` for dynamic parallel operations
- [ ] `withDiscardingTaskGroup` for fire-and-forget batches
- [ ] `Task { }` (not `Task.detached`) for view/store-initiated work
- [ ] `Task.detached` only for work that must NOT inherit the current actor

### Cancellation:
- [ ] `try Task.checkCancellation()` in loops and long operations
- [ ] `withTaskCancellationHandler` when wrapping URLSession, AVPlayer, etc.
- [ ] `addTaskUnlessCancelled` in task groups over large inputs
- [ ] `CancellationError` caught separately from domain errors

### Continuations:
- [ ] `withCheckedThrowingContinuation` for all callback-based bridging
- [ ] Every code path resumes the continuation exactly once
- [ ] Stored continuations are nilled out immediately after resuming

### AsyncSequence:
- [ ] `AsyncStream` with bounded `bufferingPolicy` for high-frequency sources
- [ ] `continuation.onTermination` cleans up underlying resources
- [ ] `AsyncThrowingStream` when the source can fail
