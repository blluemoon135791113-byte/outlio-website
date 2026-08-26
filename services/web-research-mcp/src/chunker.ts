export class ContentChunker {
  chunk(text: string, maxChars = 7000, overlapChars = 500): string[] {
    const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean); const chunks: string[] = []; let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 1 > maxChars) { chunks.push(current); current = `${current.slice(-overlapChars)}\n${paragraph}`; }
      else current += `${current ? "\n" : ""}${paragraph}`;
    }
    if (current) chunks.push(current); return chunks;
  }
}
