# URLCache & URLSession — The HTTP Caching Layer

## What URLCache Does for You

`URLCache` is the built-in HTTP caching layer that Apple provides. It automatically caches HTTP/HTTPS responses — including images — to both memory and disk, respecting the server's `Cache-Control` and `Expires` headers (RFC 2616). `URLSession` uses it by default.

This means: if your server sends correct `Cache-Control` headers, `URLSession` already caches image responses without any custom code. Understanding this layer prevents you from reimplementing it incorrectly.

---

## What URLCache Stores vs. NSCache

| | `URLCache` | `NSCache<NSURL, PlatformImage>` |
|---|---|---|
| What is stored | Raw compressed response bytes (JPEG/PNG/WebP) | Decoded, display-ready `PlatformImage` |
| Memory footprint | Small (compressed) | Large (decompressed RGBA) |
| Disk footprint | Managed by OS in caches dir | Custom implementation |
| Thread safety | Thread-safe | Thread-safe |
| Eviction | OS-managed, respects pressure | Auto-eviction under memory pressure |
| Survives app restart | Yes (disk component) | No (memory only) |
| HTTP semantics | Full — ETag, Last-Modified, must-revalidate | None |

**Use both:** `URLCache` for HTTP-level persistence (survives relaunches, respects server freshness), `NSCache` for in-process decoded-image caching (zero decode latency for recently-seen images).

---

## Configuring URLCache

The default `URLCache.shared` is modest (512 KB memory / 10 MB disk). For an image-heavy app, configure it at app startup:

```swift
// MyApp.swift — set before any URLSession requests
@main
struct MyApp: App {
    init() {
        // 50 MB memory, 200 MB disk — adjust to your app's image volume
        URLCache.shared = URLCache(
            memoryCapacity: 50 * 1024 * 1024,
            diskCapacity: 200 * 1024 * 1024,
            directory: nil   // nil = default caches directory
        )
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

---

## URLSession Configuration for Images

Create a dedicated `URLSession` for image loading with image-specific settings:

```swift
extension URLSession {
    static let imageLoading: URLSession = {
        let config = URLSessionConfiguration.default
        // Use URLCache.shared configured above
        config.urlCache = URLCache.shared
        // Respect server cache headers (default — do not change)
        config.requestCachePolicy = .useProtocolCachePolicy
        // Timeout for slow connections
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        // Waits for connectivity instead of failing immediately
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()
}
```

---

## Cache Policies — When to Use Each

| Policy | Use case |
|---|---|
| `.useProtocolCachePolicy` (default) | Standard image loading — respects server `Cache-Control` |
| `.returnCacheDataElseLoad` | Offline-first: use any cached version, fall back to network |
| `.returnCacheDataDontLoad` | Offline mode: only show cached images, fail if not cached |
| `.reloadIgnoringLocalCacheData` | Force refresh: always re-download (pull-to-refresh) |
| `.reloadRevalidatingCacheData` | Always check freshness with server (conditional GET) |

For per-request policy override:

```swift
var request = URLRequest(url: imageURL)
request.cachePolicy = .returnCacheDataElseLoad   // Override for this request only
let (data, _) = try await URLSession.imageLoading.data(for: request)
```

---

## When AsyncImage Is Sufficient

`AsyncImage` uses `URLSession.shared` which uses `URLCache`. If your server sends `Cache-Control` headers, `AsyncImage` does cache — on both memory and disk via `URLCache`.

**Use `AsyncImage` directly when:**
- Displaying a small number of images (profile photo, cover art, settings screen)
- The image does not appear in a fast-scrolling list
- The server provides `Cache-Control: max-age=...` headers

```swift
// Sufficient for a profile screen — not in a List with 1000 items
AsyncImage(url: URL(string: user.avatarURL)) { phase in
    switch phase {
    case .success(let image):
        image.resizable().scaledToFill()
    case .failure:
        Image(systemName: "person.circle.fill").foregroundStyle(.secondary)
    case .empty:
        ProgressView()
    @unknown default:
        EmptyView()
    }
}
```

**Use a custom `ImageCacheManager` when:**
- Images appear in a `List`, `LazyVGrid`, or `UICollectionView`-backed view
- You need decoded-image caching (`NSCache`) to avoid decode hitches on scroll
- Your server does not provide `Cache-Control` headers
- You need prefetching, coalescing, or explicit cache control

---

## Server-Side Requirements for URLCache to Work

`URLCache` only stores a response if the server allows it. Your backend must send at least one of:

```
Cache-Control: max-age=86400        # Cache for 24 hours
Cache-Control: public, max-age=604800  # Cache for 7 days
Expires: Thu, 01 Jan 2026 00:00:00 GMT
```

If the server sends `Cache-Control: no-store` or `no-cache`, `URLCache` will not persist the response. In that case, a custom `ImageCacheManager` is required regardless of the use case.

---

## Rules

- Configure `URLCache.shared` at app startup — the default 10 MB disk limit is too small for image-heavy apps
- Use `.useProtocolCachePolicy` (the default) — it follows HTTP semantics correctly
- Do not set `.reloadIgnoringLocalCacheData` globally — it defeats all HTTP caching
- `AsyncImage` is appropriate for low-frequency image display when the server caches correctly
- For scrolling lists with many images, always use a custom `NSCache`-backed manager to avoid decode hitches
- `URLCache` stores raw bytes (compact); `NSCache` stores decoded images (fast display) — both serve different purposes and should coexist
