# Deep Linking

## Overview

A production deep-link system needs:
1. A URL parser abstraction (no inline `if url.pathComponents.contains(...)`)
2. `handlesExternalEvents` at the Scene level for multi-window iPadOS/macOS
3. Tab switching before path pushing (cold-launch and warm-launch)
4. `@MainActor` isolation for all router mutations

## URL Scheme / Universal Link Structure

```
myapp://home/items/item-42
myapp://library/authors/user-99
myapp://settings
```

Map scheme paths to typed `DeepLink` cases:

```swift
// DeepLink.swift
import Foundation

enum DeepLink: Sendable {
    case home
    case item(id: String)
    case author(userId: String)
    case settings
}

extension DeepLink {
    /// Returns nil for unrecognized URLs — never crash on bad input.
    init?(url: URL) {
        guard url.scheme == "myapp" || url.host == "myapp.com" else { return nil }
        let components = url.pathComponents.filter { $0 != "/" }

        switch (url.host ?? url.scheme, components) {
        case (_, []):
            self = .home
        case (_, ["items", let id]):
            self = .item(id: id)
        case (_, ["library", "authors", let userId]):
            self = .author(userId: userId)
        case (_, ["settings"]):
            self = .settings
        default:
            return nil
        }
    }
}
```

## DeepLinkHandler

Central handler on `@MainActor`. Holds the routers by reference (they are classes, so
the same instances are mutated) and `selectedTab` as a `Binding` so changes propagate
back to the view that owns it.

```swift
// DeepLinkHandler.swift
import SwiftUI

@Observable
@MainActor
final class DeepLinkHandler {
    // Routers are reference types — storing them here mutates the same instances
    // the view observes. No copy issue.
    private let homeRouter: HomeRouter
    private let libraryRouter: LibraryRouter

    // Binding<AppTab>: writes propagate back to the @State in MainTabView.
    // Storing AppTab by value here would create a copy — changes would be lost.
    private let selectTab: (AppTab) -> Void

    init(
        homeRouter: HomeRouter,
        libraryRouter: LibraryRouter,
        selectTab: @escaping (AppTab) -> Void
    ) {
        self.homeRouter    = homeRouter
        self.libraryRouter = libraryRouter
        self.selectTab     = selectTab
    }

    func handle(_ url: URL) {
        guard let deepLink = DeepLink(url: url) else { return }
        handle(deepLink)
    }

    func handle(_ deepLink: DeepLink) {
        switch deepLink {
        case .home:
            selectTab(.home)
            homeRouter.navigateToRoot()

        case .item(let id):
            selectTab(.home)
            homeRouter.navigateToRoot()
            homeRouter.navigate(to: .itemDetail(id: id))

        case .author(let userId):
            selectTab(.library)
            libraryRouter.navigateToRoot()
            libraryRouter.navigate(to: .author(userId: userId))

        case .settings:
            selectTab(.settings)
        }
    }
}
```

## Wiring in the App

Create `DeepLinkHandler` once as `@State` — not as a `computed var` (which would
recreate it on every render, losing any stored state like `pendingDeepLink`).

```swift
// MainTabView.swift
import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home
    @State private var homeRouter     = HomeRouter()
    @State private var libraryRouter  = LibraryRouter()

    // Created once; routers are passed by reference, tab selection via closure
    @State private var deepLinkHandler: DeepLinkHandler?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeNavigationView(router: homeRouter)
            }
            Tab("Library", systemImage: "books.vertical", value: AppTab.library) {
                LibraryNavigationView(router: libraryRouter)
            }
            // ... other tabs
        }
        .tabViewStyle(.sidebarAdaptable)
        .onAppear {
            // Initialize once — after @State properties are available
            if deepLinkHandler == nil {
                deepLinkHandler = DeepLinkHandler(
                    homeRouter: homeRouter,
                    libraryRouter: libraryRouter,
                    selectTab: { [self] tab in selectedTab = tab }
                )
            }
        }
        .onOpenURL { url in
            deepLinkHandler?.handle(url)
        }
    }
}
```

> `onOpenURL` is called on the main actor — no `Task` or `DispatchQueue.main` needed.
>
> **Why not a `computed var`?** A `computed var` recreates the handler on every render.
> This loses any stored state (e.g., `pendingDeepLink`) and breaks identity-based caching.
> Use `@State` and initialize lazily in `onAppear`.

## Scene-Level Handling (Multi-Window iPadOS / macOS)

For apps with multiple windows, route external URLs to the correct scene using
`handlesExternalEvents` on the `WindowGroup`:

```swift
// MyApp.swift
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        // Direct all URLs to this WindowGroup
        .handlesExternalEvents(matching: ["*"])
    }
}
```

For multiple window types:

```swift
WindowGroup("Main") {
    MainTabView()
}
.handlesExternalEvents(matching: ["myapp"])

WindowGroup("Settings") {
    SettingsView()
}
.handlesExternalEvents(matching: ["myapp://settings*"])
```

## Cold-Launch Handling

When the app is not running and a deep link opens it, `onOpenURL` fires after
the view appears. The `DeepLinkHandler` must handle the case where navigation
state is not yet fully initialized.

Pattern: delay the router push until after `NavigationState` has transitioned to `.main`:

```swift
// Store the pending deep link until navigation is ready
@Observable
@MainActor
final class NavigationState {
    enum Route { case loader, onboarding, main }
    var currentRoute: Route = .loader
    var pendingDeepLink: DeepLink?

    func start(isAuthenticated: Bool) async {
        try? await Task.sleep(for: .seconds(1))
        withAnimation(.smooth) {
            currentRoute = isAuthenticated ? .main : .onboarding
        }
    }

    func processPendingDeepLink(with handler: DeepLinkHandler) {
        guard let link = pendingDeepLink else { return }
        pendingDeepLink = nil
        handler.handle(link)
    }
}

// In ContentView:
.onOpenURL { url in
    guard let deepLink = DeepLink(url: url) else { return }
    if navState.currentRoute == .main {
        deepLinkHandler.handle(deepLink)
    } else {
        navState.pendingDeepLink = deepLink
    }
}
.onChange(of: navState.currentRoute) { _, newRoute in
    if newRoute == .main {
        navState.processPendingDeepLink(with: deepLinkHandler)
    }
}
```

## Universal Links (HTTPS)

For Universal Links, the URL scheme is `https://yourdomain.com/path`.
The `DeepLink.init?(url:)` parser above handles both:

```swift
// myapp://items/42       → custom scheme
// https://myapp.com/items/42  → universal link
init?(url: URL) {
    let isCustomScheme = url.scheme == "myapp"
    let isUniversalLink = url.host == "myapp.com"
    guard isCustomScheme || isUniversalLink else { return nil }
    // ... parse path components
}
```

## Rules

- Never parse URLs with inline `if/else` chains — use `DeepLink.init?(url:)` for centralized, testable parsing
- `DeepLink` must be `Sendable` — it may originate from a background scene event
- Always call `navigateToRoot()` on the target router before pushing a deep link destination — prevents stacking on a pre-existing path
- `onOpenURL` is `@MainActor` — no `Task` wrapper needed to call router methods
- Test `DeepLink.init?(url:)` with unit tests covering all cases, including malformed URLs
- For cold-launch: store the pending `DeepLink` and process it once the app reaches the `.main` route
