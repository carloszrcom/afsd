# Continuations — Bridging Callback APIs

## Why Continuations Exist

Legacy frameworks (URLSession delegates, CoreLocation, CoreBluetooth, AVFoundation) communicate results through `@escaping` callbacks. Continuations are the standard bridge that converts a callback-based API into `async/await` without changing the underlying library.

---

## `withCheckedContinuation` — The Standard Bridge

Use when the underlying API cannot throw.

```swift
// CLLocationManager uses a delegate callback — bridge it to async/await
func requestLocation() async -> CLLocation {
    await withCheckedContinuation { continuation in
        locationFetcher.fetchOnce { location in
            continuation.resume(returning: location)
        }
    }
}
```

Use when the underlying API can throw:

```swift
func authenticate(with credentials: Credentials) async throws -> AuthToken {
    try await withCheckedThrowingContinuation { continuation in
        authService.login(credentials) { result in
            switch result {
            case .success(let token):
                continuation.resume(returning: token)
            case .failure(let error):
                continuation.resume(throwing: error)
            }
        }
    }
}
```

---

## The One-Resume Contract

A continuation **must be resumed exactly once** on every code path. The checked variants enforce this with runtime diagnostics:

- **Zero resumes**: the task leaks and never completes — the checked variant logs a warning at runtime
- **More than one resume**: crash in debug builds

```swift
// ✗ Bug: early return path never resumes
func fetchData(url: URL) async -> Data? {
    await withCheckedContinuation { continuation in
        guard isConnected else {
            return                           // ✗ continuation leaked — task hangs forever
        }
        network.fetch(url) { data in
            continuation.resume(returning: data)
        }
    }
}

// ✓ Fix: every path resumes
func fetchData(url: URL) async -> Data? {
    await withCheckedContinuation { continuation in
        guard isConnected else {
            continuation.resume(returning: nil)   // ✓ always resumes
            return
        }
        network.fetch(url) { data in
            continuation.resume(returning: data)
        }
    }
}
```

---

## Isolation Parameter — Resuming on the Right Actor

Swift 6.2 continuations accept an `isolation` parameter (defaulting to `#isolation`) that ensures the continuation resumes on the same actor as the call site. This eliminates unnecessary actor hops.

```swift
// Full signature in Swift 6.2:
func withCheckedContinuation<T>(
    isolation: isolated (any Actor)? = #isolation,
    function: String = #function,
    _ body: (CheckedContinuation<T, Never>) -> Void
) async -> sending T
```

You do not need to pass `isolation:` explicitly — it defaults to your calling context via `#isolation`. The result (`sending T`) enables returning non-`Sendable` values across the boundary when the compiler can prove single ownership.

---

## `withUnsafeContinuation` — Performance-Critical Paths

The unsafe variants skip the runtime checks. Use only after validating correctness with the checked variants and profiling shows the overhead matters:

```swift
// Unsafe: no diagnostic if resumed zero or more than once
func loadImageUnsafe(url: URL) async -> UIImage? {
    await withUnsafeContinuation { continuation in
        imageLoader.load(url) { image in
            continuation.resume(returning: image)
        }
    }
}
```

> Default to `withCheckedContinuation`. Switch to `withUnsafeContinuation` only in measured hot paths.

---

## Cancellation in Continuations

`withCheckedContinuation` does not automatically propagate task cancellation — the callback-based API does not know about Swift tasks. Handle cancellation explicitly with `withTaskCancellationHandler`:

```swift
func fetchWithCancellation(url: URL) async throws -> Data {
    // Store a reference so we can cancel from the handler
    let task = URLSessionTask?.none
    var sessionTask: URLSessionTask?

    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            let t = URLSession.shared.dataTask(with: url) { data, _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: data ?? Data())
                }
            }
            sessionTask = t
            t.resume()
        }
    } onCancel: {
        sessionTask?.cancel()    // Called immediately when task is cancelled
    }
}
```

> See task-cancellation.md for the full `withTaskCancellationHandler` pattern.

---

## `CheckedContinuation` — Storing for Later

When the callback fires after the function body has returned (e.g., a multipart delegate), store the continuation and resume it later:

```swift
final class BluetoothScanner: NSObject, CBCentralManagerDelegate {
    private var scanContinuation: CheckedContinuation<CBPeripheral, Error>?

    func findPeripheral(matching name: String) async throws -> CBPeripheral {
        try await withCheckedThrowingContinuation { continuation in
            scanContinuation = continuation
            centralManager.scanForPeripherals(withServices: nil)
        }
    }

    // CBCentralManagerDelegate callback
    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        guard peripheral.name == targetName else { return }
        centralManager.stopScan()
        scanContinuation?.resume(returning: peripheral)
        scanContinuation = nil   // Nil out to prevent accidental double-resume
    }
}
```

> Always nil out stored continuations immediately after resuming to prevent accidental double-resume if the delegate fires a second time.

---

## Rules

- Always resume exactly once on every code path — use `withCheckedContinuation` (not unsafe) during development
- Nil out stored continuations immediately after resuming
- Pair continuations with `withTaskCancellationHandler` when the underlying API supports cancellation
- Do not use continuations to wrap APIs that already have async equivalents — call the async version directly
- The `isolation` parameter defaults to `#isolation` — you do not need to pass it manually
- Return type `sending T` allows crossing isolation boundaries with non-`Sendable` results when ownership is provably exclusive
