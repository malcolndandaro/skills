import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./state.js";
import { stateDir } from "./paths.js";

export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOT_PIXELS = 12_000_000;
export const MAX_SCREENSHOTS_PER_PAGE = 20;

const MIME_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export const screenshotRoot = () => path.join(stateDir(), "screenshots");
export const screenshotDir = (key) => path.join(screenshotRoot(), key);

function pngInfo(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: "image/png" };
}

function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let index = 2; index + 9 < bytes.length; ) {
    if (bytes[index] !== 0xff) return null;
    while (bytes[index] === 0xff) index += 1;
    const marker = bytes[index++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (index + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(index);
    if (length < 2 || index + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: bytes.readUInt16BE(index + 3), width: bytes.readUInt16BE(index + 5), mime: "image/jpeg" };
    }
    index += length;
  }
  return null;
}

/** Validate image bytes from the browser; query parameters are never trusted for dimensions. */
export function imageInfo(bytes, requestedMime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("empty screenshot");
  if (bytes.length > MAX_SCREENSHOT_BYTES) throw new Error(`screenshot exceeds ${MAX_SCREENSHOT_BYTES / (1024 * 1024)}MB`);
  const info = requestedMime === "image/png" ? pngInfo(bytes) : requestedMime === "image/jpeg" ? jpegInfo(bytes) : null;
  if (!info) throw new Error("screenshot bytes do not match the requested PNG or JPEG type");
  if (!info.width || !info.height || info.width * info.height > MAX_SCREENSHOT_PIXELS) throw new Error("screenshot dimensions exceed the 12 megapixel limit");
  return { ...info, bytes: bytes.length };
}

export function createScreenshot(key, bytes, requestedMime, mode) {
  const info = imageInfo(bytes, requestedMime);
  const id = `ss_${crypto.randomBytes(12).toString("hex")}`;
  const file = path.join(screenshotDir(key), `${id}.${MIME_EXTENSION[info.mime]}`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWrite(file, bytes);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  return { id, path: file, width: info.width, height: info.height, mode, mime: info.mime, bytes: info.bytes, createdAt: Date.now() };
}

export function removeScreenshot(screenshot) {
  if (!screenshot?.path) return;
  const root = screenshotRoot();
  const relative = path.relative(root, path.resolve(screenshot.path));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  try {
    fs.unlinkSync(screenshot.path);
    fs.rmdirSync(path.dirname(screenshot.path));
  } catch {}
}
