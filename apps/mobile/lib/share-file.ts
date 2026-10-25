import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

// A file the app made or fetched, handed to the phone's share sheet (save to
// Files, send, open in another app). The browser preview downloads it instead.
// Written to the cache: the system may clear it, nothing is kept for good.

export async function shareFile(name: string, data: string | Uint8Array, mimeType: string, uti?: string): Promise<void> {
  if (Platform.OS === "web") {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
    link.download = name;
    link.click();
    return;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(data);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name, UTI: uti });
}
