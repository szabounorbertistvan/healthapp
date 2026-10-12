// QR codes for share cards, from @zxing/library — already a dependency for the
// barcode scanner, so no new package. The encoder runs anywhere (node in the
// tests, the browser in the generator); the tests decode the matrix with the
// same library's reader to prove it scans back to the exact URL.
import { QRCodeDecoderErrorCorrectionLevel, QRCodeEncoder } from "@zxing/library";

/**
 * The module matrix of `text` as rows of booleans (true = dark), without the
 * quiet zone — the painter adds four light modules around it. Level M (15 %
 * recovery) keeps a profile URL at version 3–4: big modules, easy to scan
 * from a phone screen or a story.
 */
export function qrModules(text: string): boolean[][] {
  const code = QRCodeEncoder.encode(text, QRCodeDecoderErrorCorrectionLevel.M);
  const m = code.getMatrix();
  const rows: boolean[][] = [];
  for (let y = 0; y < m.getHeight(); y++) {
    const row: boolean[] = [];
    for (let x = 0; x < m.getWidth(); x++) row.push(m.get(x, y) === 1);
    rows.push(row);
  }
  return rows;
}
