import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTableFromMarkdown, gfmTableToMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmStrikethroughFromMarkdown, gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";
import type { Processor } from "unified";

type FromMarkdownExtension = ReturnType<typeof gfmTableFromMarkdown>;
type ReportMarkdownData = {
  micromarkExtensions?: ReturnType<typeof gfmTable>[];
  fromMarkdownExtensions?: Array<FromMarkdownExtension | FromMarkdownExtension[]>;
  toMarkdownExtensions?: ReturnType<typeof gfmTableToMarkdown>[];
};

/**
 * Keep report tables, task lists and strikethrough without loading GFM's literal
 * autolink extension, whose regexp lookbehind prevents older Safari from even
 * parsing the client bundle. Standard Markdown links remain supported by the
 * existing Markdown parser; source report text is not rewritten.
 */
export default function remarkReportGfm(this: Processor): void {
  const data = this.data() as ReportMarkdownData;
  const micromark = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdown = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);
  const toMarkdown = data.toMarkdownExtensions || (data.toMarkdownExtensions = []);
  micromark.push(gfmTable(), gfmTaskListItem(), gfmStrikethrough());
  fromMarkdown.push(gfmTableFromMarkdown(), gfmTaskListItemFromMarkdown(), gfmStrikethroughFromMarkdown());
  toMarkdown.push(gfmTableToMarkdown(), gfmTaskListItemToMarkdown(), gfmStrikethroughToMarkdown());
}
