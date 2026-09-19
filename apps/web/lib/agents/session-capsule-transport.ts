import "server-only";

import { createHash } from "node:crypto";

import {
  serializeSessionCapsuleV0Identity,
  sessionCapsuleV0Schema,
  type SessionCapsuleV0,
} from "@codev/contracts";

export const SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE =
  "application/vnd.codev.session-capsule.v0";
export const MAX_SESSION_CAPSULE_TRANSPORT_BYTES = 32 * 1_024 * 1_024;
export const MAX_SESSION_CAPSULE_MANIFEST_BYTES = 6 * 1_024 * 1_024;

const MAGIC = new TextEncoder().encode("CODEVSC0");
const MANIFEST_LENGTH_BYTES = 4;
const HEADER_BYTES = MAGIC.byteLength + MANIFEST_LENGTH_BYTES;

export class SessionCapsuleTransportError extends Error {
  constructor(
    message: string,
    readonly code = "session_capsule_invalid_transport",
  ) {
    super(message);
    this.name = "SessionCapsuleTransportError";
  }
}

export type DecodedSessionCapsule = {
  capsule: SessionCapsuleV0;
  files: ReadonlyMap<string, Uint8Array>;
};

function sha256(payload: Uint8Array) {
  return createHash("sha256").update(payload).digest("hex");
}

function fail(
  message: string,
  code = "session_capsule_invalid_transport",
): never {
  throw new SessionCapsuleTransportError(message, code);
}

function assertTransportBounds(payload: Uint8Array) {
  if (payload.byteLength === 0) {
    fail("The session capsule transport is empty.");
  }
  if (payload.byteLength > MAX_SESSION_CAPSULE_TRANSPORT_BYTES) {
    fail(
      "The session capsule transport exceeds the 32 MiB limit.",
      "session_capsule_transport_too_large",
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Capsule v0 wire format:
 *
 * - 8-byte ASCII magic (`CODEVSC0`)
 * - 4-byte unsigned big-endian canonical-manifest length
 * - canonical UTF-8 Capsule v0 manifest
 * - raw file bodies concatenated in manifest path order
 *
 * File boundaries, sizes, roles, and digests come only from the validated
 * manifest. There are no transport paths or entry headers to disagree with it.
 */
export function encodeSessionCapsuleTransport(input: {
  capsule: SessionCapsuleV0;
  files: ReadonlyMap<string, Uint8Array>;
}) {
  const capsule = sessionCapsuleV0Schema.parse(input.capsule);
  const manifest = serializeSessionCapsuleV0Identity(capsule);
  if (manifest.byteLength > MAX_SESSION_CAPSULE_MANIFEST_BYTES) {
    fail(
      "The session capsule manifest exceeds the 6 MiB limit.",
      "session_capsule_manifest_too_large",
    );
  }
  if (input.files.size !== capsule.files.length) {
    fail(
      "The session capsule file set does not match its manifest.",
      "session_capsule_file_set_mismatch",
    );
  }

  const bodies: Uint8Array[] = [];
  let totalBytes = HEADER_BYTES + manifest.byteLength;
  for (const file of capsule.files) {
    const body = input.files.get(file.path);
    if (!body) {
      fail(
        `The session capsule is missing file content for ${file.path}.`,
        "session_capsule_file_set_mismatch",
      );
    }
    if (body.byteLength !== file.bytes || sha256(body) !== file.sha256) {
      fail(
        `The session capsule file ${file.path} failed integrity verification.`,
        "session_capsule_file_integrity_failure",
      );
    }
    bodies.push(body);
    totalBytes += body.byteLength;
  }
  for (const path of input.files.keys()) {
    if (!capsule.files.some((file) => file.path === path)) {
      fail(
        `The session capsule contains undeclared file content for ${path}.`,
        "session_capsule_file_set_mismatch",
      );
    }
  }
  if (totalBytes > MAX_SESSION_CAPSULE_TRANSPORT_BYTES) {
    fail(
      "The session capsule transport exceeds the 32 MiB limit.",
      "session_capsule_transport_too_large",
    );
  }

  const transport = new Uint8Array(totalBytes);
  transport.set(MAGIC, 0);
  new DataView(transport.buffer).setUint32(
    MAGIC.byteLength,
    manifest.byteLength,
    false,
  );
  let offset = HEADER_BYTES;
  transport.set(manifest, offset);
  offset += manifest.byteLength;
  for (const body of bodies) {
    transport.set(body, offset);
    offset += body.byteLength;
  }
  return transport;
}

export function decodeSessionCapsuleTransport(
  transport: Uint8Array,
): DecodedSessionCapsule {
  assertTransportBounds(transport);
  if (
    transport.byteLength < HEADER_BYTES ||
    !equalBytes(transport.subarray(0, MAGIC.byteLength), MAGIC)
  ) {
    fail("The session capsule transport header is invalid.");
  }

  const manifestLength = new DataView(
    transport.buffer,
    transport.byteOffset + MAGIC.byteLength,
    MANIFEST_LENGTH_BYTES,
  ).getUint32(0, false);
  if (
    manifestLength === 0 ||
    manifestLength > MAX_SESSION_CAPSULE_MANIFEST_BYTES ||
    HEADER_BYTES + manifestLength > transport.byteLength
  ) {
    fail(
      "The session capsule manifest length is invalid.",
      "session_capsule_invalid_manifest",
    );
  }

  const manifest = transport.subarray(
    HEADER_BYTES,
    HEADER_BYTES + manifestLength,
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifest),
    );
  } catch {
    fail(
      "The session capsule manifest is not valid UTF-8 JSON.",
      "session_capsule_invalid_manifest",
    );
  }

  let capsule: SessionCapsuleV0;
  try {
    capsule = sessionCapsuleV0Schema.parse(decoded);
  } catch {
    fail(
      "The session capsule manifest does not satisfy Capsule v0.",
      "session_capsule_invalid_manifest",
    );
  }
  if (!equalBytes(manifest, serializeSessionCapsuleV0Identity(capsule))) {
    fail(
      "The session capsule manifest is not canonically encoded.",
      "session_capsule_noncanonical_manifest",
    );
  }

  const files = new Map<string, Uint8Array>();
  let offset = HEADER_BYTES + manifestLength;
  for (const file of capsule.files) {
    const end = offset + file.bytes;
    if (end > transport.byteLength) {
      fail(
        `The session capsule file ${file.path} is truncated.`,
        "session_capsule_file_integrity_failure",
      );
    }
    const body = transport.slice(offset, end);
    if (sha256(body) !== file.sha256) {
      fail(
        `The session capsule file ${file.path} failed checksum verification.`,
        "session_capsule_file_integrity_failure",
      );
    }
    files.set(file.path, body);
    offset = end;
  }
  if (offset !== transport.byteLength) {
    fail(
      "The session capsule transport contains undeclared trailing bytes.",
      "session_capsule_file_set_mismatch",
    );
  }
  return { capsule, files };
}
