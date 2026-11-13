/**
 * The client-side image pipeline, shared by every upload surface.
 *
 * Two steps, in this order, and the order matters:
 *  1. downscale to 1600px and re-encode as JPEG on a canvas — this drops EXIF
 *     metadata (including GPS) before the file ever leaves the device, so a
 *     student's photo of a receipt does not carry their location to storage;
 *  2. ask Convex for a one-time upload URL and PUT the re-encoded blob.
 *
 * Failures come back as i18n keys rather than sentences, so the caller renders
 * them in the active language and the same failure reads the same on every
 * screen.
 */

import { MAX_IMAGE_BYTES } from "./catalog";
import { localUploadFetch } from "./localConvexClient";

/** Upload kinds the server authorises. Kept in step with `storage.ts`. */
export type UploadKind =
  | "product"
  | "shop"
  | "review"
  | "course"
  | "instructor"
  | "evidence";

export type UploadErrorKey = "errImageType" | "errImageSize" | "errGeneric";

export type UploadResult =
  | { ok: true; storageId: string }
  | { ok: false; error: UploadErrorKey };

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("encode failed");
  return blob;
}

/**
 * Validate, compress and upload one image.
 *
 * @param createUpload the `api.storage.createImageUpload` mutation.
 */
export async function uploadImage(
  file: File,
  kind: UploadKind,
  createUpload: (args: {
    kind: UploadKind;
    contentType: string;
    sizeBytes: number;
  }) => Promise<{ uploadUrl: string }>,
): Promise<UploadResult> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "errImageType" };
  if (file.size > MAX_IMAGE_BYTES * 2) return { ok: false, error: "errImageSize" };

  try {
    const blob = await compressImage(file);
    if (blob.size > MAX_IMAGE_BYTES) return { ok: false, error: "errImageSize" };

    const { uploadUrl } = await createUpload({
      kind,
      contentType: "image/jpeg",
      sizeBytes: blob.size,
    });
    const response = await localUploadFetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!response.ok) return { ok: false, error: "errGeneric" };

    const { storageId } = (await response.json()) as { storageId: string };
    return { ok: true, storageId };
  } catch {
    return { ok: false, error: "errGeneric" };
  }
}
