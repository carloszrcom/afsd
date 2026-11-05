# Tab Navigation — iOS 18 API

## Why the New API

The old `tabItem {}` API still works but cannot support:
- Typed tab selection with custom value types
- `sidebarAdaptable` style (sidebar on iPad, tab bar on iPhone)
- User-customizable tab ordering persisted across launches (`TabViewCustomization`)
- `TabSection` for grouped tabs in the sidebar
- `TabRole.search` for proper search tab behavior

All medium and large apps targeting iOS 18+ should use the `Tab {}` struct API.

## AppTab Enum

```swift
// AppTab.swift
import Foundation

enum AppTab: String, Hashable, CaseIterable {
    case home
    case library
    case search
    case profile
    case settings
}
```

`String` raw value → compatible with `TabViewCustomization` persistence.
`CaseIterable` → useful for deep link tab resolution.

## MainTabView — Full Implementation

```swift
// MainTabView.swift
import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home
    @AppStorage("tabCustomization") private var tabCustomization: TabViewCustomization

    // Per-tab routers — each tab is an independent navigation flow
    @State private var homeRouter     = HomeRouter()
    @State private var libraryRouter  = LibraryRouter()

    var body: some View {
        TabView(selection: $selectedTab) {

            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeNavigationView(router: homeRouter)
            }
            .customizationID("com.app.tab.home")

            Tab("Library", systemImage: "books.vertical", value: AppTab.library) {
                LibraryNavigationView(router: libraryRouter)
            }
            .customizationID("com.app.tab.library")

            // Search tab — special role, always visible and non-removable by default
            Tab(value: AppTab.search, role: .search) {
                SearchView()
            }

            Tab("Profile", systemImage: "person.circle", value: AppTab.profile) {
                ProfileNavigationView()
            }
            .customizationID("com.app.tab.profile")

            // Settings — pinned, cannot be moved or removed
            Tab("Settings", systemImage: "gear", value: AppTab.settings) {
                SettingsView()
            }
            .customizationID("com.app.tab.settings")
            .customizationBehavior(.disabled, for: .sidebar, .tabBar)

        }
        // On iPad: shows as a sidebar with tabs listed vertically + tab bar toggle
        // On iPhone: shows as the standard tab bar
        .tabViewStyle(.sidebarAdaptable)
        // Persist user customizations (reordering, hiding) across launches
        .tabViewCustomization($tabCustomization)
    }
}
```

## TabSection — Grouped Tabs in Sidebar

On iPad with `.sidebarAdaptable`, tabs can be grouped under section headers:

```swift
TabView(selection: $selectedTab) {
    Tab("Home", systemImage: "house", value: AppTab.home) {
        HomeView()
    }

    TabSection("Content") {
        Tab("Articles", systemImage: "newspaper", value: AppTab.articles) {
            ArticlesView()
        }
        .customizationID("com.app.tab.articles")

        Tab("Videos", systemImage: "play.rectangle", value: AppTab.videos) {
            VideosView()
        }
        .customizationID("com.app.tab.videos")
    }
    .defaultVisibility(.hidden, for: .tabBar)  // Section header only in sidebar

    Tab(value: AppTab.search, role: .search) { SearchView() }
}
.tabViewStyle(.sidebarAdaptable)
```

## Tab Visibility and Customization Behavior

```swift
Tab("Beta Feature", systemImage: "flask", value: AppTab.beta) {
    BetaView()
}
.customizationID("com.app.tab.beta")
// Hidden by default in tab bar, visible in sidebar — user can enable it
.defaultVisibility(.hidden, for: .tabBar)

Tab("Admin", systemImage: "lock.shield", value: AppTab.admin) {
    AdminView()
}
// Cannot be hidden or moved by user
.customizationBehavior(.disabled, for: .sidebar, .tabBar)
```

`customizationBehavior(_:for:)` options:
| Value | Effect |
|-------|--------|
| `.default` | User can reorder and hide |
| `.disabled` | Tab is pinned — cannot be moved or hidden |
| `.reorderable` | User can reorder but not hide |

## Programmatic Tab Switching (for Deep Links)

```swift
// Switch tab programmatically — from a DeepLinkHandler or button
selectedTab = .library

// Then push a destination in that tab's router:
libraryRouter.navigate(to: .item(id: "book-123"))
```

Share `selectedTab` and routers via `@Environment` (using `@Entry`) for access from deeply nested views:

```swift
extension EnvironmentValues {
    @Entry var selectedTab: Binding<AppTab> = .constant(.home)
}

// In MainTabView:
.environment(\.selectedTab, $selectedTab)

// In a child view that needs to switch tabs:
@Environment(\.selectedTab) private var selectedTab
Button("Go to Library") { selectedTab.wrappedValue = .library }
```

## Tab Badge

```swift
Tab("Inbox", systemImage: "tray", value: AppTab.inbox) {
    InboxView()
}
.badge(unreadCount > 0 ? "\(unreadCount)" : nil)
// Or for a simple dot badge:
.badge(hasNewContent)
```

## Rules

- Use `Tab {}` struct API on iOS 18+; the old `tabItem {}` approach works but loses sidebar adaptability and customization
- `customizationID` must be globally unique (use reverse-DNS format)
- `TabRole.search` should only be used for the search tab — it affects placement and system behavior
- `@AppStorage` for `TabViewCustomization` persists across launches; `@State` resets on relaunch
- Each tab gets its own `NavigationStack` and Router — never share a router between tabs
- Tapping an already-selected tab should pop to root: implement `navigateToRoot()` in the router and call it on tab re-selection
- `TabSection` header only appears in the sidebar on iPad; on iPhone it collapses to a standard flat tab bar

## Tab Re-selection → Pop to Root

```swift
TabView(selection: $selectedTab) {
    Tab("Home", systemImage: "house", value: AppTab.home) {
        HomeNavigationView(router: homeRouter)
    }
}
.onChange(of: selectedTab) { oldTab, newTab in
    // If user taps the already-selected tab, pop to root
    guard oldTab == newTab else { return }
    switch newTab {
    case .home:    homeRouter.navigateToRoot()
    case .library: libraryRouter.navigateToRoot()
    default: break
    }
}
```
