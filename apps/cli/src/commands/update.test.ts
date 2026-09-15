import { describe, expect, test } from "bun:test";

import { compiledExecutable } from "../runtime";
import {
	installDirFor,
	installerCommand,
	installerEnv,
	installScriptName,
	parseVersionOutput,
} from "./update";

const ORIGIN = "https://farmer.test";

describe("compiledExecutable", () => {
	test("is the binary when the code runs from Bun's embedded file system", () => {
		expect(compiledExecutable("/$bunfs/root/farmer", "/usr/bin/farmer")).toBe(
			"/usr/bin/farmer",
		);
		expect(
			compiledExecutable("B:\\~BUN\\root\\farmer.exe", "C:\\farmer.exe"),
		).toBe("C:\\farmer.exe");
		expect(
			compiledExecutable("B:/~BUN/root/farmer.exe", "C:\\farmer.exe"),
		).toBe("C:\\farmer.exe");
	});

	test("is null from source, where execPath is Bun itself", () => {
		expect(
			compiledExecutable("/home/a/farmer/apps/cli/src/main.ts", "/usr/bin/bun"),
		).toBeNull();
	});
});

describe("installDirFor", () => {
	test("is the directory of a binary named farmer", () => {
		expect(installDirFor("/home/a/.local/bin/farmer", "linux", ORIGIN)).toBe(
			"/home/a/.local/bin",
		);
	});

	test("reads a Windows path by Windows rules, in any letter case", () => {
		expect(
			installDirFor(
				"C:\\Users\\a\\AppData\\Local\\Programs\\farmer\\Farmer.EXE",
				"win32",
				ORIGIN,
			),
		).toBe("C:\\Users\\a\\AppData\\Local\\Programs\\farmer");
	});

	test("refuses a renamed binary, and names the install command instead", () => {
		expect(() =>
			installDirFor("/usr/local/bin/farmer-dev", "darwin", ORIGIN),
		).toThrow(`curl -fsSL ${ORIGIN}/cli | sh`);
		expect(() =>
			installDirFor("C:\\tools\\farmer-old.exe", "win32", ORIGIN),
		).toThrow(`irm ${ORIGIN}/cli | iex`);
	});
});

describe("the installer", () => {
	test("is sh with install.sh, and PowerShell with install.ps1 on Windows", () => {
		expect(installScriptName("linux")).toBe("install.sh");
		expect(installerCommand("darwin", "/tmp/x/install.sh")).toEqual([
			"sh",
			"/tmp/x/install.sh",
		]);
		expect(installScriptName("win32")).toBe("install.ps1");
		expect(installerCommand("win32", "C:\\t\\install.ps1")).toEqual([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			"C:\\t\\install.ps1",
		]);
	});

	test("installs over this binary without a login, and keeps the rest of the environment", () => {
		expect(
			installerEnv(
				{ PATH: "/bin", FARMER_INSTALL_DIR: "/elsewhere" },
				"/opt/farmer",
			),
		).toEqual({
			PATH: "/bin",
			FARMER_INSTALL_DIR: "/opt/farmer",
			FARMER_NO_LOGIN: "1",
			FARMER_UPDATE: "1",
		});
	});
});

describe("parseVersionOutput", () => {
	test("reads what `farmer --version` prints, with a Windows line ending", () => {
		expect(parseVersionOutput("farmer 0.2.0\n")).toBe("0.2.0");
		expect(parseVersionOutput("farmer 0.2.0\r\n")).toBe("0.2.0");
	});

	test("is null for anything else", () => {
		expect(parseVersionOutput("1.4.2\n")).toBeNull();
		expect(parseVersionOutput("")).toBeNull();
	});
});
