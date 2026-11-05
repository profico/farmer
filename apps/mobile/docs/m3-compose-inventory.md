# Material 3 in `@expo/ui` 57.0.21 (Jetpack Compose)

This file lists what `@expo/ui/jetpack-compose` gives for Material 3
Expressive. The source is the `.d.ts` files and the Kotlin in
`node_modules/@expo/ui/android`. Compose is Material 3 `1.5.0-alpha17`.

Rules for all components:

- Import `@expo/ui/jetpack-compose` only in `.android.tsx` files outside
  `app/`. Import `Host` from `@expo/ui`.
- Put each native control in a `Host`. Use `ControlHost` or `useHostTheme()`
  (`src/ui/host.tsx`).
- `Host` wraps its children in `MaterialExpressiveTheme`. The default
  Expressive motion scheme, shapes and typography apply.
- A color prop takes a `ColorValue`. Without a color prop, a component takes
  its color from the scheme of the `Host`.
- Most components have a `modifiers` prop (`@expo/ui/jetpack-compose`
  modifiers: `clip`, `background`, `border`, `size`, `padding`, and others).
- The lint rule `no-shape-in-symbol-names` rejects a symbol that has
  "shape" in its name, and `import { Shapes }` fails. Read it as a member:
  `import * as modifiers from "@expo/ui/jetpack-compose/modifiers"`, then
  `modifiers.Shapes.Circle`. `src/ui/corner.ts` holds the app's corner scale.

## Color: the scheme of the Host

| Question | Answer |
|---|---|
| Does `Host` build a scheme from `seedColor`? | Yes. It uses `SchemeTonalSpot(Hct, isDark, 0.0)` from `com.google.android.material:material:1.13.0` (spec 2021). |
| Does `useMaterialColors` give the same scheme? | Yes. `useMaterialColors({ colorScheme, seedColor })` calls the same function in the native module. The result is cached for each scheme and seed. |
| Does it work when dynamic color is off? | Yes. A seed works on every Android API level. Without a seed, API 31 and later gives the wallpaper scheme. Older phones give the static baseline. |
| Which roles does it return? | All 49: primary, secondary, tertiary and error (each with on, container, on-container), inversePrimary, background, surface, surfaceVariant, surfaceTint, onSurface, onSurfaceVariant, inverseSurface, inverseOnSurface, outline, outlineVariant, scrim, surfaceBright, surfaceDim, surfaceContainerLowest, surfaceContainerLow, surfaceContainer, surfaceContainerHigh, surfaceContainerHighest, and the `*Fixed` roles. Each value is `#RRGGBBAA`. |
| Can it do high contrast? | No. The contrast level is fixed at 0.0. There is no option. Compose controls always draw at standard contrast. |
| Does it have success or warning roles? | No. The app adds them (`src/ui/material-palette.ts`). |
| Does it use the 2025 spec or the Expressive variant? | No. It is TonalSpot, spec 2021. The Expressive on-container tone 30 in light mode is not in it. |

The app uses this API for the palette of the screens on Android
(`theme.android.ts`). It does not add `@material/material-color-utilities`.

## Components

"Colors" says which colors a component takes. "Limits" says what is missing.

### Buttons and actions

| Component | Variants and props | Limits |
|---|---|---|
| `Button` | `Button` (filled), `FilledTonalButton`, `OutlinedButton`, `ElevatedButton`, `TextButton`. Props: `onClick`, `enabled`, `colors` (container, content, disabled), `contentPadding`, `shape` (a `Shape.*` element), `modifiers`. | No size prop (no XS to XL). Set the height with `height()` and the padding with `contentPadding`. Default shape is the Compose default (pill). No icon slot: put an `Icon` and a `Text` in the children. |
| `IconButton` | `IconButton` (standard), `FilledIconButton`, `FilledTonalIconButton`, `OutlinedIconButton`. Props: `onClick`, `enabled`, `colors`, `shape`, `modifiers`. | No size or width prop. Use `size()`. |
| `ToggleButton` | `ToggleButton` (with label), `IconToggleButton`, `FilledIconToggleButton`, `OutlinedIconToggleButton`. Props: `checked`, `onCheckedChange`, `enabled`, `colors` (with checked colors), `modifiers`. | No `shape` prop, so no round-to-square swap. Constants: `ToggleButton.DefaultIconSize`, `DefaultIconSpacing`. |
| `SegmentedButton` | `SingleChoiceSegmentedButtonRow` and `MultiChoiceSegmentedButtonRow` with `SegmentedButton` children. Props: `selected` and `onClick`, or `checked` and `onCheckedChange`, `colors` (active and inactive container, content, border), `SegmentedButton.Label`. | This is the M3 baseline segmented button. It is not the Expressive connected button group. |
| `FloatingActionButton` | `FloatingActionButton` (56), `SmallFloatingActionButton`, `LargeFloatingActionButton`, `ExtendedFloatingActionButton` (`expanded` prop, `.Icon` and `.Text` slots). Props: `containerColor`, `onClick`, `modifiers`. | One `containerColor` only, no content color prop. No medium FAB. No FAB menu. No `shape` prop. |
| `HorizontalFloatingToolbar` | `variant`: `standard` or `vibrant`. `colors`: toolbar and FAB container and content. Slot: `.FloatingActionButton`. | Horizontal only. No vertical toolbar. No `expanded` prop. |

### Containers and lists

| Component | Variants and props | Limits |
|---|---|---|
| `Card` | `Card` (filled), `ElevatedCard`, `OutlinedCard`. Props: `colors`, `elevation`, `border` (outlined and filled), `modifiers`. | No `shape` prop. Use `modifiers=[clip(...)]` for a corner radius. The default is 12dp. |
| `ListItem` | Slots: `HeadlineContent`, `OverlineContent`, `SupportingContent`, `LeadingContent`, `TrailingContent`. `colors`: container, content, leading, trailing, supporting, overline. `tonalElevation`, `shadowElevation`. | No `onClick`: use the `clickable` modifier. No `shape` prop. The Expressive segmented list (rest radius 4, outer 16) needs `clip` with `Shapes.RoundedCorner(...)` and a 2dp gap. Not a virtualized list. |
| `Surface` | `color`, `contentColor`, `tonalElevation`, `shadowElevation`, `shape`, `border`, `enabled`, `selected`, `checked`, `onClick`, `onCheckedChange`. | The only container with a `shape` prop and a click. Use it for a custom card or row. |
| `Divider` | Present. | |
| `Carousel`, `LazyColumn`, `LazyRow`, `HorizontalPager`, `FlowRow`, `Box`, `Row`, `Column`, `Spacer` | Present. | Compose layouts. Do not use them to build a long list: use a React Native list. |
| `NavigationBar` | Present. | The app uses its own tab bar. |

### Inputs

| Component | Props | Limits |
|---|---|---|
| `TextField` and `OutlinedTextField` | Slots: `Label`, `Placeholder`, `LeadingIcon`, `TrailingIcon`, `Prefix`, `Suffix`, `SupportingText`. Props: `isError`, `shape`, `colors` (about 40 roles for focused, unfocused, disabled, error), `singleLine`, `maxLines`, `minLines`, `maxLength`, `readOnly`, `enabled`, `autoFocus`, `visualTransformation` (`password`), `keyboardOptions` (`capitalization`, `autoCorrectEnabled`, `keyboardType`, `imeAction`), `keyboardActions`, `textStyle`, `onValueChange`, `onFocusChanged`, `ref` (`setText`, `clear`, `focus`, `blur`, `setSelection`). | The value is an `ObservableState<string>` (`useNativeState`), not a plain string. The text lives on the native side. Set it with `ref.setText`. The motion scheme of this component is `standard`, not Expressive. |
| `BasicTextField` | A text field with no decoration. | |
| `Chip` | `AssistChip`, `FilterChip` (`selected`), `InputChip` (`selected`, `.Avatar`), `SuggestionChip`. Slots: `.Label`, `.LeadingIcon`, `.TrailingIcon`. Props: `enabled`, `colors`, `elevation`, `border`, `onClick`. | No `shape` prop. Default corner is 8dp. |
| `Checkbox` | `Checkbox` (`value`, `onCheckedChange`), `TriStateCheckbox`. `colors`: checked, unchecked, checkmark, disabled. | |
| `RadioButton` | `selected`, `onClick`, `colors`. | |
| `Switch` | `value`, `onCheckedChange`, `colors` (thumb, track, border, icon for each state), `Switch.ThumbContent` (an icon in the thumb), `Switch.DefaultIconSize`. | |
| `Slider` | `value`, `min`, `max`, `steps`, `lowerLimit`, `upperLimit`, `colors`, `onValueChange`, `onValueChangeFinished`. Slots: `.Thumb`, `.Track`. `VerticalSlider` is also present. | No range slider. |
| `DatePicker` | Present. | |
| `SearchBar`, `DockedSearchBar` | `SearchBar` with `.Placeholder` and `.ExpandedFullScreenSearchBar`. `DockedSearchBar` with `.Placeholder` and `.LeadingIcon`. Props: `onSearch` or `onQueryChange`, `modifiers`. | No `colors` prop. |
| `DropdownMenu` | `expanded`, `onDismissRequest`, `color`, `shadowElevation`. Slots: `.Trigger`, `.Items`, `.Preview`. `DropdownMenuItem` with `.Text`, `.LeadingIcon`, `.TrailingIcon` and `elementColors`. | No grouped Expressive menu (group radius 8, selected item full). The container is the Compose default. `ExposedDropdownMenuBox` is also present. |

### Overlays and feedback

| Component | Props | Limits |
|---|---|---|
| `AlertDialog` | Slots: `.Title`, `.Text`, `.ConfirmButton`, `.DismissButton`, `.Icon`. `colors`, `tonalElevation`, `properties`, `onDismissRequest`. | The slots take React children, so a `TextField` can go in `.Text`. |
| `BasicAlertDialog` | `onDismissRequest`, `properties`, `modifiers`, children. | Custom content with no slots. Set the corners and the color with `clip` and `background`. |
| `ModalBottomSheet` | `onDismissRequest`, `skipPartiallyExpanded`, `initialFullyExpanded`, `containerColor`, `contentColor`, `scrimColor`, `showDragHandle`, `sheetGesturesEnabled`, `properties`, `ref` (`hide`, `expand`, `partialExpand`), slot `.DragHandle`. | No `shape` prop. The default top corners are 28dp. |
| `Snackbar` and `SnackbarHost` | `Snackbar`: `containerColor`, `contentColor`, `actionContentColor`, `dismissActionContentColor`, `actionOnNewLine`. `SnackbarHost` with `ref.showSnackbar({ message, actionLabel, withDismissAction, duration })`. | The result is a promise (`actionPerformed` or `dismissed`). |
| `Tooltip` | `TooltipBox` with `.PlainTooltip` and `.RichTooltip` (`.Title`, `.Text`, `.Action`). `ref` (`show`, `dismiss`), `isPersistent`. | |
| `Badge`, `BadgedBox` | Present. | |
| `AnimatedVisibility` | Present. | |

### Progress and refresh

| Component | Props | Limits |
|---|---|---|
| `LoadingIndicator` | `LoadingIndicator` and `ContainedLoadingIndicator`. `progress` (an `ObservableState`, or null for indeterminate), `color`, `containerColor`. | This is the Expressive morphing shape indicator. |
| Progress | `LinearProgressIndicator`, `CircularProgressIndicator` (`progress`, `color`, `trackColor`, `strokeCap`, `gapSize`, `strokeWidth`, `drawStopIndicator`). Wavy: `LinearWavyProgressIndicator`, `CircularWavyProgressIndicator` (`amplitude`, `wavelength`, `waveSpeed`, `stopSize`). | Wavy progress exists. `progress` null gives indeterminate. |
| `PullToRefreshBox` | `isRefreshing`, `onRefresh`, `contentAlignment`, `indicator` (`color`, `containerColor`). | The indicator is the Expressive one. It wraps a Compose child. A React Native scroll view needs `RNHostView` inside it. Test the scroll handoff on a device. |

### Shapes, icons and modifiers

| Item | Notes |
|---|---|
| `Shape` | Elements for a `shape` prop: `Star`, `PillStar`, `Pill`, `Circle`, `Rectangle`, `Polygon`, `RoundedCorner({ cornerRadii })`. |
| `Shapes` (modifier module) | For `clip()`: `Rectangle`, `Circle`, `RoundedCorner(number or corner radii)`, `CutCorner`, and `Shapes.Material.*`: Cookie4Sided, Cookie6Sided, Cookie7Sided, Cookie9Sided, Cookie12Sided, Clover4Leaf, Clover8Leaf, SoftBurst, Boom, Oval, Pill, Triangle, Diamond, Pentagon, Sunny, VerySunny, Fan, PixelCircle, PixelTriangle, Ghostish, Bun, Heart, Arch, Slanted, Puffy, and more. These are the Expressive Material shapes. |
| `Icon` | `source` (an XML vector drawable, `require("./x.xml")`), `tint` (null keeps the colors), `size`, `contentDescription`. A babel plugin supports `Icon.select({ ios, android })`. The Material Symbols XML comes from a Metro transformer. The app's own icon list is `src/ui/icons.ts`. |
| Modifiers | `clip`, `background`, `border(width, color)`, `shadow`, `alpha`, `padding`, `size`, `width`, `height`, `fillMax*`, `weight`, `align`, `offset`, `animateContentSize(dampingRatio, stiffness)`, `clickable`, `combinedClickable`, `selectable`, `toggleable`, `semantics`, `graphicsLayer`, `blur`, `rotate`, `imePadding`, `menuAnchor`. Also `animated`, `spring`, `tween`, `snap` and `keyframes` for animated values. |

## Not in `@expo/ui` 57.0.21

- Button sizes XS to XL, and the toggle shape swap of Expressive buttons.
- The Expressive connected button group and the standard button group.
- FAB menu, medium FAB, and a FAB `shape` prop.
- Vertical floating toolbar, and the Expressive navigation rail.
- A `shape` prop on `Card`, `ListItem`, `Chip`, `ModalBottomSheet`.
- A grouped Expressive menu, and the segmented list item.
- High contrast: Compose draws at contrast level 0.
- Roboto Flex and its variable axes. The app uses the system font (ADR 0005).

## Known limits to plan for

- Each `Host` is a native view with its own layout pass. Use one `Host` for a
  group of controls, not one for each row of a long list.
- `Host` with `matchContents` measures the content. A control that grows
  (a text field with `minLines`) needs `onLayoutContent` or a fixed height.
- A text field keeps its value on the native side. A React state value
  that changes from outside needs `ref.setText`.
- Compose controls take the `Host` scheme. A color from `usePalette()` and a
  color from the `Host` agree only when the seed and the scheme are the same.
  `ControlHost` and `useHostTheme()` pass the seed of the theme in force.
