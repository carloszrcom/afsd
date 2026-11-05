# NavigationSplitView — iPad & Mac

## Why NavigationSplitView

- On iPad/Mac: shows 2 or 3 columns side-by-side
- On iPhone (compact width): **collapses automatically** to a full-screen `NavigationStack`
- No `#if` or `@Environment(\.horizontalSizeClass)` needed for basic adaptation
- `NavigationSplitViewVisibility` gives programmatic control over which columns are visible

## 2-Column Layout (Sidebar + Detail)

```swift
// TwoColumnRootView.swift
import SwiftUI

struct TwoColumnRootView: View {
    @State private var selectedItem: Item?
    @State private var detailRouter = DetailRouter()
    @State private var columnVisibility = NavigationSplitViewVisibility.automatic

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // MARK: Sidebar column
            SidebarView(selectedItem: $selectedItem)
                .navigationTitle("Library")
                .navigationSplitViewColumnWidth(min: 220, ideal: 280, max: 320)
        } detail: {
            // MARK: Detail column — NavigationStack for push navigation
            NavigationStack(path: $detailRouter.path) {
                if let item = selectedItem {
                    ItemDetailView(item: item, router: detailRouter)
                } else {
                    ContentUnavailableView(
                        "Select an item",
                        systemImage: "sidebar.left",
                        description: Text("Choose something from the sidebar.")
                    )
                }
            }
            .navigationDestination(for: DetailRouter.Destination.self) { destination in
                switch destination {
                case .relatedItem(let id): RelatedItemView(id: id)
                case .author(let id):      AuthorView(id: id)
                case .settings:            SettingsView()
                }
            }
        }
    }
}
```

## 3-Column Layout (Sidebar + Content + Detail)

```swift
struct ThreeColumnRootView: View {
    @State private var selectedCategory: Category?
    @State private var selectedItem: Item?
    @State private var detailRouter = DetailRouter()
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Column 1: Sidebar
            CategoryListView(selection: $selectedCategory)
                .navigationTitle("Categories")
        } content: {
            // Column 2: Content (driven by sidebar selection)
            if let category = selectedCategory {
                ItemListView(category: category, selection: $selectedItem)
                    .navigationTitle(category.name)
            } else {
                ContentUnavailableView("Select a category", systemImage: "square.grid.2x2")
            }
        } detail: {
            // Column 3: Detail (driven by content selection)
            NavigationStack(path: $detailRouter.path) {
                if let item = selectedItem {
                    ItemDetailView(item: item, router: detailRouter)
                } else {
                    ContentUnavailableView("Select an item", systemImage: "doc.text")
                }
            }
            .navigationDestination(for: DetailRouter.Destination.self) { ... }
        }
    }
}
```

## Programmatic Column Control

```swift
// Show/hide the sidebar programmatically
Button("Toggle Sidebar") {
    columnVisibility = columnVisibility == .detailOnly
        ? .all
        : .detailOnly
}

// On iPhone in compact mode — set which column is shown
NavigationSplitView(preferredCompactColumn: $preferredColumn) { ... }
```

`NavigationSplitViewVisibility` values:
| Value | Behavior |
|-------|----------|
| `.automatic` | System decides based on size class |
| `.all` | Show all columns |
| `.doubleColumn` | Show sidebar + detail (hides content in 3-column) |
| `.detailOnly` | Show only the detail column |

## Split View Style

```swift
NavigationSplitView { ... } detail: { ... }
    .navigationSplitViewStyle(.balanced)       // Equal column widths
    // .navigationSplitViewStyle(.prominentDetail) // Detail gets more space
    // .navigationSplitViewStyle(.automatic)       // Default
```

## Sidebar Selection with @Query or List

```swift
struct SidebarView: View {
    @Binding var selectedItem: Item?
    var items: [Item]  // Or @Query from SwiftData

    var body: some View {
        List(items, selection: $selectedItem) { item in
            Label(item.title, systemImage: item.systemImage)
                .tag(item)
        }
        .listStyle(.sidebar)
    }
}
```

> Use `List(selection:)` — SwiftUI handles the selection highlight automatically.
> `Item` must conform to `Hashable` for `List(selection:)`.

## Adaptive Navigation: One View for All Platforms

`NavigationSplitView` is the single adaptive container. On iPhone, it collapses and
the sidebar becomes a `NavigationLink`-style root with the content column as the
first-level push destination.

```swift
// This single view works on iPhone, iPad, and Mac without modification:
struct RootView: View {
    @State private var selectedItem: Item?

    var body: some View {
        NavigationSplitView {
            ItemListView(selection: $selectedItem)
        } detail: {
            if let item = selectedItem {
                ItemDetailView(item: item)
            } else {
                ContentUnavailableView("Select an item", systemImage: "tray")
            }
        }
    }
}
```

## `navigationDestination(item:)` in Detail Column

Use the `item:` overload (not `for:`) to replace the detail column content without
adding to the push stack — useful when sidebar selection should change the detail
root, not push onto it.

```swift
// Replaces detail content (not a push):
.navigationDestination(item: $selectedItem) { item in
    ItemDetailView(item: item)
}
```

## Rules

- Always place `navigationDestination` on the `NavigationStack` inside the detail column, not on the `NavigationSplitView` itself
- Use `ContentUnavailableView` for the empty detail state — never `EmptyView()`
- `navigationSplitViewColumnWidth` controls only the sidebar/content width, not the detail
- On Mac Catalyst and macOS, `NavigationSplitView` maps to a `NSSplitViewController` automatically
- `preferredCompactColumn` defaults to `.sidebar` — the sidebar is shown first when collapsing on iPhone
