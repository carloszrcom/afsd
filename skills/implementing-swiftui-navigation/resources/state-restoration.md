# State Restoration

## Goal

When the user relaunches the app (or switches back from another app on iPad), restore
the exact navigation stack they had — same tab, same pushed screens, same positions.

## How It Works

1. `NavigationPath` has a `.codable` property that returns a `CodableRepresentation`
2. Encode it to `Data` with `JSONEncoder`
3. Store in `@SceneStorage` (per-window, unlike `@AppStorage` which is global)
4. On init, decode from `SceneStorage` and pass to the router's initializer

> `NavigationPath.codable` returns `nil` if any element in the path is non-`Codable`.
> **All `Destination` enum cases must be `Codable`** for this to work.

## Router with Built-in Restoration Support

```swift
// HomeRouter.swift
import SwiftUI

@Observable
@MainActor
final class HomeRouter {

    enum Destination: Codable, Hashable, Sendable {
        case itemDetail(id: String)   // String: Codable ✓
        case profile(userId: String)  // String: Codable ✓
        case settings                 // No associated value ✓
    }

    var path = NavigationPath()

    func navigate(to destination: Destination) { path.append(destination) }
    func navigateBack() { if !path.isEmpty { path.removeLast() } }
    func navigateToRoot() { path.removeLast(path.count) }

    // MARK: - Persistence

    /// Encodes the current navigation path for storage.
    /// Returns nil if any element is non-Codable.
    func encodedPath() -> Data? {
        guard let representation = path.codable else { return nil }
        return try? JSONEncoder().encode(representation)
    }

    /// Restores the navigation path from previously encoded data.
    init(restoredData: Data? = nil) {
        guard let data = restoredData,
              let representation = try? JSONDecoder().decode(
                  NavigationPath.CodableRepresentation.self, from: data
              )
        else { return }
        self.path = NavigationPath(representation)
    }
}
```

## Connecting Router to SceneStorage in the View

```swift
// HomeNavigationView.swift
import SwiftUI

struct HomeNavigationView: View {
    // SceneStorage: per-window storage, auto-cleared when scene is discarded
    @SceneStorage("homeNavPath") private var pathData: Data?

    // Router initialized with persisted data on first render
    @State private var router: HomeRouter

    init() {
        // Can't read @SceneStorage here (not yet available in init)
        // Initialize empty — restoration happens in onAppear
        _router = State(initialValue: HomeRouter())
    }

    var body: some View {
        NavigationStack(path: $router.path) {
            HomeListView(router: router)
                .navigationDestination(for: HomeRouter.Destination.self) { destination in
                    switch destination {
                    case .itemDetail(let id):   ItemDetailView(id: id)
                    case .profile(let userId):  ProfileView(userId: userId)
                    case .settings:             SettingsView()
                    }
                }
        }
        // Save path whenever it changes
        .onChange(of: router.path) {
            pathData = router.encodedPath()
        }
        // Restore path once SceneStorage is available
        .onAppear {
            guard router.path.isEmpty, let data = pathData else { return }
            router = HomeRouter(restoredData: data)
        }
    }
}
```

## SceneStorage vs AppStorage

| | `@SceneStorage` | `@AppStorage` |
|---|---|---|
| Scope | Per-window (scene) | Global (app-wide) |
| iPad multi-window | Each window has its own value | Shared across all windows |
| Cleared when | Scene is discarded by the system | Manually or app uninstall |
| Use for | Navigation paths, scroll position, selection | User preferences, settings |

> Always use `SceneStorage` for navigation state — using `AppStorage` would share the same path across all iPad windows, which is wrong.

## SceneStorage Key Naming

Use unique, descriptive keys. On iPad, multiple windows each maintain their own copy.

```swift
@SceneStorage("com.app.homeNavPath")    private var homePathData: Data?
@SceneStorage("com.app.libraryNavPath") private var libraryPathData: Data?
```

## Per-Tab Restoration in MainTabView

Each tab's root view manages its own `@SceneStorage` independently:

```swift
// HomeNavigationView.swift
@SceneStorage("com.app.homeNavPath") private var pathData: Data?

// LibraryNavigationView.swift
@SceneStorage("com.app.libraryNavPath") private var pathData: Data?
```

Also restore the selected tab:

```swift
// MainTabView.swift
@SceneStorage("com.app.selectedTab") private var selectedTabRaw: String = AppTab.home.rawValue

private var selectedTab: AppTab {
    get { AppTab(rawValue: selectedTabRaw) ?? .home }
    set { selectedTabRaw = newValue.rawValue }
}
```

> `@SceneStorage` supports: `Bool`, `Int`, `Double`, `String`, `URL`, `Data`.
> For `AppTab`, store the `rawValue: String` and decode on read.

## Handling Non-Codable Elements

If a `Destination` case has a non-`Codable` associated value (e.g., a complex model object),
`path.codable` returns `nil` and restoration fails silently.

Solutions:
1. Use only primitive `Codable` types (`String`, `Int`, `UUID`) as associated values — fetch the full model in the destination view
2. Implement `Codable` on the associated type explicitly
3. Accept that this destination cannot be restored (design choice)

```swift
// Good: use ID, fetch in destination view
case itemDetail(id: String)   // ✓ Codable

// Bad: full model object may not be Codable
case itemDetail(item: Item)   // ✗ Only works if Item: Codable
```

## Rules

- All `Destination` enum cases must be `Codable` for `path.codable` to return a non-nil value
- `@SceneStorage` key must be unique per stored value — collisions cause data corruption
- Only call `router = HomeRouter(restoredData: data)` if `router.path.isEmpty` — prevents overwriting user navigation after restoration
- `SceneStorage` data is erased by the system when available storage is low — handle the case where restoration data is nil gracefully (the app just opens to the root)
- Do not store sensitive data in `SceneStorage` — it persists across launches and is not encrypted
