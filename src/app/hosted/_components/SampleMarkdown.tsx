import type { ReactNode } from "react";
import styles from "../../hosted-mode.module.css";

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>
      : part
  ));
}

export function SampleMarkdown({ markdown, title }: { markdown: string; title: string }) {
  const source = markdown.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  for (let index = 0; index < source.length;) {
    const line = source[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const text = heading[2].trim();
      if (!(heading[1] === "#" && text === title)) {
        nodes.push(heading[1].length <= 2
          ? <h3 key={`heading-${index}`}>{inlineMarkdown(text)}</h3>
          : <h4 key={`heading-${index}`}>{inlineMarkdown(text)}</h4>);
      }
      index += 1;
      continue;
    }
    if (line.includes("|") && source[index + 1]?.trim().match(/^\|?\s*:?-{3,}/)) {
      const rows: string[][] = [];
      const parseRow = (value: string) => value.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const headers = parseRow(line);
      index += 2;
      while (index < source.length && source[index].includes("|")) {
        rows.push(parseRow(source[index]));
        index += 1;
      }
      nodes.push(<div className={styles.sampleTableWrap} key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < source.length && /^[-*]\s+/.test(source[index].trim())) {
        items.push(source[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      nodes.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>);
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < source.length && source[index].trim()
      && !/^(#{1,3})\s+/.test(source[index].trim())
      && !/^[-*]\s+/.test(source[index].trim())
      && !/^>\s?/.test(source[index].trim())
      && !(source[index].includes("|") && source[index + 1]?.trim().match(/^\|?\s*:?-{3,}/))) {
      paragraph.push(source[index].trim());
      index += 1;
    }
    nodes.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <article>{nodes}</article>;
}
