import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderChatMarkdown } from "../src/chat-markdown.mjs";

function fixture() {
  const dom = new JSDOM("<!doctype html><div id='message'></div>", {
    url: "https://devmoter.example/chat"
  });
  return { dom, target: dom.window.document.querySelector("#message") };
}

test("Markdown renders GFM structure and wraps wide content", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  renderChatMarkdown(target, [
    "# Plan", "", "A **bold** and *italic* paragraph with `a < b` and ~~old~~.", "",
    "> A quote", "", "1. First", "2. Second", "", "- [x] Done", "- [ ] Pending", "",
    "| Name | Value |", "| :--- | ---: |", "| test | 3 |", "",
    "```js", "const value = 3;", "```"
  ].join("\n"), () => {});

  assert.equal(target.querySelector("h1").textContent, "Plan");
  assert.equal(target.querySelector("strong").textContent, "bold");
  assert.equal(target.querySelector("em").textContent, "italic");
  assert.equal(target.querySelector("p code").textContent, "a < b");
  assert.equal(target.querySelector("del").textContent, "old");
  assert.equal(target.querySelectorAll("ol li").length, 2);
  assert.match(target.querySelector("ul").textContent, /☑ Done/);
  assert.equal(target.querySelector("blockquote p").textContent, "A quote");
  assert.equal(target.querySelector(".dm-markdown-table td").textContent, "test");
  assert.equal(target.querySelector(".dm-code-language").textContent, "js");
  assert.equal(target.querySelector(".dm-code-block pre code").textContent, "const value = 3;\n");
  assert.equal(target.querySelector("button").getAttribute("type"), "button");
});

test("raw HTML and SVG stay inert and Markdown images load no resources", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  const attack = [
    '<script>globalThis.compromised = true</script>',
    '<img src="https://tracker.example/pixel" onerror="alert(1)">',
    '<svg onload="alert(1)"><a href="javascript:alert(1)">run</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form><input autofocus onfocus="alert(1)"></form>',
    '![attachment](https://tracker.example/markdown.png)',
    '[safe](https://example.com "\" onmouseover=\"alert(1)")'
  ].join("\n\n");
  renderChatMarkdown(target, attack, () => {});
  assert.equal(target.querySelector("script,img,svg,iframe,form,input"), null);
  assert.match(target.textContent, /<script>globalThis\.compromised = true<\/script>/);
  assert.match(target.textContent, /attachment/);
  for (const element of target.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.ok(!/^on/i.test(attribute.name), `unexpected handler: ${attribute.name}`);
    }
  }
  assert.equal(dom.window.compromised, undefined);
});

test("links reject dangerous schemes and protect external navigation", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  renderChatMarkdown(target, [
    "[js](javascript:alert%281%29)", "[data](data:text/html;base64,PHNjcmlwdD4=)",
    "[vb](vbscript:msgbox%281%29)", "[file](file:///etc/passwd)",
    "[control](java\u0009script:alert%281%29)",
    "[https](https://example.com/path?q=1&x=2)", "[http](http://example.com)",
    "[relative](/docs)", "[hash](#section)", "[mail](mailto:hello@example.com)",
    "[network](//example.com/reference)"
  ].join("\n\n"), () => {});
  const links = [...target.querySelectorAll("a")];
  assert.deepEqual(links.map(link => link.textContent), ["https", "http", "relative", "hash", "mail", "network"]);
  for (const link of [links[0], links[1], links[5]]) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
  }
  assert.equal(links[0].getAttribute("href"), "https://example.com/path?q=1&x=2");
  assert.equal(links[2].getAttribute("href"), "/docs");
  assert.equal(links[3].getAttribute("href"), "#section");
});

test("code copy uses the source closure including whitespace even if rendered code changes", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  const copied = [];
  const source = "  const html = '<img onerror=alert(1)>';  \n\n\treturn html;\n";
  renderChatMarkdown(target, `\`\`\`html\n${source}\`\`\``, text => copied.push(text));
  assert.equal(target.querySelector("pre code").textContent, source);
  assert.equal(target.querySelector("img"), null);
  target.querySelector("pre code").textContent = "modified rendered DOM";
  target.querySelector("button").click();
  assert.deepEqual(copied, [source]);
});

test("rerenders replace controls and use only the latest source and callback", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  const stale = [];
  const current = [];
  renderChatMarkdown(target, "```\nold\n```", text => stale.push(text));
  for (let update = 0; update < 12; update += 1) {
    renderChatMarkdown(target, `\`\`\`\nnew ${update}\n\`\`\``, text => current.push(text));
  }
  assert.equal(target.querySelectorAll(".dm-code-copy").length, 1);
  target.querySelector("button").click();
  assert.deepEqual(stale, []);
  assert.deepEqual(current, ["new 11\n"]);
});

test("partial streamed Markdown is safe and completes correctly", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  const copied = [];
  for (const partial of ["", "**par", "[link](java", "<script", "```js\n  a\n", "```js\n  a\n\n"]) {
    assert.doesNotThrow(() => renderChatMarkdown(target, partial, text => copied.push(text)));
    assert.equal(target.querySelector("script,img,svg"), null);
  }
  target.querySelector("button").click();
  assert.deepEqual(copied, ["  a\n\n"]);
  renderChatMarkdown(target, "**partial completed**", () => {});
  assert.equal(target.querySelector("strong").textContent, "partial completed");
  assert.equal(target.querySelector("button"), null);
});

test("tilde fenced code preserves indentation and trailing lines", t => {
  const { dom, target } = fixture();
  t.after(() => dom.window.close());
  const copied = [];
  renderChatMarkdown(target, "  ~~~text\n    a  \n\n  b\n  ~~~", text => copied.push(text));
  target.querySelector("button").click();
  assert.deepEqual(copied, ["    a  \n\n  b\n"]);
});
