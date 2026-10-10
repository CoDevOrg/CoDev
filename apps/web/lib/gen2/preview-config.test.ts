import { describe, expect, it } from "vitest";

import {
  isGen2PreviewDevDirect,
  isGen2PreviewEnabled,
  readGen2PreviewConfig,
} from "./preview-config";

const zoneId = "0123456789abcdef0123456789abcdef";

describe("preview configuration", () => {
  it("accepts a separate registrable zone with its Cloudflare id", () => {
    expect(
      readGen2PreviewConfig({
        CODEV_PREVIEW_ZONE: " Codev-Preview.dev ",
        CODEV_PREVIEW_ZONE_ID: zoneId,
      }),
    ).toEqual({ zone: "codev-preview.dev", zoneId });
  });

  it.each([
    "trycodev.com",
    "previews.trycodev.com",
    "localhost",
    "dev",
    "*.codev-preview.dev",
    "https://codev-preview.dev",
    "codev-preview.dev/x",
    "",
  ])("keeps previews off for the zone %j", (zone) => {
    expect(
      readGen2PreviewConfig({
        CODEV_PREVIEW_ZONE: zone,
        CODEV_PREVIEW_ZONE_ID: zoneId,
      }),
    ).toBeNull();
  });

  it("needs a valid zone id as well", () => {
    expect(
      readGen2PreviewConfig({ CODEV_PREVIEW_ZONE: "codev-preview.dev" }),
    ).toBeNull();
    expect(
      readGen2PreviewConfig({
        CODEV_PREVIEW_ZONE: "codev-preview.dev",
        CODEV_PREVIEW_ZONE_ID: "not-an-id",
      }),
    ).toBeNull();
  });

  it("frames local servers directly only in development", () => {
    const direct = { CODEV_PREVIEW_DEV_DIRECT: "1" };
    expect(isGen2PreviewDevDirect({ ...direct, NODE_ENV: "development" })).toBe(
      true,
    );
    expect(isGen2PreviewDevDirect({ ...direct, NODE_ENV: "production" })).toBe(
      false,
    );
    expect(isGen2PreviewEnabled({ ...direct, NODE_ENV: "development" })).toBe(
      true,
    );
    expect(isGen2PreviewEnabled({ NODE_ENV: "production" })).toBe(false);
  });
});
