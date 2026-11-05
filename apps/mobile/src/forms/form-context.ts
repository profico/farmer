import { createContext } from "react";

/** True inside a `FormGroup` of iOS, where a control draws one row and
 *  the group draws the surface around the rows. */
export const InFormGroup = createContext(false);
