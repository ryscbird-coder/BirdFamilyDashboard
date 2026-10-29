import test from "node:test";
import assert from "node:assert/strict";
import { modalFocusables, trapModalFocus } from "../app/modal-focus.ts";

// Synthetic DOM surfaces exercise the real helper without claiming browser QA.
type NodeState = {
  id: string;
  tabIndex: number;
  disabled: boolean;
  hidden: boolean;
  inert: boolean;
  ariaHidden: boolean;
  display: string;
  visibility: string;
  rectCount: number;
  parent?: NodeState;
  focusCount: number;
};
function node(id: string, options: Partial<NodeState> = {}) {
  const state: NodeState = { id, tabIndex: 0, disabled: false, hidden: false, inert: false, ariaHidden: false, display: "block", visibility: "visible", rectCount: 1, focusCount: 0, ...options };
  const element = {
    id,
    get tabIndex() { return state.tabIndex; },
    matches(selector: string) { assert.equal(selector, ":disabled"); return state.disabled; },
    closest(selector: string) {
      assert.equal(selector, '[hidden],[inert],[aria-hidden="true"]');
      let current: NodeState | undefined = state;
      while (current) { if (current.hidden || current.inert || current.ariaHidden) return element; current = current.parent; }
      return null;
    },
    ownerDocument: { defaultView: { getComputedStyle() { return { display: state.display, visibility: state.visibility }; } } },
    getClientRects() { return Array.from({ length: state.rectCount }, () => ({})); },
    focus() { state.focusCount++; },
  } as unknown as HTMLElement;
  return { element, state };
}
type StubNode = ReturnType<typeof node>;
function root(nodes: StubNode[]) {
  const state = { focusCount: 0, queries: 0 };
  const element = {
    querySelectorAll(selector: string) {
      assert.equal(selector, "button,input,select,textarea,a[href],[tabindex]");
      state.queries++;
      return nodes.map(item => item.element);
    },
    focus() { state.focusCount++; },
  } as unknown as HTMLElement;
  return { element, state };
}
function key(key = "Tab", shiftKey = false) {
  const state = { prevented: 0 };
  return { event: { key, shiftKey, preventDefault() { state.prevented++; } }, state };
}

test("modal focus excludes hidden dashboard links, inactive tabs, disabled and CSS-hidden controls", () => {
  const hiddenPanel = node("inactive-panel", { hidden: true });
  const inertPanel = node("inert-panel", { inert: true });
  const ariaPanel = node("aria-hidden-panel", { ariaHidden: true });
  const controls = [
    node("close"), node("selected-tab"), node("inactive-tab", { tabIndex: -1 }),
    node("hidden-panel-link", { parent: hiddenPanel.state }),
    node("inert-link", { parent: inertPanel.state }),
    node("aria-hidden-link", { parent: ariaPanel.state }),
    node("disabled-input", { disabled: true }), node("display-none", { display: "none" }),
    node("visibility-hidden", { visibility: "hidden" }), node("no-layout-rect", { rectCount: 0 }),
    node("explicit-tabindex-zero"), node("explicit-positive-tabindex", { tabIndex: 2 }),
  ];
  const modal = root(controls);
  assert.deepEqual(modalFocusables(modal.element).map(element => element.id), ["close", "selected-tab", "explicit-tabindex-zero", "explicit-positive-tabindex"]);
});

test("modal Tab wraps at visible boundaries and lets the browser handle interior movement", () => {
  const first = node("first"), middle = node("middle"), last = node("last");
  const modal = root([first, middle, last]);
  const forward = key();
  assert.equal(trapModalFocus(forward.event, modal.element, last.element), true);
  assert.equal(first.state.focusCount, 1); assert.equal(forward.state.prevented, 1);
  const backward = key("Tab", true);
  assert.equal(trapModalFocus(backward.event, modal.element, first.element), true);
  assert.equal(last.state.focusCount, 1); assert.equal(backward.state.prevented, 1);
  const interior = key();
  assert.equal(trapModalFocus(interior.event, modal.element, middle.element), false);
  assert.equal(interior.state.prevented, 0);
  assert.equal(middle.state.focusCount, 0);
});

test("a dashboard pane switch immediately changes the focus boundary and recovers its hidden active link", () => {
  const close = node("close"), firstPane = node("first-panel"), secondPane = node("second-panel", { hidden: true });
  const firstLink = node("first-panel-link", { parent: firstPane.state });
  const secondLink = node("second-panel-link", { parent: secondPane.state });
  const modal = root([close, firstLink, secondLink]);
  assert.deepEqual(modalFocusables(modal.element).map(element => element.id), ["close", "first-panel-link"]);
  firstPane.state.hidden = true; secondPane.state.hidden = false;
  const switched = key();
  assert.equal(trapModalFocus(switched.event, modal.element, secondLink.element), true);
  assert.equal(close.state.focusCount, 1, "the latest visible last link must wrap to the first control");
  const staleFocus = key("Tab", true);
  assert.equal(trapModalFocus(staleFocus.event, modal.element, firstLink.element), true);
  assert.equal(secondLink.state.focusCount, 1, "Shift+Tab from now-hidden content must recover to the visible last control");
  assert.equal(firstLink.state.focusCount, 0);
  assert.equal(switched.state.prevented, 1); assert.equal(staleFocus.state.prevented, 1);
});

test("outside or missing focus is recovered in the requested tab direction", () => {
  const first = node("first"), last = node("last"), outside = node("outside-modal");
  const modal = root([first, last]);
  const forward = key();
  assert.equal(trapModalFocus(forward.event, modal.element, outside.element), true);
  assert.equal(first.state.focusCount, 1); assert.equal(forward.state.prevented, 1);
  const backward = key("Tab", true);
  assert.equal(trapModalFocus(backward.event, modal.element, null), true);
  assert.equal(last.state.focusCount, 1); assert.equal(backward.state.prevented, 1);
  assert.equal(outside.state.focusCount, 0);
});

test("an empty modal retains keyboard focus on the modal itself", () => {
  const modal = root([node("hidden-link", { hidden: true }), node("inactive-tab", { tabIndex: -1 })]);
  for (const backwards of [false, true]) {
    const tab = key("Tab", backwards);
    assert.equal(trapModalFocus(tab.event, modal.element, null), true);
    assert.equal(tab.state.prevented, 1);
  }
  assert.equal(modal.state.focusCount, 2);
});

test("unrelated keys are left untouched without querying or moving modal focus", () => {
  const first = node("first"), modal = root([first]), escape = key("Escape");
  assert.equal(trapModalFocus(escape.event, modal.element, first.element), false);
  assert.equal(escape.state.prevented, 0);
  assert.equal(first.state.focusCount, 0); assert.equal(modal.state.focusCount, 0); assert.equal(modal.state.queries, 0);
});
