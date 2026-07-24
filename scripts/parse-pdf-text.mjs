import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Missing PDF file path.");
  }

  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    process.stdout.write(JSON.stringify({ ok: true, text: result.text || "" }));
  } finally {
    await parser.destroy();
  }
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      message: error instanceof Error ? error.message : "PDF parse failed."
    })
  );
  process.exitCode = 1;
});
