export function completeUtf8Length(bytes: Uint8Array): number {
	const length = bytes.length;
	for (let back = 1; back <= Math.min(3, length); back++) {
		const byte = bytes[length - back] as number;
		if ((byte & 0xc0) === 0x80) continue;
		const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
		return needed > back ? length - back : length;
	}
	return length;
}
