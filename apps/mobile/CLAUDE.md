# apps/mobile

`@farmer/mobile`, the Expo app for Android and iOS. Read the root `CLAUDE.md` first for the commands and the lint rules.

```bash
bun run test        # bun test three times: in the local zone, America/New_York and Pacific/Auckland
bun run typecheck
bun run make-icons  # the app icon, the splash and the notification icon
```

## Read first

- `apps/mobile/README.md`: where a screen lives, and the rules for a new screen (the settings-list kit, the icons, `usePalette()`, `useMotionPreference()`, `FarmerClient`).
- `docs/domains/mobile.md`: the push, the Live Activity, the sign-in exchange and the builds.
- `docs/adr/0005-native-mobile-app.md` and `docs/plans/mobile-app.md`: the decisions and the order of the work.

## Rules

- **Each platform has its own design system.** Android follows Material 3 Expressive. iOS follows the Apple Human Interface Guidelines. Do not mix them: a Material pill, an outlined field or a bottom-sheet menu on iOS is a bug. Put an Android visual change in a `.android.tsx` file or behind `Platform.OS === "android"`, and keep iOS on native controls. After a change to a shared file, check both platforms.
- **The app is published, so old app versions and old servers exist.** A new build parses each response with the Zod schemas of `@farmer/api-client`. A required field that an older server does not send fails the parse, and a new endpoint is a 404 there. Deploy the server before a `mobile-v*` tag that needs a new API field. An added response field is safe for an old app, because Zod strips unknown keys.
- The tests run in three timezones. A date test that passes only in your zone fails CI.
