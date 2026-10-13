// The mode of a dialog decides whether typed text survives a rotation. A
// change of mode while the dialog is open unmounts the form. These tests flip
// the media query by hand, as a rotation does, and read the mode that a root
// reports.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as React from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";

import { ModalModeContext, useModalMode } from "./modal-mode.tsx";

/** A media query that the test moves by hand and that tells its listeners. */
function fakeMedia(initial: boolean) {
	// The class is local, so it extends the EventTarget of the fake DOM.
	class FakeQuery extends EventTarget implements MediaQueryList {
		matches: boolean;
		media = "";
		onchange = null;

		constructor(matches: boolean) {
			super();
			this.matches = matches;
		}

		addListener() {}
		removeListener() {}
	}

	const query = new FakeQuery(initial);
	const original = window.matchMedia;
	window.matchMedia = () => query;

	return {
		/** Moves the query and tells every listener, as a rotation does. */
		async flip(next: boolean) {
			query.matches = next;
			await act(async () => {
				query.dispatchEvent(new Event("change"));
			});
		},
		restore() {
			window.matchMedia = original;
		},
	};
}

function Probe({ open, id }: { open: boolean; id: string }) {
	return <span data-probe={id}>{useModalMode(open)}</span>;
}

/** A parent root that opens, and a nested root below it. */
function Pair({
	parentOpen,
	childOpen,
}: {
	parentOpen: boolean;
	childOpen: boolean;
}) {
	const parentMode = useModalMode(parentOpen);
	return (
		<ModalModeContext.Provider value={parentMode}>
			<span data-probe="parent">{parentMode}</span>
			<Probe id="child" open={childOpen} />
		</ModalModeContext.Provider>
	);
}

let container: HTMLElement;
let root: Root;
let media: ReturnType<typeof fakeMedia>;

beforeAll(() => {
	GlobalRegistrator.register();
	// React reads this global flag to allow `act` outside a test runner.
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
	await GlobalRegistrator.unregister();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	media.restore();
});

/** Mounts a tree with the query in the given state. */
async function mount(narrow: boolean, tree: React.ReactNode) {
	media = fakeMedia(narrow);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root.render(tree));
}

async function show(tree: React.ReactNode) {
	await act(async () => root.render(tree));
}

const modeOf = (id: string) =>
	container.querySelector(`[data-probe="${id}"]`)?.textContent;

describe("the mode of a root that opens", () => {
	test("a root that mounts open takes the mode of the query", async () => {
		await mount(true, <Probe id="root" open />);
		expect(modeOf("root")).toBe("drawer");
	});

	test("a root locks the mode when it opens", async () => {
		await mount(true, <Probe id="root" open={false} />);
		await show(<Probe id="root" open />);
		expect(modeOf("root")).toBe("drawer");
	});

	test("the mode does not change when the query flips while open", async () => {
		await mount(false, <Probe id="root" open />);
		expect(modeOf("root")).toBe("dialog");
		await media.flip(true);
		expect(modeOf("root")).toBe("dialog");
		await media.flip(false);
		await media.flip(true);
		expect(modeOf("root")).toBe("dialog");
	});

	test("a sheet stays a sheet when the phone turns wide while open", async () => {
		await mount(true, <Probe id="root" open />);
		await media.flip(false);
		expect(modeOf("root")).toBe("drawer");
	});

	test("the mode is read again on the next open", async () => {
		await mount(true, <Probe id="root" open />);
		await show(<Probe id="root" open={false} />);
		await media.flip(false);
		expect(modeOf("root")).toBe("drawer");
		await show(<Probe id="root" open />);
		expect(modeOf("root")).toBe("dialog");
	});
});

describe("the mode of a root that never opened", () => {
	test("a closed root follows the live query", async () => {
		await mount(false, <Probe id="root" open={false} />);
		expect(modeOf("root")).toBe("dialog");
		await media.flip(true);
		expect(modeOf("root")).toBe("drawer");
		await media.flip(false);
		expect(modeOf("root")).toBe("dialog");
	});
});

describe("a nested root", () => {
	test("a child takes the mode of its parent, not the query", async () => {
		await mount(true, <Pair parentOpen childOpen={false} />);
		await media.flip(false);
		await show(<Pair parentOpen childOpen />);
		expect(modeOf("parent")).toBe("drawer");
		expect(modeOf("child")).toBe("drawer");
	});

	test("a child that mounts open takes the mode of its parent", async () => {
		await mount(false, <Pair parentOpen childOpen />);
		expect(modeOf("child")).toBe("dialog");
	});
});
