import { THUMBNAIL_SPEC } from "@cardiary/domain";
import sharp from "sharp";

/**
 * 翻牌縮圖：固定長邊、固定 JPEG 品質、去除 EXIF。
 *
 * 同一份位元組與同一組參數會產生同一份輸出，所以快取刪掉後重新產生的
 * 位元組仍相同。`rotate()` 先依 EXIF 轉正再輸出，輸出的中繼資料預設
 * 已被 sharp 剝除。
 */
export async function renderThumbnail(input: Uint8Array): Promise<Uint8Array> {
  const output = await sharp(Buffer.from(input))
    .rotate()
    .resize({
      width: THUMBNAIL_SPEC.maxEdge,
      height: THUMBNAIL_SPEC.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: THUMBNAIL_SPEC.jpegQuality,
      progressive: false,
      chromaSubsampling: "4:2:0",
    })
    .toBuffer();
  return new Uint8Array(output);
}

/** 圖片的寬與高；讀不到時回 undefined，不讓匯入失敗。 */
export async function imageSize(
  input: string | Uint8Array,
): Promise<{ readonly width: number; readonly height: number } | undefined> {
  try {
    const source = typeof input === "string" ? input : Buffer.from(input);
    const meta = await sharp(source).metadata();
    if (meta.width === undefined || meta.height === undefined) return undefined;
    return { width: meta.width, height: meta.height };
  } catch {
    return undefined;
  }
}
