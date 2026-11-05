# Structured Concurrency

## The Concurrency Hierarchy

Swift structured concurrency means child tasks are always tied to a parent scope. The parent cannot finish until all children finish. This guarantees cleanup, cancellation propagation, and error propagation without manual bookkeeping.

```
Task (root — unstructured)
└── async let (structured child)
└── TaskGroup children (structured)
    └── each group.addTask { ... }
```

---

## `async let` — Fixed-Count Parallel Work

`async let` is the right tool when you know exactly how many concurrent operations you need and they are all determined at the call site. Simpler than `TaskGroup` for 2–5 operations.

```swift
// Fetch both concurrently — wait for both at the await line
func loadProfile(userID: UUID) async throws -> ProfileViewModel {
    async let user    = userService.fetchUser(id: userID)
    async let posts   = postService.fetchPosts(for: userID)
    async let follows = followService.fetchFollowCount(for: userID)

    // All three run concurrently; this line waits for all of them
    let (u, p, f) = try await (user, posts, follows)
    return ProfileViewModel(user: u, posts: p, followCount: f)
}
```

**Cancellation:** If `await (user, posts, follows)` throws, all three child tasks are cancelled automatically.

> Use `async let` for a fixed, known set of concurrent operations. Use `TaskGroup` when the number of tasks is dynamic (e.g., one per item in an array).

---

## `TaskGroup` — Dynamic Parallel Work

### `withTaskGroup` — non-throwing, collects results

```swift
func fetchDetails(for ids: [Int]) async -> [ItemDetail] {
    await withTaskGroup(of: ItemDetail?.self) { group in
        for id in ids {
            group.addTask {
                try? await repository.fetchDetail(id: id)
            }
        }

        var results: [ItemDetail] = []
        for await detail in group {
            if let detail { results.append(detail) }
        }
        return results
    }
}
```

### `withThrowingTaskGroup` — tasks can throw

If any child task throws, the group cancels all remaining children and rethrows the first error:

```swift
func fetchAll(ids: [Int]) async throws -> [Article] {
    try await withThrowingTaskGroup(of: Article.self) { group in
        for id in ids {
            group.addTask { try await api.fetchArticle(id: id) }
        }

        var articles: [Article] = []
        for try await article in group {
            articles.append(article)
        }
        return articles
    }
}
```

### `DiscardingTaskGroup` — fire-and-forget

When you spawn many tasks and don't need their return values, use `DiscardingTaskGroup`. It eagerly releases memory from completed child tasks instead of accumulating results.

```swift
// Processing a large batch where you don't need individual results
func processBatch(_ items: [WorkItem]) async {
    await withDiscardingTaskGroup { group in
        for item in items {
            group.addTask { await processItem(item) }
        }
        // No iteration needed — results are discarded immediately
    }
}
```

**`ThrowingDiscardingTaskGroup`:** Like `DiscardingTaskGroup` but any child throw cancels all remaining children:

```swift
func importFiles(_ urls: [URL]) async throws {
    try await withThrowingDiscardingTaskGroup { group in
        for url in urls {
            group.addTaskUnlessCancelled {
                try await importFile(url)
            }
        }
    }
}
```

### Choosing the right `TaskGroup` type

| Type | Return values | Throws | Memory |
|---|---|---|---|
| `withTaskGroup` | Collected via iteration | No | Accumulates until iterated |
| `withThrowingTaskGroup` | Collected via iteration | Yes | Accumulates until iterated |
| `withDiscardingTaskGroup` | Discarded | No | Released immediately per task |
| `withThrowingDiscardingTaskGroup` | Discarded | Yes | Released immediately per task |

> Use `DiscardingTaskGroup` for server-style accept loops, batch processing pipelines, and any case where you spawn work and don't need results back.

---

## `isolation:` Parameter on TaskGroup APIs

All `withTaskGroup` variants in Swift 6.2 accept `isolation: isolated (any Actor)? = #isolation`. This ensures the body closure runs on the caller's actor.

```swift
// Called from @MainActor — group body runs on main actor
@MainActor
func loadDashboard() async throws {
    try await withThrowingTaskGroup(of: DashboardSection.self) { group in
        // This closure runs on @MainActor — can access isolated state directly
        group.addTask { try await loadHeader() }
        group.addTask { try await loadFeed() }

        for try await section in group {
            self.sections.append(section)   // Direct @MainActor access ✓
        }
    }
}
```

---

## `Task` — Unstructured Concurrency

Use `Task { }` when you need to launch async work from a synchronous context (e.g., a SwiftUI button action or a lifecycle method). The task is not a child of any structured scope.

```swift
// SwiftUI button action — synchronous context
Button("Load") {
    Task {
        await viewModel.load()
    }
}
```

**Context inheritance:** A `Task { }` created inside a `@MainActor` context inherits the main actor. It runs on the main actor and can access `@MainActor` state directly.

```swift
@MainActor
final class Store {
    var items: [Item] = []

    func onAppear() {
        // Task inherits @MainActor — safe to mutate items directly
        Task {
            items = await repository.fetchItems()   // ✓ no await for actor hop
        }
    }
}
```

### `Task.detached` — Break Context Inheritance

Use `Task.detached` when you explicitly do NOT want to inherit the current actor or priority. Detached tasks run on a shared thread pool with no actor isolation.

```swift
// Heavy work that must not run on the main actor
Task.detached(priority: .background) {
    let compressed = await compress(imageData)
    await MainActor.run {
        previewImage = UIImage(data: compressed)
    }
}
```

> Prefer `Task { }` over `Task.detached`. Use `Task.detached` only when you need to explicitly break actor context or set a specific lower priority.

---

## `@TaskLocal` — Contextual Values

`@TaskLocal` is the correct replacement for thread-local storage. Values are inherited by child tasks automatically and do not cross into detached tasks.

```swift
enum RequestContext {
    @TaskLocal static var requestID: String = "unknown"
    @TaskLocal static var userID: UUID?
}

// Bind a value for a scope — child tasks inherit it
func handleRequest(id: String) async {
    await RequestContext.$requestID.withValue(id) {
        await processRequest()           // requestID == id here
        async let sub = fetchSubresource()   // also inherits requestID
        await sub
    }
}

// Read from anywhere in the task tree
func processRequest() async {
    let id = RequestContext.requestID    // reads the current value
    logger.info("Processing request \(id)")
}
```

**Rules:**
- Child tasks (via `async let`, `TaskGroup`, `Task { }`) inherit parent task-local values
- `Task.detached` does NOT inherit task-local values
- Mutations inside `withValue` do not affect the outer scope

---

## Rules

- Use `async let` for a fixed, known number of concurrent operations
- Use `TaskGroup` when the number of tasks is determined at runtime (iterating an array)
- Use `DiscardingTaskGroup` when child task results are not needed — it releases memory immediately
- `Task { }` inherits the current actor; `Task.detached` does not — prefer `Task { }` in views and stores
- Use `@TaskLocal` instead of global variables for request-scoped context (logging, tracing, DI)
- `@TaskLocal` values propagate to child tasks but not to `Task.detached` tasks
- `addTaskUnlessCancelled` prevents adding work after the group is cancelled
