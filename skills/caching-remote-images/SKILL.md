---
name: caching-remote-images
description: Implements a three-tier image caching system (memory, disk, network) using native Apple APIs. Provides AsyncImageView component. Use when loading remote images, implementing image caches, or replacing AsyncImage with a cached alternative.
---

# Remote Image Caching — Professional Patterns

## Context
- iOS 26+ / macOS 26+, Swift 6.2, strict concurrency
- Cross-platform: use a `PlatformImage` typealias (`UIImage` on UIKit platforms, `NSImage` on macOS)
- No third-party dependencies — native Apple APIs only
- Three-tier strategy: `NSCache` (memory) → `URLCache` (HTTP disk) → Network

```swift
// PlatformImage.swift — single conditional, everything else is platform-agnostic
#if canImport(UIKit)
import UIKit
public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias PlatformImage = NSImage
#endif
```

## Architecture Layers

Full code with rules and decisions for each area:

- **URLCache & URLSession — the HTTP caching foundation** → [resources/url-cache-and-urlsession.md](resources/url-cache-and-urlsession.md)
- **ImageCacheManager — NSCache + disk + network pipeline** → [resources/image-cache-manager.md](resources/image-cache-manager.md)
- **SwiftUI components — CachedAsyncImage & prefetching** → [resources/image-view-component.md](resources/image-view-component.md)

---

## Absolute Rules

### Never:
- Use `[String: PlatformImage]` or `[URL: PlatformImage]` as a memory cache — use `NSCache`
- Use `.hashValue` for disk cache filenames — it is **randomized per process** and breaks between launches
- Re-encode images to JPEG before storing on disk — destroys alpha channels and degrades PNG/WebP/HEIC
- Perform disk I/O or image decoding from `@MainActor` context — causes UI hitches
- Use `@MainActor` on `ImageCacheManager` — `NSCache` is already thread-safe; `@MainActor` forces disk work onto the main thread
- Set `URLSession.cachePolicy = .reloadIgnoringLocalCacheData` globally — defeats all HTTP caching

### Always:
- Use `NSCache<NSURL, PlatformImage>` with `totalCostLimit` (cost = pixel byte count)
- Use `SHA256` (CryptoKit) for persistent disk filenames — stable across launches
- Store the original response `Data` bytes on disk — no re-encoding
- Pre-decode before inserting into `NSCache` — `byPreparingForDisplay()` on iOS; on macOS force the decode by rasterizing to `CGImage` (see resources)
- Configure `URLCache.shared` at app startup (50 MB memory / 200 MB disk minimum)
- Use `.task(id: url)` in list cell components — cancels stale loads on cell reuse
- Coalesce duplicate in-flight requests for the same URL

---

## Decision: `AsyncImage` vs `CachedAsyncImage`

| Context | Use |
|---|---|
| Profile image, cover art, settings screen | `AsyncImage` — URLCache handles caching |
| List / grid with 10+ images | `CachedAsyncImage` — NSCache eliminates decode hitches |
| Thumbnail grid (small cells, large source images) | `CachedAsyncImage` with `thumbnailSize` |
| Server without `Cache-Control` headers | Always `CachedAsyncImage` |

`AsyncImage` does cache — via `URLCache` — when the server sends `Cache-Control` headers. The problem is it has no in-process decoded-image cache (`NSCache`), so every scroll causes re-decode hitches. For scrolling lists, use `CachedAsyncImage`.

---

## App Setup (Required)

Configure `URLCache.shared` before any image requests fire:

```swift
// MyApp.swift
@main
struct MyApp: App {
    init() {
        URLCache.shared = URLCache(
            memoryCapacity: 50 * 1024 * 1024,    // 50 MB
            diskCapacity:  200 * 1024 * 1024,    // 200 MB
            directory: nil
        )
    }
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

---

## Core Patterns

### Load an image

```swift
// In any async context
let image = await ImageCacheManager.shared.image(for: url)
```

### `CachedAsyncImage` in a list

```swift
struct ArticleRow: View {
    let article: Article

    var body: some View {
        HStack {
            CachedAsyncImage(url: URL(string: article.thumbnailURL))
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading) {
                Text(article.title).font(.headline)
                Text(article.summary).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
```

### `AsyncImage` for isolated images

```swift
// Profile screen — single image, not in a scrolling list
AsyncImage(url: URL(string: user.avatarURL)) { phase in
    switch phase {
    case .success(let image): image.resizable().scaledToFill().clipShape(Circle())
    case .failure: Image(systemName: "person.circle.fill").foregroundStyle(.secondary)
    case .empty: ProgressView()
    @unknown default: EmptyView()
    }
}
.frame(width: 60, height: 60)
```

### Prefetch upcoming items

```swift
ImageCacheManager.shared.prefetch(urls: upcomingURLs)
```

---

## Why These Choices

### `NSCache` vs. `Dictionary`

`NSCache` auto-evicts under OS memory pressure — a `Dictionary` holds memory until the OS kills the app. `NSCache` is thread-safe; `Dictionary` is not. With `totalCostLimit` set to pixel byte count, the cache self-regulates based on actual memory usage.

### `SHA256` vs. `.hashValue`

Swift's `hashValue` is randomly seeded per process (security feature). Files saved with `hashValue` as the key are orphaned on every relaunch — the disk cache never hits and accumulates stale garbage. `SHA256` from CryptoKit is stable, deterministic, and collision-resistant.

### `actor` vs. `@MainActor`

`@MainActor` routes disk reads, disk writes, and image decoding through the main thread. These operations can take 10–100 ms, causing dropped frames. `actor` protects the manager's own state on a background executor; `nonisolated` methods run on the cooperative thread pool.

### Pre-decoding (`byPreparingForDisplay()` / CGImage rasterization)

Images decode lazily on the main thread when first rendered. In a 60fps scroll, a 200ms decode stall drops 12 frames. On iOS, `byPreparingForDisplay()` decodes on a background thread; on macOS there is no direct equivalent — force the decode off the main thread by requesting the `cgImage` representation (`cgImage(forProposedRect:context:hints:)`). Either way, by the time the image reaches `NSCache` it is display-ready.

### Store raw bytes, not re-encoded JPEG

JPEG does not support alpha channels. Re-encoding a PNG with transparency produces a corrupted image. Re-encoding WebP or HEIC to JPEG always degrades quality. Store the original response bytes; decode on cache hit.

---

## Sendable Note

Neither `UIImage` nor `NSImage` is formally `Sendable` in Swift 6. `UIImage` is effectively immutable after creation and safe to pass across concurrency boundaries. `NSImage` is mutable — only pass it across boundaries if no code mutates it after creation. If the compiler warns:

```swift
// ImageCacheManager.swift
extension PlatformImage: @retroactive @unchecked Sendable {}
```

---

## When to Use Third-Party Libraries

For apps with specialized requirements, consider:
- **Kingfisher** — SwiftUI-native, animated GIF/WebP, processor pipeline
- **Nuke** — async-first, highly configurable pipeline, best benchmark performance
- **SDWebImage** — mature, broad format support, UIKit-first

The native implementation above handles the 95% case. Reach for a library when you need animated image support, complex image processing pipelines, or have already profiled and found the native approach insufficient.

---

## Implementation Checklist

### Setup:
- [ ] `URLCache.shared` configured with adequate capacity in `App.init()`
- [ ] Dedicated `URLSession.imageLoading` with `.useProtocolCachePolicy`

### `ImageCacheManager`:
- [ ] `actor` (not `@MainActor`, not a plain class)
- [ ] `NSCache<NSURL, PlatformImage>` with `countLimit` and `totalCostLimit`
- [ ] `SHA256` for disk filenames (not `hashValue`)
- [ ] Raw response `Data` stored to disk (no JPEG re-encoding)
- [ ] Pre-decode before every `NSCache` insert (`byPreparingForDisplay()` on iOS / CGImage rasterization on macOS)
- [ ] In-flight request coalescing via `[URL: Task<PlatformImage?, Never>]`
- [ ] `nonisolated` on network/disk methods

### Components:
- [ ] `CachedAsyncImage` for lists and grids
- [ ] `.task(id: url)` for automatic task cancellation on cell reuse
- [ ] All three display states handled: loading, success, failure
- [ ] `prefetch(urls:)` called `onAppear` for upcoming list items
- [ ] `AsyncImage` used for isolated, non-scrolling image display
