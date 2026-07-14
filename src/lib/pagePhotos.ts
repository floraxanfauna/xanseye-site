import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

export function getPagePhotoUrls(pageFolder: string): string[] {
  const folderPath = path.join(process.cwd(), "public", "page-photos", pageFolder);

  if (!fs.existsSync(folderPath)) {
    return [];
  }

  return fs
    .readdirSync(folderPath)
    .filter((fileName) => {
      const extension = path.extname(fileName).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        return false;
      }

      return fs.statSync(path.join(folderPath, fileName)).isFile();
    })
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => `/page-photos/${pageFolder}/${encodeURIComponent(fileName)}`);
}
