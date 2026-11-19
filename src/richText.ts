/**
 * How to write Proactive rich-text fields (task and project descriptions,
 * knowledge resource notes). Proactive stores these as TipTap HTML and runs
 * them through an allowlist sanitizer (lib/sanitizeHtml.ts in the app), so
 * anything outside this list is silently dropped. Keep the two in step.
 */
export const RICH_TEXT_GUIDE = `Rich-text fields in Proactive (task description, project description, knowledge resource notes) are HTML rendered by a TipTap editor. Always send HTML. Markdown is not converted and shows up as literal "#", "**" and "-" characters. Plain text with newlines collapses into one paragraph.

Supported elements (everything else is stripped):
- Paragraphs and line breaks: <p>text</p>, <br>
- Headings: <h1> to <h6>. These are the only way to change text size; there is no font-size support (font-size styles are removed).
- Inline: <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strikethrough</s>, <code>inline code</code>
- Links: <a href="https://example.com">label</a> (http, https, mailto or relative URLs only)
- Lists: <ul><li><p>item</p></li></ul>, <ol><li><p>item</p></li></ol>. Nest a list inside an <li> for sub-items.
- Quote: <blockquote><p>text</p></blockquote>
- Code block: <pre><code class="language-typescript">code</code></pre> (escape <, > and & inside the code; omit class for plain text)
- Divider: <hr>
- Text color: <span style="color: #ef4444">text</span>
- Highlight (background color): <mark data-color="#fef3c7" style="background-color: #fef3c7">text</mark>
- Alignment on paragraphs and headings: <p style="text-align: center">, values left, center, right, justify
- Tables: <table><tbody><tr><th><p>Header</p></th><th><p>Header</p></th></tr><tr><td><p>Cell</p></td><td><p>Cell</p></td></tr></tbody></table>. Cells accept colspan and rowspan.
- Toggle (collapsible block): <div data-type="toggle"><p>Summary shown when collapsed</p><p>Hidden content</p></div>. The first child is the summary; the rest are hidden until opened.

Colors must be hex (#rgb or #rrggbb) or rgb()/rgba(). The editor palette is #000000, #374151, #6b7280, #ef4444 (red), #f97316 (orange), #eab308 (yellow), #22c55e (green), #14b8a6 (teal), #3b82f6 (blue), #6366f1 (indigo), #a855f7 (purple), #ec4899 (pink), #ffffff, and light highlight tones #fef3c7 (amber), #dbeafe (blue), #f3e8ff (purple). Prefer these so content matches what users pick in the app, and use light tones for highlights so text stays readable.

Images, file attachments and HTML embeds need an uploaded attachment and cannot be created through these tools.

Use structure where it helps: headings for sections, lists for steps and criteria, tables for comparisons, a toggle for long details, and color or highlight sparingly for emphasis.

When updating an existing rich-text field, read it first (task_get, project_get or knowledge_resource_get), edit the returned HTML and send the whole field back. The update replaces the field; it does not append.`;

/** Short form for field descriptions; the full guide is in the server instructions. */
export const RICH_TEXT_FIELD =
  'Rich text. Send HTML, not Markdown or plain text. Allowed: <p>, <h1>-<h6> (the only way to change text size), <strong>, <em>, <u>, <s>, <code>, <a href>, <ul>/<ol>/<li>, <blockquote>, <pre><code class="language-x">, <hr>, <br>, tables (<table><tbody><tr><th>/<td>), toggles (<div data-type="toggle">, first child is the summary), text color <span style="color: #hex">, highlight <mark style="background-color: #hex">, and style="text-align: center|right|justify" on <p> or headings. Other tags and styles are stripped. Updates replace the whole field, so read it first and send back the full HTML.';

/** Server-level instructions sent to the client on initialize. */
export const SERVER_INSTRUCTIONS = `Proactive project and knowledge vault tools.

${RICH_TEXT_GUIDE}`;
