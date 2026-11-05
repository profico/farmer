import { createContext } from "react";
import type { ColorValue } from "react-native";

/** The colour of the surface that a child is drawn on, when it is not the
 *  screen colour. A `Card` sets it. A field reads it, so that its floating
 *  label cuts the outline with the right colour. */
export const SurfaceColor = createContext<ColorValue | undefined>(undefined);
