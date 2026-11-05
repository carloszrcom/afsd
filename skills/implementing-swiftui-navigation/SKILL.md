---
name: implementing-swiftui-navigation
description: Implements SwiftUI navigation using NavigationStack, NavigationPath, and @Observable routers. Covers programmatic navigation, deep linking, modal presentation, and tab-based flows. Use when creating navigation flows, routers, deep links, or modal presentations in SwiftUI.
---

# SwiftUI Navigation — Professional Patterns

## Context
- iOS 26+, iPadOS 26+, macOS 26+, Swift 6.2, strict concurrency
- `NavigationStack` for iPhone; `NavigationSplitView` for iPad/Mac (collapses automatically on compact width)
- All routers: `@Observable @MainActor final class`
- `Destination` enum must be `Codable, Hashable, Sendable`

## Architecture Overview

```
App
├── NavigationState (loader → onboarding → main)
│
└── MainTabView  (iOS 18 Tab API, sidebarAdaptable)
    ├── Tab: Home
    │   ├── HomeRouter  (@MainActor, NavigationPath + state restoration)
    │   └── SheetRouter (typed SheetDestination enum)
    │       └── NavigationSplitView (iPad) / NavigationStack (iPhone)
    │           ├── Sidebar / List
    │           └── Detail + navigationDestination
    ├── Tab: Library  (same pattern)
    ├── Tab: Search   (TabRole.search)
    └── Tab: Settings (customizationBehavior: .disabled)
```

## Concurrency Isolation

| Component | Isolation | Reason |
|-----------|-----------|--------|
| Router | `@MainActor` | Mutates `NavigationPath` which drives UI |
| SheetRouter | `@MainActor` | Mutates presentation state |
| NavigationState | `@MainActor` | Controls app-level transitions |
| Destination enum | `Sendable` | Crosses actor boundaries in deep links |
| DeepLinkHandler | `@MainActor` | Calls router mutating methods |

## Architecture Layers

Full code with rules and decisions for each area:

- **Router, NavigationStack, state restoration** → [resources/router-and-navigation-stack.md](resources/router-and-navigation-stack.md)
- **NavigationSplitView for iPad/Mac** → [resources/navigation-split-view.md](resources/navigation-split-view.md)
- **Sheets, detents, modals & popovers** → [resources/sheet-and-modal.md](resources/sheet-and-modal.md)
- **iOS 18 Tab navigation & sidebarAdaptable** → [resources/tab-navigation.md](resources/tab-navigation.md)
- **Deep linking & external events** → [resources/deep-linking.md](resources/deep-linking.md)
- **State restoration with SceneStorage** → [resources/state-restoration.md](resources/state-restoration.md)

## Core Router Pattern

```swift
// HomeRouter.swift
import SwiftUI

@Observable
@MainActor
final class HomeRouter {
    enum Destination: Codable, Hashable, Sendable {
        case detail(id: String)
        case settings
        case profile(userId: String)
    }

    var path = NavigationPath()

    func navigate(to destination: Destination) { path.append(destination) }
    func navigateBack() { if !path.isEmpty { path.removeLast() } }
    func navigateToRoot() { path.removeLast(path.count) }

    // State restoration — see resources/state-restoration.md
    func encodedPath() -> Data? {
        try? path.codable.flatMap { try JSONEncoder().encode($0) }
    }

    init(restoredData: Data? = nil) {
        if let data = restoredData,
           let rep = try? JSONDecoder().decode(
               NavigationPath.CodableRepresentation.self, from: data) {
            path = NavigationPath(rep)
        }
    }
}
```

## Typed Sheet Router (replaces `AnyView` anti-pattern)

```swift
// SheetRouter.swift
enum SheetDestination: Identifiable, Hashable {
    case createItem
    case editItem(Item)
    case settings

    var id: String {
        switch self {
        case .createItem:       "createItem"
        case .editItem(let i):  "edit-\(i.id)"
        case .settings:         "settings"
        }
    }
}

@Observable
@MainActor
final class SheetRouter {
    var destination: SheetDestination?
    func present(_ destination: SheetDestination) { self.destination = destination }
    func dismiss() { destination = nil }
}

// Usage in view:
.sheet(item: $sheetRouter.destination) { destination in
    switch destination {
    case .createItem:         CreateItemView()
    case .editItem(let item): EditItemView(item: item)
    case .settings:           SettingsView()
    }
}
```

## Adaptive Container (iPhone + iPad in one codebase)

`NavigationSplitView` collapses to a full-screen stack automatically in compact width (iPhone).
No `#if` or size class checks needed.

```swift
struct RootView: View {
    @State private var router = HomeRouter()
    @State private var selectedItem: Item?

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selectedItem)
        } detail: {
            NavigationStack(path: $router.path) {
                if let item = selectedItem {
                    DetailView(item: item)
                } else {
                    ContentUnavailableView("Select an item", systemImage: "sidebar.left")
                }
            }
            .navigationDestination(for: HomeRouter.Destination.self) { destination in
                switch destination {
                case .detail(let id):       ItemDetailView(id: id)
                case .settings:             SettingsView()
                case .profile(let userId):  ProfileView(userId: userId)
                }
            }
        }
    }
}
```

## iOS 18 Tab Navigation

```swift
enum AppTab: String, Hashable { case home, library, search, settings }

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home
    @AppStorage("tabCustomization") private var tabCustomization: TabViewCustomization

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeRootView()
            }
            .customizationID("com.app.tab.home")

            Tab("Library", systemImage: "books.vertical", value: AppTab.library) {
                LibraryRootView()
            }
            .customizationID("com.app.tab.library")

            Tab(value: AppTab.search, role: .search) {
                SearchView()
            }

            Tab("Settings", systemImage: "gear", value: AppTab.settings) {
                SettingsView()
            }
            .customizationBehavior(.disabled, for: .sidebar, .tabBar)
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabViewCustomization($tabCustomization)
    }
}
```

## Zoom Transition (iOS 18)

```swift
struct ItemListView: View {
    @Namespace private var namespace

    var body: some View {
        List(items) { item in
            NavigationLink(value: item) {
                ItemThumbnailView(item: item)
                    .matchedTransitionSource(id: item.id, in: namespace)
            }
        }
        .navigationDestination(for: Item.self) { item in
            ItemDetailView(item: item)
                .navigationTransition(.zoom(sourceID: item.id, in: namespace))
        }
    }
}
```

## App-Level Flow (loader → onboarding → app)

```swift
@Observable
@MainActor
final class NavigationState {
    enum Route { case loader, onboarding, main }
    var currentRoute: Route = .loader

    func start(isAuthenticated: Bool) async {
        try? await Task.sleep(for: .seconds(1))
        withAnimation(.smooth) {
            currentRoute = isAuthenticated ? .main : .onboarding
        }
    }
}

struct ContentView: View {
    @State private var navState = NavigationState()

    var body: some View {
        Group {
            switch navState.currentRoute {
            case .loader:     LoaderView()
            case .onboarding: OnboardingView()
            case .main:       MainTabView()
            }
        }
        .task { await navState.start(isAuthenticated: Auth.shared.isAuthenticated) }
    }
}
```

## @Entry for Custom Navigation Environment Values

```swift
extension EnvironmentValues {
    @Entry var selectedTab: AppTab = .home
    @Entry var sheetRouter: SheetRouter? = nil
}

// App entry point
.environment(\.sheetRouter, sheetRouter)

// Child view — no dependency on parent type
@Environment(\.sheetRouter) private var sheetRouter
```

## Absolute Rules

### Never:
- Use `NavigationView` — deprecated since iOS 16
- Store `AnyView` in routers — use typed `Destination` or `SheetDestination` enum
- Use `ObservableObject` / `@StateObject` for routers — use `@Observable` + `@State`
- Use `NavigationLink` with inline destination — use `navigationDestination(for:)`
- Declare `navigationDestination` more than once per `NavigationStack`
- Use `Button { Task { await router.navigate(...) } }` — router is `@MainActor`, mutate directly
- Use old `tabItem {}` API on iOS 18+ — use `Tab {}` struct
- Pass routers as `@Binding` — pass them as direct properties (reference types)
- Use `AppStorage` for navigation path — use `SceneStorage` (per-window, not global)

### Always:
- `Destination` enum: `Codable, Hashable, Sendable`
- `@MainActor` on all router classes
- Validate `!path.isEmpty` before `path.removeLast()`
- One `NavigationStack` per independent navigation flow
- One `SheetRouter` per screen scope (not a global singleton)
- Use `sheet(item:)` over `sheet(isPresented:)` for typed data
- Use `SceneStorage` for navigation path state restoration
- `sheet(item:)` resets `destination` to `nil` automatically on user swipe-dismiss — `SheetRouter.dismiss()` handles programmatic dismissal; no extra reset needed at the call site

## Implementation Checklist

### Priority 1 — Core:
- [ ] `Router`: `@Observable @MainActor final class`, `NavigationPath`, `navigate/back/toRoot`
- [ ] `Destination` enum: `Codable, Hashable, Sendable`
- [ ] `NavigationStack(path: $router.path)` in view
- [ ] `navigationDestination(for: Router.Destination.self)` — exhaustive switch
- [ ] `SheetRouter` with typed `SheetDestination: Identifiable`
- [ ] `.sheet(item: $sheetRouter.destination)` — exhaustive switch

### Priority 2 — iPad/Mac:
- [ ] `NavigationSplitView` with sidebar + detail columns
- [ ] `NavigationSplitViewVisibility` binding for programmatic column control
- [ ] `NavigationStack` inside detail column for push navigation
- [ ] Sidebar selection via `Binding<Item?>` (drives detail content)

### Priority 3 — Production:
- [ ] State restoration: `NavigationPath.CodableRepresentation` + `SceneStorage`
- [ ] iOS 18 `Tab {}` API with `AppTab` enum + `.sidebarAdaptable`
- [ ] `TabViewCustomization` persisted via `@AppStorage`
- [ ] Tab re-selection → pop to root: `.onChange(of: selectedTab)` + `router.navigateToRoot()`
- [ ] Deep link handler: `@State DeepLinkHandler` (not `computed var`), routers by reference, tab via closure
- [ ] `NavigationState` for app-level flow transitions + `pendingDeepLink` for cold-launch
- [ ] `@Entry` for shared navigation state via `Environment`
- [ ] Zoom transition: `@Namespace` + `matchedTransitionSource` + `navigationTransition(.zoom)`
- [ ] Sheet detents: `presentationDetents`, `presentationBackgroundInteraction`, `interactiveDismissDisabled`
- [ ] Custom back button for onboarding/modal flows: `navigationBarBackButtonHidden` + `ToolbarItem(.navigationBarLeading)`
