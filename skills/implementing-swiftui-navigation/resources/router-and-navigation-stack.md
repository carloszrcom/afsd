# Router & NavigationStack

## Router — Full Pattern

`@MainActor` ensures all path mutations happen on the main actor — no `DispatchQueue.main` calls needed in callers, and no data races on `NavigationPath`.

```swift
// HomeRouter.swift
import SwiftUI

@Observable
@MainActor
final class HomeRouter {

    // MARK: - Destinations

    enum Destination: Codable, Hashable, Sendable {
        case itemDetail(id: String)
        case profile(userId: String)
        case settings
        case compose
    }

    // MARK: - State

    var path = NavigationPath()

    // MARK: - Navigation API

    func navigate(to destination: Destination) {
        path.append(destination)
    }

    func navigateBack() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    func navigateToRoot() {
        path.removeLast(path.count)
    }

    func replace(with destination: Destination) {
        navigateBack()
        navigate(to: destination)
    }

    // MARK: - State Restoration

    /// Encodes the current path for SceneStorage persistence.
    /// Returns nil if any element is non-Codable.
    func encodedPath() -> Data? {
        try? path.codable.flatMap { try JSONEncoder().encode($0) }
    }

    init(restoredData: Data? = nil) {
        guard let data = restoredData,
              let rep = try? JSONDecoder().decode(
                  NavigationPath.CodableRepresentation.self, from: data
              )
        else { return }
        path = NavigationPath(rep)
    }
}
```

## NavigationStack in the View

```swift
// HomeNavigationView.swift
import SwiftUI

struct HomeNavigationView: View {
    @State private var router = HomeRouter()
    @State private var sheetRouter = SheetRouter()

    // State restoration: see state-restoration.md
    @SceneStorage("homeNavPath") private var pathData: Data?

    var body: some View {
        NavigationStack(path: $router.path) {
            HomeListView(router: router, sheetRouter: sheetRouter)
                // Single navigationDestination per NavigationStack
                .navigationDestination(for: HomeRouter.Destination.self) { destination in
                    switch destination {
                    case .itemDetail(let id):   ItemDetailView(id: id, router: router)
                    case .profile(let userId):  ProfileView(userId: userId)
                    case .settings:             SettingsView()
                    case .compose:              ComposeView()
                    }
                }
        }
        // Sheet presentation — separate concern from push navigation
        .sheet(item: $sheetRouter.destination) { destination in
            switch destination {
            case .createItem:         CreateItemView()
            case .editItem(let item): EditItemView(item: item)
            case .shareItem(let item): ShareView(item: item)
            }
        }
        // State persistence
        .onChange(of: router.path) {
            pathData = router.encodedPath()
        }
        .onAppear {
            if router.path.isEmpty, let data = pathData {
                router = HomeRouter(restoredData: data)
            }
        }
    }
}
```

## Passing the Router to Child Views

Pass routers as **direct properties** (reference type, no `@Binding`, no `@ObservedObject`).
The child view observes the router automatically because it's `@Observable`.

```swift
struct ItemDetailView: View {
    let id: String
    var router: HomeRouter   // Direct property — @Observable handles observation

    var body: some View {
        VStack {
            Text("Item \(id)")
            Button("Open Profile") {
                router.navigate(to: .profile(userId: "user-123"))
            }
            Button("Back to Root") {
                router.navigateToRoot()
            }
        }
        .navigationTitle("Detail")
    }
}
```

## `navigationDestination` Overloads

Three overloads — choose based on context:

```swift
// 1. Type-based (most common — works with path.append)
.navigationDestination(for: HomeRouter.Destination.self) { destination in
    DestinationView(destination: destination)
}

// 2. Bool binding (programmatic push without path)
.navigationDestination(isPresented: $showSettings) {
    SettingsView()
}

// 3. Optional item (replaces detail column content in SplitView)
.navigationDestination(item: $selectedItem) { item in
    ItemDetailView(item: item)
}
```

> Use overload 1 for path-based navigation (standard push).
> Use overload 3 in the detail column of `NavigationSplitView` to drive content from sidebar selection.

## Custom Back Button (Onboarding / Modal Flows)

Use `navigationBarBackButtonHidden` + a `ToolbarItem(.navigationBarLeading)` when the
default back button is insufficient — onboarding steps, multi-step forms with validation,
or flows where "back" means "cancel" semantically.

```swift
struct OnboardingStepView: View {
    var router: OnboardingRouter
    var hasUnsavedChanges: Bool

    @State private var showCancelConfirmation = false

    var body: some View {
        Form {
            // ... step content
        }
        .navigationTitle("Step 2 of 4")
        // Hide the system back button to replace it entirely
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Cancel") {
                    if hasUnsavedChanges {
                        showCancelConfirmation = true
                    } else {
                        router.navigateBack()
                    }
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Next") {
                    router.navigate(to: .stepThree)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .confirmationDialog(
            "Discard changes?",
            isPresented: $showCancelConfirmation,
            titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) { router.navigateBack() }
            Button("Keep Editing", role: .cancel) {}
        }
    }
}
```

When to use `navigationBarBackButtonHidden`:
- Onboarding or wizard flows (replace "Back" with "Cancel" or a step label)
- Forms where back would lose unsaved data — always add a confirmation dialog
- Flows where the swipe-back gesture must be disabled (e.g., auth screens)

> **Do not** hide the back button just for aesthetic reasons — it breaks accessibility
> and violates HIG. Only hide it when the replacement button has a clear semantic meaning.

## Rules

- Declare `navigationDestination` **once** per `NavigationStack` — multiple declarations on the same stack can cause unexpected behavior
- `Destination` cases with associated values: keep them `Codable` — use primitive types (`String`, `Int`, `URL`) not domain model structs (reduces coupling)
- `path.codable` returns `nil` if any element is non-Codable — all `Destination` cases must be `Codable` for state restoration to work
- `navigateToRoot()` uses `removeLast(path.count)` — works even if count is 0 (no crash)
- The router is `@MainActor` — callers on the main actor (SwiftUI views, `@MainActor` functions) can call router methods without `await`
- When hiding the back button, always provide an accessible alternative (`ToolbarItem` with `Button`) and handle unsaved state with a `confirmationDialog`
