# SwiftUI Image Components

## Choosing the Right Component

| Scenario | Component |
|---|---|
| Profile image, cover art, single image | `AsyncImage` (with URLCache configured) |
| List / grid with many images | `CachedAsyncImage` |
| Thumbnail grid (small display size, large source) | `CachedAsyncImage` with `thumbnailSize` |
| Prefetching before the user scrolls | `ImageCacheManager.shared.prefetch(urls:)` |

---

## `CachedAsyncImage` — Full Component

```swift
// CachedAsyncImage.swift
import SwiftUI

// Bridging PlatformImage → SwiftUI.Image
extension Image {
    init(platformImage: PlatformImage) {
        #if canImport(UIKit)
        self.init(uiImage: platformImage)
        #else
        self.init(nsImage: platformImage)
        #endif
    }
}

struct CachedAsyncImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    var thumbnailSize: CGSize? = nil

    @State private var phase: AsyncImagePhase = .empty

    var body: some View {
        ZStack {
            switch phase {
            case .empty:
                placeholder

            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: contentMode)

            case .failure:
                errorPlaceholder

            @unknown default:
                placeholder
            }
        }
        .task(id: url) {
            await load()
        }
    }

    // MARK: - Loading

    private func load() async {
        guard let url else {
            phase = .failure(URLError(.badURL))
            return
        }

        let image = await ImageCacheManager.shared.image(for: url)

        if let image {
            phase = .success(Image(platformImage: image))
        } else {
            phase = .failure(URLError(.cannotLoadFromNetwork))
        }
    }

    // MARK: - Placeholders

    private var placeholder: some View {
        Rectangle()
            .fill(.quaternary)   // cross-platform; Color(.systemGray6) is UIKit-only
            .overlay {
                ProgressView()
                    .tint(.secondary)
            }
    }

    private var errorPlaceholder: some View {
        Rectangle()
            .fill(.tertiary)
            .overlay {
                Image(systemName: "photo.fill")
                    .foregroundStyle(.quaternary)
                    .font(.title2)
            }
    }
}
```

### Key design choices

**`.task(id: url)`** — cancels and restarts the load task whenever `url` changes. This is critical in `List` cells that are reused across different items: if cell A is reused for item B while A's image is still loading, the old task is cancelled and B's load starts immediately. Without `id: url`, the old task continues and may overwrite B's image with A's.

**`AsyncImagePhase`** — reuses SwiftUI's existing type for the three display states, ensuring compatibility with existing code that uses `AsyncImage`.

---

## Usage

### Basic usage in a list

```swift
struct ArticleRow: View {
    let article: Article

    var body: some View {
        HStack(spacing: 12) {
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

### Thumbnail grid (pre-sized decode)

When displaying many images in a grid, pass `thumbnailSize` matching the display rect to reduce memory pressure — thumbnail decoding (`byPreparingThumbnail(ofSize:)` on iOS, ImageIO on macOS; see image-cache-manager.md) decodes at the target size, not full resolution:

```swift
// CachedAsyncImage extended for thumbnails
struct CachedAsyncImage: View {
    // ... existing code ...

    private func load() async {
        guard let url else { phase = .failure(URLError(.badURL)); return }

        let image: PlatformImage?
        if let size = thumbnailSize {
            image = await ImageCacheManager.shared.thumbnail(for: url, size: size)
        } else {
            image = await ImageCacheManager.shared.image(for: url)
        }

        phase = image.map { .success(Image(platformImage: $0)) }
            ?? .failure(URLError(.cannotLoadFromNetwork))
    }
}

// Grid usage
LazyVGrid(columns: Array(repeating: .init(.flexible()), count: 3)) {
    ForEach(photos) { photo in
        CachedAsyncImage(
            url: URL(string: photo.url),
            contentMode: .fill,
            thumbnailSize: CGSize(width: 120, height: 120)
        )
        .frame(width: 120, height: 120)
        .clipped()
    }
}
```

---

## Prefetching in a List

Prefetch upcoming images before the user scrolls to them using `onAppear` on cells near the bottom, or with `LazyVStack`'s natural loading:

```swift
struct PhotoFeedView: View {
    @State private var photos: [Photo] = []

    var body: some View {
        List(photos) { photo in
            CachedAsyncImage(url: URL(string: photo.url))
                .frame(height: 300)
                .onAppear {
                    prefetchNearby(photo)
                }
        }
    }

    private func prefetchNearby(_ photo: Photo) {
        guard let index = photos.firstIndex(where: { $0.id == photo.id }) else { return }
        let lookAhead = 5
        let end = min(index + lookAhead, photos.count)
        let upcomingURLs = photos[index..<end]
            .compactMap { URL(string: $0.url) }
        ImageCacheManager.shared.prefetch(urls: upcomingURLs)
    }
}
```

---

## When `AsyncImage` Is Enough

For images that appear outside of fast-scrolling contexts, the built-in `AsyncImage` is appropriate — it uses `URLSession.shared` which uses `URLCache` for HTTP-level caching:

```swift
// Profile screen — single image, not in a scrolling list
AsyncImage(url: URL(string: user.avatarURL)) { phase in
    switch phase {
    case .success(let image):
        image
            .resizable()
            .scaledToFill()
            .clipShape(Circle())
    case .failure:
        Image(systemName: "person.circle.fill")
            .foregroundStyle(.secondary)
            .font(.largeTitle)
    case .empty:
        ProgressView()
    @unknown default:
        EmptyView()
    }
}
.frame(width: 60, height: 60)
```

`AsyncImage` requires `URLCache.shared` to be configured with adequate capacity (see url-cache-and-urlsession.md). Without this, `AsyncImage` uses the default 10 MB disk cache which is too small for most apps.

---

## Logging

```swift
// Add to your app's Logger extension
extension Logger {
    static let imageCache = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "",
        category: "ImageCache"
    )
}

// Levels used in ImageCacheManager:
// .debug  — memory/disk hits (high volume, debug builds only)
// .info   — network downloads (production-relevant events)
// .warning — unexpected server responses
// .error  — download failures
```

---

## Rules

- Use `.task(id: url)` in list cell components — cancels stale loads when cells are reused
- Never use `.onAppear { Task { } }` for image loading in list cells — the task is not cancelled when the cell disappears or is reused
- Pass `thumbnailSize` matching the display rect for grids — avoids decoding full-resolution images only to downscale
- Call `prefetch(urls:)` on upcoming items `onAppear` for feeds — hides network latency
- `CachedAsyncImage` for lists; `AsyncImage` for isolated images — pick the right tool for the context
- All three states (loading, success, failure) must have a placeholder — never show an empty view during loading
