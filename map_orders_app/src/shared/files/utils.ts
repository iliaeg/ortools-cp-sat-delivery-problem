import { saveAs } from "file-saver";

export const saveBlobToFile = (blob: Blob, filename: string) => {
  saveAs(blob, filename);
};

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
