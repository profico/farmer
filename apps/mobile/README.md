# The Farmer mobile app

An Expo app for iOS and Android. The decisions are in
`docs/adr/0005-native-mobile-app.md`, and the order of the work is in
`docs/plans/mobile-app.md`.

## Where a screen lives

Each screen has one route file. A new screen starts as a `<Placeholder>`
(`src/navigation/placeholder.tsx`) and is then built in its own folder. You
do not need to change the navigation to build a screen.

| Folder | Screens | Opened from |
|---|---|---|
| `app/(tabs)/` | The four tabs: Time, Projects, Reports, More | The tab bar |
| `app/(tabs)/projects/[id]/` | A project, its `settings` and its `team` | The Projects tab |
| `app/you/` | The person's own settings and records | More, "You" |
| `app/workspace/` | The workspace settings | More, "Workspace" |
| `app/assistant/` | The conversations and one conversation (`[id]`) | More |
| `src/reports/` | One component for each part of the Reports tab | The segmented control |
| `app/*.tsx` | The forms (`entry`, `start-timer`, `stop-timer`) and the sign-in | Sheets and the start |

Rules:

- A screen sets its own title with `<Stack.Screen options={{ title }} />`.
  The `_layout.tsx` of the folder (`SectionStack`) adds the header and
  sends a link that arrives before a workspace is chosen to the tabs.
- To add a screen to a folder, add a file. For a new folder at the root,
  add a `_layout.tsx` with `<SectionStack />`, and add the folder to the
  `Stack.Protected` list of signed-in screens in `app/_layout.tsx`.
- Show an entry only when the person can use it. Use `useAccess()`
  (`src/api/capabilities.ts`): `fullApi` is false for a Server before API
  version 2, and the capabilities come from `whoami`.
- Use the settings-list kit (`src/ui/settings-list.tsx`) for a list of
  settings: `SettingsSection`, `SettingsLink`, `SettingsChoice`,
  `SettingsSwitch` and `SettingsValue`. iOS draws the grouped lists of the
  Settings app (`settings-list.ios.tsx`). Android draws Material 3 list
  items.
- Use an icon from `src/ui/icons.ts`. Do not type an arrow, a chevron or a
  check mark as text.
- Take every colour from `usePalette()` (`src/ui/theme.ts`). Do not type a
  hex colour in a screen. The palette follows More, "Display": the farmer
  palette, a seed theme or Material You, light or dark, and high contrast.
  `useTheme()` also gives the scheme and the seed for a native `Host`;
  `ControlHost` and `useHostTheme()` (`src/ui/host.tsx`) apply them.
- Before an animation, read `useMotionPreference()` (`src/ui/motion.ts`).
  When `reduceMotion` is true, use a fade or no animation.
- Use a method of `FarmerClient` (`@farmer/api-client`) for each route.
  Put each query in `src/api/`, with a key that starts with `scope(w)`.
