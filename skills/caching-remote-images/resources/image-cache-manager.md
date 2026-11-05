# ImageCacheManager — Three-Tier Cache

## Architecture

```
Request
  ↓
NSCache<NSURL, PlatformImage> ← Tier 1: Memory (decoded, display-ready, auto-evicting)
  ↓ miss
URLCache (via URLSession)     ← Tier 2: HTTP disk cache (compressed bytes, respects Cache-Control)
  ↓ miss
URLSession network fetch      ← Tier 3: Network download
  ↓
preparedForDisplay()          ← Off-thread decode (eliminates scroll hitches)
  ↓
NSCache + URLCache populated
```

---

## Why `actor`, not `@MainActor`

`NSCache` is documented as thread-safe — no external locking needed. Performing disk I/O or image decoding on `@MainActor` blocks the main thread and causes UI hitches. The `ImageCacheManager` is an `actor` with its own serial executor, keeping manager state protected without touching the main thread.

Network fetches (`URLSession.data(from:)`) and image pre-decoding (`preparedForDisplay()`) are called with `nonisolated` to avoid holding the actor's executor during the wait — the actor is free to serve other requests while the network is in flight.

---

## Full Implementation

```swift
// PlatformImage.swift — the only platform conditional in the whole system
#if canImport(UIKit)
import UIKit
public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias PlatformImage = NSImage
#endif

extension PlatformImage {
    /// Returns a display-ready (pre-decoded) image, off the main thread.
    func preparedForDisplay() async -> PlatformImage? {
        #if canImport(UIKit)
        return await byPreparingForDisplay()
        #else
        // AppKit has no equivalent — force the decode by rasterizing to CGImage
        _ = cgImage(forProposedRect: nil, context: nil, hints: nil)
        return self
        #endif
    }
}
```

```swift
// ImageCacheManager.swift
import CryptoKit
import OSLog

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "", category: "ImageCache")

actor ImageCacheManager {

    // MARK: - Singleton

    static let shared = ImageCacheManager()

    // MARK: - Tier 1: Memory cache (decoded images, auto-evicting)

    private let memoryCache: NSCache<NSURL, PlatformImage> = {
        let cache = NSCache<NSURL, PlatformImage>()
        cache.countLimit = 200                    // Max 200 decoded images
        cache.totalCostLimit = 100 * 1024 * 1024  // ~100 MB ceiling (cost = raw bytes)
        cache.name = "com.app.imageCache"
        return cache
    }()

    // MARK: - In-flight request coalescing (avoids duplicate downloads)

    private var inFlight: [URL: Task<PlatformImage?, Never>] = [:]

    // MARK: - Disk cache directory

    private let diskCacheDirectory: URL = {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = caches.appending(path: "ImageCache", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    // MARK: - Public API

    /// Returns a display-ready image from memory, HTTP cache, disk, or network.
    func image(for url: URL) async -> PlatformImage? {
        // 1. Memory — synchronous, zero cost
        if let cached = memoryCache.object(forKey: url as NSURL) {
            logger.debug("Memory hit: \(url.lastPathComponent)")
            return cached
        }

        // 2. Coalesce duplicate in-flight requests for the same URL
        if let existingTask = inFlight[url] {
            return await existingTask.value
        }

        let task = Task<PlatformImage?, Never> {
            await fetchAndCache(url: url)
        }
        inFlight[url] = task
        let result = await task.value
        inFlight.removeValue(forKey: url)
        return result
    }

    // MARK: - Cache Management

    func clearMemoryCache() {
        memoryCache.removeAllObjects()
        logger.info("Memory cache cleared")
    }

    func clearDiskCache() async {
        await removeDiskCache()
        logger.info("Disk cache cleared")
    }

    func prefetch(urls: [URL]) {
        for url in urls {
            guard memoryCache.object(forKey: url as NSURL) == nil else { continue }
            Task { await image(for: url) }
        }
    }

    // MARK: - Private: Fetch pipeline

    private func fetchAndCache(url: URL) async -> PlatformImage? {
        // Disk cache check (custom disk cache for servers without Cache-Control headers)
        if let diskImage = await loadFromDisk(url: url) {
            logger.debug("Disk hit: \(url.lastPathComponent)")
            let cost = diskImage.size.width * diskImage.size.height * 4
            memoryCache.setObject(diskImage, forKey: url as NSURL, cost: Int(cost))
            return diskImage
        }

        // Network (URLSession uses URLCache automatically for HTTP-level caching)
        guard let rawData = await download(url: url) else { return nil }

        // Decode off main thread — eliminates scroll hitches
        guard let decoded = await PlatformImage(data: rawData)?.preparedForDisplay() else {
            return nil
        }

        // Populate memory cache (cost = approximate raw pixel bytes)
        let cost = decoded.size.width * decoded.size.height * 4
        memoryCache.setObject(decoded, forKey: url as NSURL, cost: Int(cost))

        // Persist to custom disk cache (for servers without Cache-Control)
        await saveToDisk(data: rawData, url: url)

        logger.info("Downloaded: \(url.lastPathComponent)")
        return decoded
    }

    // MARK: - Private: Network

    // nonisolated: runs on cooperative thread pool, not on actor's executor
    // Actor remains free to serve other requests during the network wait
    private nonisolated func download(url: URL) async -> Data? {
        do {
            let (data, response) = try await URLSession.imageLoading.data(from: url)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                logger.warning("Bad response for \(url.lastPathComponent): \(String(describing: response))")
                return nil
            }
            return data
        } catch {
            if !(error is CancellationError) {
                logger.error("Download failed for \(url.lastPathComponent): \(error.localizedDescription)")
            }
            return nil
        }
    }

    // MARK: - Private: Disk I/O

    // Stable SHA-256 filename — safe across app launches (unlike hashValue which is randomized)
    private nonisolated func diskFilename(for url: URL) -> String {
        let data = Data(url.absoluteString.utf8)
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    private nonisolated func diskFileURL(for url: URL) -> URL {
        diskCacheDirectory.appending(path: diskFilename(for: url))
    }

    private nonisolated func loadFromDisk(url: URL) async -> PlatformImage? {
        let fileURL = diskFileURL(for: url)
        guard FileManager.default.fileExists(atPath: fileURL.path()),
              let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe),
              let image = PlatformImage(data: data) else { return nil }
        // Decode off main thread
        return await image.preparedForDisplay()
    }

    private nonisolated func saveToDisk(data: Data, url: URL) async {
        let fileURL = diskFileURL(for: url)
        // Store original response bytes — no re-encoding (preserves alpha, format, quality)
        try? data.write(to: fileURL, options: .atomic)
    }

    private nonisolated func removeDiskCache() async {
        let dir = diskCacheDirectory
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
```

---

## Key Design Decisions

### `NSCache` instead of `[URL: PlatformImage]`

`NSCache` is thread-safe and auto-evicts under memory pressure. A plain dictionary:
- Grows unbounded → jetsam kills on older devices
- Is not thread-safe (data race in Swift 6 strict concurrency)
- Does not integrate with OS memory pressure

Set `totalCostLimit` with cost = approximate pixel byte count (`width × height × 4`) so the OS can evict based on actual memory usage, not just object count.

### `SHA256` for disk filenames

Swift's `.hashValue` is **randomly seeded per process** (security feature). Files saved with `hashValue` as the key are never found on the next launch. `SHA256` is stable, collision-resistant, and filename-safe.

```swift
// ✗ Bug: hashValue changes every launch — disk cache never hits
"\(abs(url.absoluteString.hashValue)).jpg"

// ✓ Correct: stable across launches
SHA256.hash(data: Data(url.absoluteString.utf8))
    .compactMap { String(format: "%02x", $0) }.joined()
```

### Store original bytes, not re-encoded JPEG

Re-encoding to JPEG:
- Destroys alpha channels (transparency becomes black/white)
- Degrades PNG, WebP, HEIC quality irreversibly
- Adds encoding CPU cost on every write

Store the raw `Data` from the network response. On cache hit, decode with `PlatformImage(data:)`.

### `preparedForDisplay()` — off-thread decode

Images decode lazily on the main thread when first rendered. In a fast-scrolling list this causes frame drops. The `preparedForDisplay()` helper decodes to a display-ready format on a background thread — via `byPreparingForDisplay()` on iOS, or by rasterizing to `CGImage` on macOS (AppKit has no direct equivalent):

```swift
// Without: image decodes on main thread when rendered — causes hitches
let image = PlatformImage(data: rawData)

// With: decoded on cooperative thread pool — main thread only composites
let image = await PlatformImage(data: rawData)?.preparedForDisplay()
```

### Request coalescing

The `inFlight` dictionary prevents 10 simultaneous requests for the same URL (e.g., the same avatar appearing in 10 list cells). The second through tenth callers await the same `Task` instead of launching 10 network requests.

### `nonisolated` for I/O

Network and disk operations are `nonisolated` so they run on the cooperative thread pool. The actor's serial executor is not held during the wait, meaning other callers can check the memory cache or coalesce while a download is in progress.

---

## Thumbnail Pre-Sizing (Optional)

For thumbnail grids where the display size is much smaller than the source image, decode at the display size to reduce memory and decode cost:

```swift
// iOS — decode at thumbnail size, avoids loading a 4K image to display at 80×80
let thumbnail = await UIImage(data: rawData)?
    .byPreparingThumbnail(ofSize: CGSize(width: 80, height: 80))
```

On macOS (or as a cross-platform alternative), use ImageIO — it decodes at the target size without ever materializing the full image:

```swift
import ImageIO

func thumbnail(from data: Data, maxPixelSize: Int) -> CGImage? {
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        kCGImageSourceCreateThumbnailWithTransform: true
    ]
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}
```

Use thumbnail decoding when:
- The source image resolution is significantly larger than the display rect
- You have many images on screen simultaneously (collection view cells)

---

## Rules

- `actor` (not `@MainActor`) — disk I/O and decoding must not block the main thread
- `NSCache` (not `[URL: PlatformImage]`) — thread-safe, auto-evicting, OS-integrated
- `SHA256` (not `hashValue`) for disk filenames — `hashValue` is randomized per process
- Store original response `Data` to disk — never re-encode to JPEG
- `preparedForDisplay()` for every image before populating the memory cache
- Set `totalCostLimit` on `NSCache` with cost = pixel byte count, not a fixed number
- Coalesce in-flight requests to prevent duplicate downloads for the same URL
- `nonisolated` on I/O methods — keeps the actor's executor free during network/disk waits
