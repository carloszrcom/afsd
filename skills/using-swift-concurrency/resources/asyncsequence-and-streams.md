# AsyncSequence & AsyncStream

## `AsyncSequence` Basics

`AsyncSequence` is the async counterpart of `Sequence`. Iterating it suspends until the next element is available, making it the natural model for events, notifications, live data feeds, and paginated results.

```swift
// Consuming any AsyncSequence
for await location in locationManager.locationStream {
    updateMap(with: location)
}
```

`TaskGroup` conforms to `AsyncSequence` — you can iterate results as they complete:

```swift
for try await result in group {
    results.append(result)   // processes each result as it arrives
}
```

---

## `AsyncStream` — The Standard Producer

Use `AsyncStream` when you have a push-based source (delegate callbacks, notifications, timers) that you want to expose as an `AsyncSequence`.

```swift
// Wrap a CLLocationManager delegate into an AsyncStream
func locationStream() -> AsyncStream<CLLocation> {
    AsyncStream { continuation in
        let delegate = LocationDelegate(continuation: continuation)
        let manager = CLLocationManager()
        manager.delegate = delegate
        manager.startUpdatingLocation()

        continuation.onTermination = { _ in
            manager.stopUpdatingLocation()    // Clean up when stream ends
        }
    }
}

// Consume
for await location in locationStream() {
    updateMap(with: location)
}
```

### Buffering Policies

The initializer's `bufferingPolicy` controls what happens when values arrive faster than they are consumed:

| Policy | Behavior |
|---|---|
| `.unbounded` (default) | Buffer grows without limit — risk of memory pressure |
| `.bufferingNewest(n)` | Keep the latest `n` values; drop older ones |
| `.bufferingOldest(n)` | Keep the oldest `n` values; drop newer ones |
| `.dropOldest` | Equivalent to `.bufferingNewest(1)` |

```swift
// UI-bound stream — only latest value matters; buffer 1
AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
    sensorFeed.onReading { reading in
        continuation.yield(reading)
    }
}
```

> Always choose a bounded policy for high-frequency event sources (sensors, accelerometer, scroll events) to avoid unbounded memory growth.

---

## `AsyncThrowingStream` — Streams That Can Fail

Use `AsyncThrowingStream` when the underlying source can terminate with an error:

```swift
func webSocketMessages(url: URL) -> AsyncThrowingStream<String, Error> {
    AsyncThrowingStream { continuation in
        let socket = WebSocket(url: url)

        socket.onMessage { message in
            continuation.yield(message)
        }

        socket.onError { error in
            continuation.finish(throwing: error)   // Terminates with error
        }

        socket.onClose {
            continuation.finish()                  // Clean termination
        }

        continuation.onTermination = { _ in
            socket.disconnect()
        }
    }
}

// Consume
do {
    for try await message in webSocketMessages(url: serverURL) {
        handle(message)
    }
} catch {
    handleDisconnect(error)
}
```

---

## Standard Combinators on `AsyncSequence`

All `AsyncSequence` conformers have `.map`, `.filter`, `.compactMap`, `.flatMap`, `.prefix`, `.dropFirst`, and more — same as `Sequence`, but async:

```swift
// Filter and transform before consuming
let processedLocations = locationStream()
    .filter { $0.horizontalAccuracy < 10 }
    .map { LocationDTO(from: $0) }

for await location in processedLocations {
    store.update(with: location)
}
```

Useful combinators:

```swift
// Stop after n elements
for await event in eventStream.prefix(10) { ... }

// Skip first n
for await item in stream.dropFirst(3) { ... }

// Compact unwrap
let nonNilStream = optionalStream.compactMap { $0 }
```

---

## Implementing `AsyncSequence` Directly

`AsyncStream` covers most cases. Implement `AsyncSequence` directly when you need multiple simultaneous iterators, complex internal state, or a type that is part of a public API.

```swift
struct PagedResults<T: Sendable & Decodable>: AsyncSequence {
    typealias Element = [T]

    let endpoint: URL
    let pageSize: Int

    struct AsyncIterator: AsyncIteratorProtocol {
        var currentPage = 0
        var hasMore = true
        let endpoint: URL
        let pageSize: Int

        mutating func next() async throws -> [T]? {
            guard hasMore else { return nil }

            let url = endpoint.appending(queryItems: [
                .init(name: "page", value: "\(currentPage)"),
                .init(name: "limit", value: "\(pageSize)")
            ])
            let page: PageResponse<T> = try await NetworkClient.shared.fetch(url)
            currentPage += 1
            hasMore = page.hasMore
            return page.items.isEmpty ? nil : page.items
        }
    }

    func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(endpoint: endpoint, pageSize: pageSize)
    }
}

// Usage — iterates pages until the last one
for try await page in PagedResults<Article>(endpoint: articlesURL, pageSize: 20) {
    store.insert(page)
}
```

---

## Converting Notification Center to `AsyncSequence`

Foundation provides async sequences for `NotificationCenter`:

```swift
// Built-in — no AsyncStream wrapper needed
for await notification in NotificationCenter.default
    .notifications(named: UIApplication.didBecomeActiveNotification) {
    await store.refresh()
}
```

---

## Rules

- Always specify a bounded `bufferingPolicy` for high-frequency sources — `.unbounded` can exhaust memory
- Use `continuation.onTermination` to clean up resources (stop managers, disconnect sockets) when the stream is cancelled or finished
- Finish `AsyncStream` exactly once — either via `continuation.finish()` or when `onTermination` fires
- Prefer `AsyncStream` for push-based sources; implement `AsyncSequence` directly for public API types requiring multiple iterators
- `AsyncThrowingStream` is the right choice when the source can fail — do not use `AsyncStream<Result<T, Error>>`
- Operators (`.map`, `.filter`, etc.) work on any `AsyncSequence` — compose them before consuming rather than adding logic inside the `for await` body
