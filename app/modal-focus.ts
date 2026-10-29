const focusSelector = "button,input,select,textarea,a[href],[tabindex]";

/** Re-evaluate on each key press: tab changes can hide the previously last link. */
export function modalFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusSelector)).filter(element => {
    if (element.tabIndex < 0 || element.matches(":disabled") || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return style?.visibility !== "hidden" && style?.display !== "none" && element.getClientRects().length > 0;
  });
}

export function trapModalFocus(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, root: HTMLElement, activeElement: Element | null): boolean {
  if (event.key !== "Tab") return false;
  const focusables = modalFocusables(root);
  const first = focusables[0], last = focusables[focusables.length - 1];
  const activeIsVisible = focusables.includes(activeElement as HTMLElement);
  if (!first || !activeIsVisible || event.shiftKey && activeElement === first || !event.shiftKey && activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
    if (!first) root.focus();
    return true;
  }
  return false;
}
