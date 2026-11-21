"use strict";

// Content scripts in one frame share an isolated JavaScript scope.
const HintTargets = (() => {
  const explicitAction = [
    "a[href]", "button", "input:not([type=hidden i])", "textarea", "select",
    "summary", "[onclick]", "[contenteditable]:not([contenteditable=false i])",
    ...["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox",
      "menuitemradio", "option", "combobox", "textbox", "searchbox", "treeitem"]
      .map(role => `[role~="${role}" i]`)
  ].join(",");
  const selector = explicitAction + ",[tabindex]";
  const isFrame = el => el.localName === "iframe" || el.localName === "frame";
  const parent = el => el.assignedSlot || el.parentElement || el.getRootNode().host;
  const viewport = doc => ({
    left: 0, top: 0, right: doc.defaultView.innerWidth, bottom: doc.defaultView.innerHeight
  });

  function intersect(a, b) {
    const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
    return box.left < box.right && box.top < box.bottom ? box : null;
  }

  function inside(hit, target) {
    for (let el = hit; el; el = parent(el)) {
      if (el === target) return true;
    }
    return false;
  }

  function hitAt(doc, x, y) {
    let hit = doc.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit || !inside(inner, hit)) break;
      hit = inner;
    }
    return hit;
  }

  function available(el) {
    if (!el.isConnected || el.matches(":disabled") ||
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    for (let p = el; p; p = parent(p)) {
      if (p.inert || p.getAttribute("aria-disabled")?.toLowerCase() === "true") return false;
    }
    return true;
  }

  function context(doc, bounds = viewport(doc), outer = null) {
    return { doc, bounds, outer, clips: new WeakMap() };
  }

  // Cache shared ancestor clips for this layout pass. Hit testing below also
  // accounts for overlapping siblings, sticky headers, masks and top-layer UI.
  function childClip(el, ctx) {
    if (!el) return ctx.bounds;
    if (ctx.clips.has(el)) return ctx.clips.get(el);
    let clip = childClip(parent(el), ctx);
    if (clip && el !== ctx.doc.documentElement) {
      const css = ctx.doc.defaultView.getComputedStyle(el);
      if (css.overflowX !== "visible" || css.overflowY !== "visible") {
        const r = el.getBoundingClientRect();
        clip = intersect(clip, {
          left: css.overflowX === "visible" ? clip.left : r.left,
          right: css.overflowX === "visible" ? clip.right : r.right,
          top: css.overflowY === "visible" ? clip.top : r.top,
          bottom: css.overflowY === "visible" ? clip.bottom : r.bottom
        });
      }
    }
    ctx.clips.set(el, clip);
    return clip;
  }

  function frameContext(frame, doc, ctx) {
    const rect = frame.getBoundingClientRect();
    const sx = rect.width / frame.offsetWidth;
    const sy = rect.height / frame.offsetHeight;
    if (!(sx > 0 && sy > 0)) return null;
    const x = rect.left + frame.clientLeft * sx;
    const y = rect.top + frame.clientTop * sy;
    const clip = childClip(parent(frame), ctx);
    if (!clip) return null;
    const bounds = intersect(viewport(doc), {
      left: (clip.left - x) / sx, right: (clip.right - x) / sx,
      top: (clip.top - y) / sy, bottom: (clip.bottom - y) / sy
    });
    return bounds && context(doc, bounds, { frame, ctx, x, y, sx, sy });
  }

  function startingContext(doc) {
    const frame = doc.defaultView.frameElement;
    if (!frame) return context(doc);
    const outer = startingContext(frame.ownerDocument);
    return outer && available(frame) ? frameContext(frame, doc, outer) : null;
  }

  function projectPoint(ctx, x, y) {
    let at;
    for (;;) {
      if (ctx.overlayRoot) at = { x, y };
      if (!ctx.outer) return at;
      const outer = ctx.outer;
      x = outer.x + x * outer.sx;
      y = outer.y + y * outer.sy;
      ctx = outer.ctx;
      if (hitAt(ctx.doc, x, y) !== outer.frame) return null;
    }
  }

  function pointFor(el, ctx) {
    const clip = childClip(parent(el), ctx);
    if (!clip || !available(el)) return null;
    for (const rect of el.getClientRects()) {
      const box = intersect(rect, clip);
      if (!box) continue;
      const dx = Math.min(3, (box.right - box.left) / 2);
      const dy = Math.min(3, (box.bottom - box.top) / 2);
      const xs = [box.left + dx, (box.left + box.right) / 2, box.right - dx];
      const ys = [box.top + dy, (box.top + box.bottom) / 2, box.bottom - dy];
      for (const y of ys) {
        for (const x of xs) {
          const hit = hitAt(ctx.doc, x, y);
          if (!inside(hit, el)) continue;
          const at = projectPoint(ctx, x, y);
          if (at) return { at, x, y, hit };
        }
      }
    }
    return null;
  }

  function collect(rootDoc, overlayHost) {
    const targets = [];
    const roots = [];
    function visit(root, ctx) {
      roots.push(root);
      const stack = Array.from(root.children).reverse();
      while (stack.length) {
        const el = stack.pop();
        if (el === overlayHost) continue;
        if (isFrame(el)) {
          const p = pointFor(el, ctx);
          if (!p) continue;
          const doc = el.contentDocument;
          const inner = doc?.documentElement && frameContext(el, doc, ctx);
          if (inner) {
            visit(doc, inner);
          } else {
            targets.push({ el, ...p });
          }
          continue;
        }
        if (el.matches(selector) && (el.tabIndex >= 0 || el.matches(explicitAction))) {
          const p = pointFor(el, ctx);
          if (p) targets.push({ el, ...p });
        }
        if (el.shadowRoot) {
          visit(el.shadowRoot, ctx);
        } else {
          const assigned = el.localName === "slot" && el.assignedElements({ flatten: true });
          const children = assigned?.length ? assigned : el.children;
          for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
      }
    }
    const start = startingContext(rootDoc);
    if (start) {
      start.overlayRoot = true;
      visit(rootDoc, start);
    }
    return { targets, roots };
  }

  function activate({ el, x, y, hit }) {
    if (isFrame(el)) {
      el.focus({ preventScroll: true });
      el.contentWindow?.focus();
      return;
    }
    const win = el.ownerDocument.defaultView;
    const mouse = { view: win, bubbles: true, composed: true, cancelable: true,
      button: 0, clientX: x, clientY: y, detail: 1 };
    const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const down = hit.dispatchEvent(new win.PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    if (down && hit.dispatchEvent(new win.MouseEvent("mousedown", { ...mouse, buttons: 1 }))) {
      el.focus?.({ preventScroll: true });
    }
    hit.dispatchEvent(new win.PointerEvent("pointerup", pointer));
    if (down) hit.dispatchEvent(new win.MouseEvent("mouseup", mouse));
    if (el.isConnected && hit.isConnected) hit.dispatchEvent(new win.PointerEvent("click", pointer));
  }

  return { collect, activate, parent, hitAt, isFrame };
})();
