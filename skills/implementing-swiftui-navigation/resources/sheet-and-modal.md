# Sheets, Modals & Popovers

## The `SheetRouter` Pattern (Typed, No AnyView)

The `AnyView` approach (`FullScreenRouter` from the old skill) breaks type inference,
SwiftUI diffing, and prevents compiler-checked exhaustiveness. Use a typed enum instead.

```swift
// SheetRouter.swift
import SwiftUI

enum SheetDestination: Identifiable, Hashable {
    case createItem
    case editItem(Item)
    case shareItem(Item)
    case settings
    case userProfile(userId: String)

    // id must be stable and unique per enum case+data combination
    var id: String {
        switch self {
        case .createItem:           "createItem"
        case .editItem(let item):   "edit-\(item.id)"
        case .shareItem(let item):  "share-\(item.id)"
        case .settings:             "settings"
        case .userProfile(let id):  "profile-\(id)"
        }
    }
}

@Observable
@MainActor
final class SheetRouter {
    var destination: SheetDestination?

    func present(_ destination: SheetDestination) {
        self.destination = destination
    }

    func dismiss() {
        destination = nil
    }
}
```

```swift
// In your view:
.sheet(item: $sheetRouter.destination) { destination in
    switch destination {
    case .createItem:
        CreateItemView()
    case .editItem(let item):
        EditItemView(item: item)
    case .shareItem(let item):
        ShareView(item: item)
            .presentationDetents([.medium])
    case .settings:
        SettingsView()
    case .userProfile(let userId):
        NavigationStack {
            ProfileView(userId: userId)
        }
    }
}
```

## Sheet Presentation Modifiers

Apply these modifiers **inside** the sheet content (not on `.sheet` itself):

```swift
.sheet(item: $sheetRouter.destination) { destination in
    SheetContent(destination: destination)
        // Detents: user can drag between .medium and .large
        .presentationDetents([.medium, .large], selection: $selectedDetent)

        // Allow interaction with content behind the half-height sheet
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))

        // Show the drag indicator at the top
        .presentationDragIndicator(.visible)

        // Blurred background material
        .presentationBackground(.ultraThinMaterial)

        // Disable swipe-to-dismiss when user has unsaved changes
        .interactiveDismissDisabled(destination.hasUnsavedChanges)

        // Compact presentation override (iPhone landscape, etc.)
        .presentationCompactAdaptation(.fullScreenCover)
}
```

### Custom Detent Heights

```swift
.presentationDetents([
    .height(200),           // Fixed height in points
    .fraction(0.4),         // 40% of screen height
    .medium,                // ~50% of screen height
    .large                  // Full screen (default)
])
```

## Full-Screen Cover

Use `fullScreenCover(item:)` for flows that should not be dismissed by swiping:
onboarding, authentication, media player, camera.

```swift
enum FullScreenDestination: Identifiable {
    case onboarding
    case camera
    case mediaPlayer(url: URL)

    var id: String {
        switch self {
        case .onboarding:              "onboarding"
        case .camera:                  "camera"
        case .mediaPlayer(let url):    "player-\(url)"
        }
    }
}

.fullScreenCover(item: $fullScreenDestination) { destination in
    switch destination {
    case .onboarding:
        OnboardingFlow()
    case .camera:
        CameraView()
    case .mediaPlayer(let url):
        MediaPlayerView(url: url)
    }
}
```

## Popover (iPad / Mac)

On iPhone, `popover` falls back to a sheet automatically. On iPad/Mac it shows as a true popover.

```swift
.popover(isPresented: $showFilterOptions, arrowEdge: .top) {
    FilterOptionsView()
        .frame(minWidth: 300, idealWidth: 360)
        .padding()
}

// Or with item:
.popover(item: $selectedTag) { tag in
    TagDetailView(tag: tag)
        .frame(width: 320, height: 400)
}
```

## Inspector

`inspector` provides a slide-over panel attached to the trailing edge — used in
document editors, design tools, and settings panels in iPad apps.

```swift
struct EditorView: View {
    @State private var showInspector = false
    var selectedItem: Item?

    var body: some View {
        ContentView()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Inspector", systemImage: "sidebar.right") {
                        showInspector.toggle()
                    }
                }
            }
            .inspector(isPresented: $showInspector) {
                if let item = selectedItem {
                    ItemInspectorView(item: item)
                        .inspectorColumnWidth(min: 200, ideal: 270, max: 400)
                } else {
                    ContentUnavailableView("Nothing selected", systemImage: "rectangle.dashed")
                }
            }
    }
}
```

## Confirmation Dialogs

Prefer `confirmationDialog` over custom alerts for destructive actions:

```swift
.confirmationDialog(
    "Delete \"\(item.title)\"?",
    isPresented: $showDeleteConfirmation,
    titleVisibility: .visible
) {
    Button("Delete", role: .destructive) {
        viewModel.delete(item)
    }
    Button("Cancel", role: .cancel) {}
} message: {
    Text("This action cannot be undone.")
}
```

## Alert

```swift
.alert("Error", isPresented: $showError, presenting: currentError) { error in
    Button("OK", role: .cancel) {}
    if error.isRetryable {
        Button("Retry") { viewModel.retry() }
    }
} message: { error in
    Text(error.localizedDescription)
}
```

## Rules

- Use `sheet(item:)` over `sheet(isPresented:)` — the item provides the sheet content and its `id` drives presentation identity
- Never store `AnyView` in a router — the compiler cannot check exhaustiveness
- `SheetDestination.id` must be stable: same case + same data → same id. Changing id while presented causes a dismiss+re-present
- Apply presentation modifiers inside the sheet content, not on the `.sheet` call
- `presentationDetents` only has effect when the sheet is not full-screen
- `inspector` is not a modal — it doesn't block interaction with the underlying content
- `popover` on iPhone → sheet (automatic fallback, no code needed)
- `interactiveDismissDisabled(true)` → user must use an explicit dismiss button; always provide one
