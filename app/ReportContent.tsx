"use client";

import React, { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkReportGfm from "./report-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "./dashboard-report.css";

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

function nodeText(node: any): string {
  return node?.type === "text" ? node.value : (node?.children || []).map(nodeText).join("");
}

/** Recover report structure before throwing away the saved page's inactive controls. */
function rememberDashboardStructure() {
  return (tree: any) => {
    const labels = new Map<string, string>();
    const visit = (node: any, visitor: (node: any) => void) => {
      visitor(node);
      for (const child of node.children || []) visit(child, visitor);
    };
    visit(tree, node => {
      if (node.type !== "element") return;
      const props = node.properties || {};
      if (props.role === "tab" && props.ariaControls) labels.set(String(props.ariaControls), nodeText(node).trim());
    });
    visit(tree, node => {
      if (node.type !== "element") return;
      const props = node.properties || {};
      const classes = Array.isArray(props.className) ? props.className : String(props.className || "").split(/\s+/);
      const data = node.data || (node.data = {});
      if (props.role === "tabpanel") {
        data.dashboardPanel = true;
        data.dashboardLabel = labels.get(String(props.id || ""));
      }
      // Only these presentation hints survive. Source CSS and handlers never do.
      if (classes.includes("viz-grid")) data.dashboardStyle = "dashboard-report-stats";
      else if (classes.includes("viz-stat")) data.dashboardStyle = "dashboard-report-stat";
      else if (classes.includes("viz-stat-value")) data.dashboardStyle = "dashboard-report-stat-value";
      else if (classes.includes("text-muted")) data.dashboardStyle = "dashboard-report-muted";
    });
  };
}

/** Presentation-only heading recognition for existing plain-text saved summaries. */
export function dashboardMarkdown(original: string, originalUrl?: string): string {
  const markdown = reportMarkdown(original, originalUrl);
  if (/<(?:article|main|section|table|pre|h[1-6])[\s>]/i.test(markdown)) return markdown;
  let fence: { marker: string; length: number } | null = null;
  return markdown.split("\n").map((line, index, lines) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (marker) { fence = { marker: marker[1][0], length: marker[1].length }; return line; }
    const text = line.trim();
    const startsBlock = index === 0 || !lines[index - 1].trim();
    const uppercaseTitle = text.length >= 6 && text.length <= 160 && /[A-Z]/.test(text) && /^[A-Z0-9\s&—–:()\/,.'’+\-]+$/.test(text);
    if (startsBlock && uppercaseTitle) return `## ${line}`;
    if (/^\s*•\s+/.test(line)) return line.replace(/^(\s*)•\s+/, "$1- ");
    if (/^\s*□\s+/.test(line)) return line.replace(/^(\s*)/, "$1- ");
    if (startsBlock && text.length < 80 && /^[A-Za-z][A-Za-z0-9 &'’–—-]+$/.test(text) && /^\s*□\s+/.test(lines[index + 1] || "")) return `### ${line}`;
    return line;
  }).join("\n");
}

/** Build fresh UI from sanitised content; never reactivate the original page's scripts. */
function groupDashboardSections() {
  return (tree: any) => {
    const group = (parent: any) => {
      if (!Array.isArray(parent.children)) return;
      const children = parent.children;
      const originalPanels = children.filter((node: any) => node.data?.dashboardPanel);
      const headingLevel = ["h2", "h1", "h3"].find(tag => children.filter((node: any) => node.tagName === tag).length >= 2);
      const semanticSections = children.filter((node: any) => ["section", "article"].includes(node.tagName) && (node.children || []).some((child: any) => /^h[1-4]$/.test(child.tagName)));
      const isBoundary = originalPanels.length >= 2
        ? (node: any) => !!node.data?.dashboardPanel
        : headingLevel ? (node: any) => node.tagName === headingLevel
        : semanticSections.length >= 2 ? (node: any) => semanticSections.includes(node) : undefined;
      if (isBoundary) {
        const first = children.findIndex(isBoundary);
        const panels: any[] = [];
        for (const child of children.slice(first)) {
          if (isBoundary(child)) {
            const heading = /^h[1-6]$/.test(child.tagName) ? child : (child.children || []).find((node: any) => /^h[1-6]$/.test(node.tagName));
            const title = child.data?.dashboardLabel || nodeText(heading).trim().split(/\s[—–]\s/)[0];
            panels.push({ type: "element", tagName: "section", properties: {}, children: [child], data: { dashboardTitle: title } });
          } else if (panels.length) panels[panels.length - 1].children.push(child);
        }
        parent.children = [...children.slice(0, first), { type: "element", tagName: "div", properties: {}, data: { dashboardTabs: true, dashboardLabels: panels.map(panel => panel.data.dashboardTitle) }, children: panels }];
        return;
      }
      for (const child of children) if (child.type === "element" && ["article", "main", "div", "section"].includes(child.tagName)) group(child);
    };
    group(tree);
  };
}

export function DashboardTabs({ labels, children }: { labels: string[]; children: React.ReactNode }) {
  const [active, setActive] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const id = `dashboard-${useId().replace(/[^a-z0-9_-]/gi, "")}`;
  const panels = React.Children.toArray(children);
  const select = (index: number) => { setActive(index); setShowAll(false); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % labels.length;
    else if (event.key === "ArrowLeft") next = (index + labels.length - 1) % labels.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = labels.length - 1;
    else return;
    event.preventDefault();
    select(next);
    (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
  };
  return <div className="dashboard-report-sections">
    <div className="dashboard-report-navigation"><div className="dashboard-report-tabs" role="tablist" aria-label="Dashboard sections">{labels.map((label, index) => <button key={index} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => select(index)} onKeyDown={event => onKeyDown(event, index)}>{label}</button>)}</div><button type="button" className="dashboard-report-show-all" aria-pressed={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Show one section" : "Show all sections"}</button></div>
    <div className="dashboard-report-panels">{panels.map((panel, index) => <div key={index} className="dashboard-report-panel" id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={!showAll && active !== index}>{panel}</div>)}</div>
  </div>;
}

export default function ReportContent({ body, originalUrl, presentation = "document" }: { body: string; originalUrl?: string; presentation?: "document" | "dashboard" }) {
  if (!body) return <p className="report-empty">No original report text is available for this saved update.</p>;
  const dashboard = presentation === "dashboard";
  return <div className={`report-content${dashboard ? " dashboard-report" : ""}`}><ReactMarkdown remarkPlugins={[remarkReportGfm]} rehypePlugins={dashboard ? [rehypeRaw, rememberDashboardStructure, revealOriginalReport, [rehypeSanitize, reportSchema], groupDashboardSections] : [rehypeRaw, revealOriginalReport, [rehypeSanitize, reportSchema]]} urlTransform={url => safeHref(url) || ""} components={{
    div: ({ node, children, ...props }) => {
      const data = node?.data as { dashboardTabs?: boolean; dashboardLabels?: string[]; dashboardStyle?: string } | undefined;
      return data?.dashboardTabs ? <DashboardTabs labels={data.dashboardLabels || []}>{children}</DashboardTabs> : <div {...props} className={dashboard ? data?.dashboardStyle : undefined}>{children}</div>;
    },
    a: ({ node: _node, href, children, ...props }) => href ? <a {...props} href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
    table: ({ node: _node, ...props }) => <div className="report-table-scroll" style={{ overflowX: "auto" }}><table {...props}/></div>,
    img: ({ node: _node, src, alt, ...props }) => typeof src === "string" && safeHref(src) ? <img {...props} src={src} alt={alt || "Image from the original report"} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: "100%", height: "auto" }}/> : <span>{alt || "Image available in the original report"}</span>,
  }}>{dashboard ? dashboardMarkdown(body, originalUrl) : reportMarkdown(body, originalUrl)}</ReactMarkdown></div>;
}
