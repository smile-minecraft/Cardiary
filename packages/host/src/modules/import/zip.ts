import { open, type FileHandle } from "node:fs/promises";
import { crc32, inflateRawSync } from "node:zlib";

/** 只讀 ZIP 目錄和指定項目，不將任何檔案解到磁碟。 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;

export async function readZipEntry(path: string, name: string): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size < 22) throw new Error("ZIP 結尾不存在");
    const tailSize = Math.min(size, 65_557);
    const tail = await readAt(file, size - tailSize, tailSize);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0)
      throw new Error("不支援的 ZIP");
    const count = tail.readUInt16LE(end + 10);
    if (count !== tail.readUInt16LE(end + 8) || count === 0xffff)
      throw new Error("不支援分卷或 ZIP64");
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (
      directorySize > MAX_DIRECTORY_BYTES ||
      directoryOffset + directorySize > size - tailSize + end
    )
      throw new Error("ZIP 目錄無效");
    const directory = await readAt(file, directoryOffset, directorySize);
    let cursor = 0;
    let found:
      | {
          offset: number;
          compressed: number;
          uncompressed: number;
          method: number;
          crc: number;
          flags: number;
        }
      | undefined;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50)
        throw new Error("ZIP 目錄無效");
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length) throw new Error("ZIP 目錄不完整");
      const entryName = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      if (entryName === name) {
        if (found) throw new Error("ZIP 項目重複");
        found = {
          flags: directory.readUInt16LE(cursor + 8),
          method: directory.readUInt16LE(cursor + 10),
          crc: directory.readUInt32LE(cursor + 16),
          compressed: directory.readUInt32LE(cursor + 20),
          uncompressed: directory.readUInt32LE(cursor + 24),
          offset: directory.readUInt32LE(cursor + 42),
        };
      }
      cursor = next;
    }
    if (
      !found ||
      cursor !== directory.length ||
      (found.flags & 1) !== 0 ||
      (found.method !== 0 && found.method !== 8) ||
      found.compressed > MAX_ENTRY_BYTES ||
      found.uncompressed > MAX_ENTRY_BYTES ||
      found.offset + 30 > directoryOffset
    )
      throw new Error("ZIP 項目不支援");
    const header = await readAt(file, found.offset, 30);
    if (
      header.readUInt32LE(0) !== 0x04034b50 ||
      header.readUInt16LE(6) !== found.flags ||
      header.readUInt16LE(8) !== found.method
    )
      throw new Error("ZIP 標頭不一致");
    const filenameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const filename = await readAt(file, found.offset + 30, filenameLength);
    if (filename.toString("utf8") !== name) throw new Error("ZIP 項目名稱不一致");
    const dataOffset = found.offset + 30 + filenameLength + extraLength;
    if (dataOffset + found.compressed > directoryOffset) throw new Error("ZIP 項目超出邊界");
    const compressed = await readAt(file, dataOffset, found.compressed);
    const result =
      found.method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    if (result.length !== found.uncompressed || crc32(result) !== found.crc)
      throw new Error("ZIP 項目損壞");
    return result;
  } finally {
    await file.close();
  }
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const result = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await file.read(result, total, length - total, position + total);
    if (bytesRead === 0) throw new Error("ZIP 檔案不完整");
    total += bytesRead;
  }
  return result;
}
