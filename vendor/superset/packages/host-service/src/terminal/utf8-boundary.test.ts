import { describe, expect, test } from "bun:test";
import { completeUtf8Length } from "./utf8-boundary.ts";

const encode = (text: string) => new TextEncoder().encode(text);

describe("completeUtf8Length", () => {
	test("keeps ASCII whole", () => {
		expect(completeUtf8Length(encode("ls -la"))).toBe(6);
	});

	test("keeps complete multi-byte characters", () => {
		const bytes = encode("a€😀");
		expect(completeUtf8Length(bytes)).toBe(bytes.length);
	});

	test("holds back a character split across chunks", () => {
		const bytes = encode("a€");
		expect(completeUtf8Length(bytes.subarray(0, 2))).toBe(1);
		expect(completeUtf8Length(bytes.subarray(0, 3))).toBe(1);
		const emoji = encode("😀");
		expect(completeUtf8Length(emoji.subarray(0, 3))).toBe(0);
	});

	test("handles empty input", () => {
		expect(completeUtf8Length(new Uint8Array(0))).toBe(0);
	});
});
