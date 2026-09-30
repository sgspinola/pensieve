import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { TagFilterInput } from "./TagFilterInput";

/**
 * `TagFilterInput` is a hook-free function component: calling it directly
 * (as done here) executes its render logic and returns a plain React
 * element tree, with no DOM/jsdom involved — consistent with this repo's
 * "Vitest is service-layer/pure-function only" convention. Real
 * render/hydration coverage lives in the Playwright spec for the study flow.
 */
type Node = ReactElement<{ children?: unknown; [key: string]: unknown }>;

function isElement(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "props" in value;
}

function collect(node: unknown, predicate: (el: Node) => boolean, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (predicate(node)) out.push(node);
  if (node.props && "children" in node.props) {
    collect(node.props.children, predicate, out);
  }
  return out;
}

function findOne(tree: unknown, predicate: (el: Node) => boolean): Node {
  const matches = collect(tree, predicate);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("TagFilterInput", () => {
  it("renders an input reflecting the current value and reports typing via onChange", () => {
    const onChange = vi.fn();
    const tree = TagFilterInput({
      id: "study-tag-filter",
      className: "field-wrap",
      tags: ["alpha", "beta"],
      value: "al",
      onChange,
      children: () => null,
    });

    const input = findOne(tree, (el) => el.type === "input");
    expect(input.props.value).toBe("al");
    expect(input.props.type).toBe("search");
    expect(input.props.id).toBe("study-tag-filter");

    // The wrapper renders with exactly the caller-supplied className — no
    // base class of the component's own layered on top of it — since every
    // caller is expected to reach the shared layout via CSS Modules
    // `composes` (see StudySession.module.css's `.filterField`) rather than
    // getting it appended here too.
    const wrapper = findOne(tree, (el) => el.props?.className === "field-wrap");
    expect(wrapper.type).toBe("div");

    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "alp" } });
    expect(onChange).toHaveBeenCalledWith("alp");
  });

  it("narrows the tags passed to children as the query changes", () => {
    const children = vi.fn(() => null);
    TagFilterInput({
      id: "study-tag-filter",
      className: "field-wrap",
      tags: ["Networking", "Cryptography", "Unrelated"],
      value: "crypt",
      onChange: vi.fn(),
      children,
    });

    expect(children).toHaveBeenCalledWith(["Cryptography"]);
  });

  it("hides the clear control when the query is empty", () => {
    const tree = TagFilterInput({
      id: "study-tag-filter",
      className: "field-wrap",
      tags: ["alpha"],
      value: "",
      onChange: vi.fn(),
      children: () => null,
    });

    expect(collect(tree, (el) => el.props?.["aria-label"] === "Clear tag filter")).toHaveLength(0);
  });

  it("shows a clear control that resets the query when clicked", () => {
    const onChange = vi.fn();
    const tree = TagFilterInput({
      id: "study-tag-filter",
      className: "field-wrap",
      tags: ["alpha"],
      value: "al",
      onChange,
      children: () => null,
    });

    const clearButton = findOne(tree, (el) => el.props?.["aria-label"] === "Clear tag filter");
    (clearButton.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows a 'no tags match' empty state instead of children when nothing matches", () => {
    const children = vi.fn(() => null);
    const tree = TagFilterInput({
      id: "study-tag-filter",
      className: "field-wrap",
      tags: ["alpha"],
      value: "zzz",
      onChange: vi.fn(),
      children,
    });

    const message = findOne(tree, (el) => el.type === "p");
    const flatText = JSON.stringify(message.props.children);
    expect(flatText).toContain("No tags match");
    expect(flatText).toContain("zzz");
    expect(children).not.toHaveBeenCalled();
  });
});
