import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/nextPath";

describe("safeNextPath", () => {
  it("allows a same-site absolute path", () => {
    expect(safeNextPath("/professional/diensten")).toBe("/professional/diensten");
  });

  it("keeps the query string, which carries the shift being opened", () => {
    expect(safeNextPath("/professional/diensten?id=abc")).toBe("/professional/diensten?id=abc");
  });

  /*
   * The open-redirect cases. Each of these would otherwise let our own login form
   * hand a freshly authenticated user to somebody else's page, having shown them
   * a myqare.com URL the whole way.
   */
  it("rejects an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.example/phish")).toBeNull();
    expect(safeNextPath("http://evil.example")).toBeNull();
  });

  it("rejects a protocol-relative URL, which looks like a path but is not", () => {
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("//evil.example/login")).toBeNull();
  });

  it("rejects backslashes, which some browsers normalise into slashes", () => {
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("\\\\evil.example")).toBeNull();
  });

  it("rejects a relative path, since the target must be unambiguous", () => {
    expect(safeNextPath("dashboard")).toBeNull();
    expect(safeNextPath("../admin")).toBeNull();
  });

  it("treats missing input as no redirect", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
