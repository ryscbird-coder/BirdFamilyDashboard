import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** Render-only presentation adapter. The original report string is never modified in storage. */
function safeHref(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^#[a-zA-Z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, match => {
    const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
    if (named[match.toLowerCase()]) return named[match.toLowerCase()];
    const hex = /^&#x/i.test(match); const code = Number.parseInt(match.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
function escapeText(value: string): string { return value.replace(/([\\`*_{}\[\]()<>!|])/g, "\\$1"); }
function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\})/g;
  for (const match of value.matchAll(pattern)) {
    let text = match[2] ?? match[3] ?? match[4] ?? "";
    if (match[4]) { try { text = JSON.parse(text); } catch { text = text.slice(1, -1); } }
    result[match[1].toLowerCase()] = decode(text);
  }
  return result;
}
function sourceReference(label: string, originalUrl?: string): string {
  const href = safeHref(originalUrl);
  return href ? `[${label}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})` : `(${label}; open the original ChatGPT report)`;
}

export function reportMarkdown(original: string, originalUrl?: string): string {
  const source = (label = "Sources in original ChatGPT report") => sourceReference(label, originalUrl);
  let output = original.replace(/([^]+)([\s\S]*?)/g, (token, kind: string, value: string) => {
    if (/^(cite|filecite)$/i.test(kind)) return source(/file/i.test(kind) ? "File reference in original ChatGPT report" : undefined);
    if (kind.toLowerCase() === "genui") {
      try { const data = JSON.parse(value); if (data?.citation) return source(); } catch { /* Preserve unrecognised content as text. */ }
    }
    if (kind.toLowerCase() === "entity") {
      try { const data = JSON.parse(value); const label = Array.isArray(data) ? data[1] : data.value || data.name; if (typeof label === "string") return escapeText(label); } catch { /* Preserve unrecognised content as text. */ }
    }
    return token;
  });
  const blocks = new Set(["box", "row", "column", "stack", "grid", "card", "container", "divider"]);
  output = output.replace(/<(\/?)([a-zA-Z][\w:-]*)([^<>]*?)>/g, (tag, closing: string, rawName: string, rawAttributes: string) => {
    const name = rawName.toLowerCase(); const props = attributes(rawAttributes);
    if (blocks.has(name)) return "\n\n";
    if (name === "title") return closing ? "\n\n" : "\n\n### ";
    if (name === "text" || name === "paragraph") return "\n\n";
    if (name === "badge") return closing ? "**\n\n" : "\n\n**";
    if (name === "entity") return closing ? "" : escapeText(props.value || props.name || props.title || "");
    if (name === "cite" || name === "filecite") return closing ? "" : source(name === "filecite" ? "File reference in original ChatGPT report" : undefined);
    if (name === "asyncimage" || name === "image" || name === "video" || name === "asyncvideo") return closing ? "" : `\n\n${source(/video/.test(name) ? "Original video available in ChatGPT" : "Original image available in ChatGPT")}\n\n`;
    if (name === "link") {
      if (closing) return "";
      const title = props.title || props.label || props.url || "Open original link";
      const href = safeHref(props.url || props.href);
      return href ? `\n\n[${escapeText(title)}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})\n\n` : escapeText(title);
    }
    return tag;
  });
  return output;
}


/** Reveal saved report sections; discard only inactive UI controls and unsafe presentation. */
export function revealOriginalReport() {
  return (tree: any) => {
    const visit = (parent: any) => {
      if (!Array.isArray(parent.children)) return;
      parent.children = parent.children.filter((node: any) => {
        if (node.type !== "element") return true;
        const properties = node.properties || (node.properties = {});
        const role = String(properties.role || "").toLowerCase();
        const classes = Array.isArray(properties.className) ? properties.className.join(" ") : String(properties.className || "");
        const elements = (node.children || []).filter((child: any) => child.type === "element");
        const tabButtons = elements.some((child: any) => child.tagName === "button" || child.properties?.role === "tab");
        const hasReportContent = (child: any): boolean => child?.type === "element" && (["section", "article", "main", "table", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "details"].includes(child.tagName) || child.properties?.role === "tabpanel" || (child.children || []).some(hasReportContent));
        const reportSections = elements.some(hasReportContent);
        const isTabNavigation = role === "tablist" || (!reportSections && (/(?:^|\s)(?:tab[-_ ]?(?:bar|nav|list|buttons|controls)|tabs-nav|nav-tabs)(?:\s|$)/i.test(classes) || (tabButtons && (node.tagName === "nav" || /tabs?|nav/i.test(classes)))));
        if (isTabNavigation || (node.tagName === "button" && role === "tab") || ["script", "style", "iframe", "object", "embed"].includes(node.tagName)) return false;
        if (node.tagName === "input" && properties.type === "hidden") return false;
        const inlineStyle = String(properties.style || "");
        delete properties.hidden; delete properties.inert; delete properties.ariaHidden; delete properties.style;
        if (role === "tabpanel" || role === "tab") { delete properties.role; delete properties.ariaLabelledBy; delete properties.ariaSelected; delete properties.tabIndex; }
        if (node.tagName === "details") node.tagName = "section";
        if (node.tagName === "summary") node.tagName = "h3";
        if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(inlineStyle) && !["strong", "b"].includes(node.tagName)) node.children = [{ type: "element", tagName: "strong", properties: {}, children: node.children || [] }];
        if (/font-style\s*:\s*italic/i.test(inlineStyle) && !["em", "i"].includes(node.tagName)) node.children = [{ type: "element", tagName: "em", properties: {}, children: node.children || [] }];
        visit(node);
        return true;
      });
    };
    visit(tree);
  };
}
const reportSchema = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...(defaultSchema.tagNames || []), "section", "article", "header", "footer", "main", "aside", "figure", "figcaption", "caption", "u"])),
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] || []).filter((attribute: any) => !["hidden", "inert", "ariaHidden", "style"].includes(Array.isArray(attribute) ? attribute[0] : attribute)),
  },
};

export default function ReportContent({ body, originalUrl }: { body: string; originalUrl?: string }) {
  if (!body) return <p className="report-empty">No original report text is available for this saved update.</p>;
  return <div className="report-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, revealOriginalReport, [rehypeSanitize, reportSchema]]} urlTransform={url => safeHref(url) || ""} components={{
    a: ({ node: _node, href, children, ...props }) => href ? <a {...props} href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
    table: ({ node: _node, ...props }) => <div className="report-table-scroll" style={{ overflowX: "auto" }}><table {...props}/></div>,
    img: ({ node: _node, src, alt, ...props }) => typeof src === "string" && safeHref(src) ? <img {...props} src={src} alt={alt || "Image from the original report"} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: "100%", height: "auto" }}/> : <span>{alt || "Image available in the original report"}</span>,
  }}>{reportMarkdown(body, originalUrl)}</ReactMarkdown></div>;
}
