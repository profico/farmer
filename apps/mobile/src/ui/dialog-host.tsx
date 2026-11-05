/** iOS and the other platforms use `Alert.alert` through `showDialog`, so
 *  there is no dialog to draw. Android draws one (`dialog-host.android.tsx`). */
export function DialogHost() {
	return null;
}
