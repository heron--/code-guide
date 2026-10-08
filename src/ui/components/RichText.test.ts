import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RichText } from "./RichText";

const html = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

test("repository links with lines become file:line chips; web links stay links", () => {
  const out = html("See [the parser](src/a.ts#L3-L9) and [the docs](https://x.dev/a#L5).");
  expect(out).toContain(">a.ts:3–9</button>");
  expect(out).toContain('<a href="https://x.dev/a#L5" target="_blank" rel="noreferrer"');
});

test("cites paths with spaces, written as CommonMark allows", () => {
  expect(html("[it](<my dir/a b.ts#L2-L3>)")).toContain('title="my dir/a b.ts, lines 2–3"');
});

test("keeps an ordered list's numbers", () => {
  expect(html("3. three\n4. four")).toMatch(/<ol start="3"[^>]*>\s*<li[^>]*>three<\/li>/);
});

test("raw HTML shows as text, and comments are dropped", () => {
  const out = html("<!-- template -->\n\nHi <b onclick=x>there</b>\n\n<script>alert(1)</script>");
  expect(out).not.toContain("template");
  expect(out).not.toContain("<b ");
  expect(out).not.toContain("<script");
  expect(out).toContain("&lt;b onclick=x&gt;there&lt;/b&gt;");
});

test("code blocks keep what they hold, comments included", () => {
  expect(html("```html\n<!-- keep -->\n```")).toContain("&lt;!-- keep --&gt;");
});

test("URLs with parentheses stay whole", () => {
  expect(html("[w](https://en.wikipedia.org/wiki/Foo_(bar))")).toContain(
    'href="https://en.wikipedia.org/wiki/Foo_(bar)"',
  );
});
