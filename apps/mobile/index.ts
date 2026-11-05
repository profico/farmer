// The entry of the app bundle. The push task must be defined in the global
// scope before anything else: Android can start the bundle without a screen
// to run it (`src/push/background.ts`). Then expo-router starts the app.
import "./src/push/background";
import "expo-router/entry";
