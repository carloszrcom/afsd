# Task Cancellation

## Cancellation Is Cooperative

Swift's cancellation model is cooperative. Calling `task.cancel()` sets a flag — it does not forcibly stop the task. The task must check for cancellation and stop itself. This design allows tasks to clean up resources before terminating.

```swift
let task = Task {
    await doWork()
}

task.cancel()   // Sets the cancellation flag — does not stop the task immediately
```

---

## Checking Cancellation

### `Task.checkCancellation()` — throwing check

Throws `CancellationError` if the task is cancelled. Use inside loops or at checkpoints where stopping is the right response.

```swift
func processItems(_ items: [Item]) async throws {
    for item in items {
        try Task.checkCancellation()    // Stop processing if cancelled
        try await process(item)
    }
}
```

### `Task.isCancelled` — non-throwing check

Returns `true` if cancelled. Use when you need to clean up before returning, rather than throwing.

```swift
func fetchPages(from urls: [URL]) async -> [Data] {
    var results: [Data] = []
    for url in urls {
        if Task.isCancelled { break }    // Exit cleanly without throwing
        if let data = try? await URLSession.shared.data(from: url).0 {
            results.append(data)
        }
    }
    return results
}
```

---

## `withTaskCancellationHandler` — Immediate Cancellation Notification

`withTaskCancellationHandler` registers a closure that fires **immediately** when the task is cancelled, even if the `operation` closure is suspended waiting on an external resource. This is the correct pattern for cancelling network requests, timers, and OS-level operations.

```swift
func fetchData(from url: URL) async throws -> Data {
    try await withTaskCancellationHandler {
        // Main operation — runs until cancelled or completion
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    } onCancel: {
        // Called immediately on cancellation, from any context
        // Cancel the URLSession task here if you have a reference to it
    }
}
```

### Full pattern with URLSession cancellation

```swift
func fetch(url: URL) async throws -> Data {
    // Use a class to share the sessionTask reference safely
    final class Box: @unchecked Sendable { var task: URLSessionDataTask? }
    let box = Box()

    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            let task = URLSession.shared.dataTask(with: url) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: data ?? Data())
                }
            }
            box.task = task
            task.resume()
        }
    } onCancel: {
        box.task?.cancel()    // Fires immediately when Task is cancelled
    }
}
```

> `onCancel` runs on an unspecified executor and may be called concurrently with `operation`. Shared mutable state accessed from both closures must be protected.

---

## `CancellationError` — Catch It Separately

`checkCancellation()` throws `CancellationError`. Catch it separately from domain errors to avoid masking cancellation as a business logic failure:

```swift
func loadArticles() async {
    do {
        let articles = try await repository.fetchArticles()
        self.articles = articles
    } catch is CancellationError {
        // Task was cancelled — silently stop, do not show error UI
    } catch {
        self.error = error
    }
}
```

---

## `addTaskUnlessCancelled` — Safe Task Group Population

In a `TaskGroup`, use `addTaskUnlessCancelled` instead of `addTask` when you do not want to add new work after a cancellation signal:

```swift
func fetchAll(ids: [Int]) async throws -> [Article] {
    try await withThrowingTaskGroup(of: Article.self) { group in
        for id in ids {
            // Does not add task if the group is already cancelled
            guard group.addTaskUnlessCancelled(priority: .medium, operation: {
                try await repository.fetch(id: id)
            }) else { break }
        }

        var results: [Article] = []
        for try await article in group {
            results.append(article)
        }
        return results
    }
}
```

---

## Cancellation Propagation in Structured Concurrency

- When a parent task is cancelled, all child tasks are automatically cancelled
- When a task group throws, all remaining child tasks in the group are cancelled
- `Task.detached` tasks are **not** children of the creating task — they do not inherit cancellation

```swift
// Child tasks are cancelled when the parent is cancelled
func loadDashboard() async throws -> Dashboard {
    try await withThrowingTaskGroup(of: DashboardSection.self) { group in
        group.addTask { try await loadHeader() }
        group.addTask { try await loadFeed() }
        group.addTask { try await loadRecommendations() }
        // If any task throws, the group cancels all remaining tasks
        var sections: [DashboardSection] = []
        for try await section in group { sections.append(section) }
        return Dashboard(sections: sections)
    }
}
```

---

## `Task.sleep` Is Cancellable

`Task.sleep` throws `CancellationError` when the task is cancelled during the sleep. Always use the `Clock`-based API:

```swift
// ✓ Correct — throws CancellationError on cancellation
try await Task.sleep(for: .seconds(5))

// ✗ Old API — avoid in new code
try await Task.sleep(nanoseconds: 5_000_000_000)
```

See `global-actors-and-mainactor.md` for the `Clock` protocol and `ContinuousClock` vs. `SuspendingClock`.

---

## Rules

- Cancellation is cooperative — every long-running task must check `Task.isCancelled` or call `Task.checkCancellation()`
- Use `withTaskCancellationHandler` whenever the underlying API has its own cancellation mechanism (URLSession, AVPlayer, etc.)
- Catch `CancellationError` separately — do not treat cancellation as a user-visible error
- `onCancel` may run concurrently with `operation` — protect shared mutable state
- Use `addTaskUnlessCancelled` in task groups to stop spawning new work after cancellation
- `Task.detached` does not inherit parent cancellation — use structured concurrency (`async let`, task groups) to get automatic propagation
