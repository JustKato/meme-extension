# Using the keyboard

## Focus and scrolling

Navigation starts enabled. The `q` setting follows the current tab through reloads and visits to other sites. Closing the tab or restarting the browser clears that tab's setting. A brief message confirms each toggle.

On a normal page, `j` and `k` use Firefox's line scroll and `f` and `b` use its page scroll. With focus inside a vertically scrollable panel, the same keys operate on that panel. `g` and `G` jump to its edges. On an app layout with a fixed outer page, the extension also checks for a scrollable panel at the center of the viewport.

Text inputs, textareas, editable HTML, select menus and common ARIA input widgets keep their typing and IME behavior. Use Tab or Shift+Tab to move focus out of an editor and resume navigation. Modified browser shortcuts pass through. Holding a scroll key repeats the movement. Holding a toggle or hint key performs one action per press.

## Choosing a target

Press `a` to show the letters. Type the label exactly as displayed. The overlay filters as you type and indicates when Enter can choose a shorter label. There is no typing timeout. Backspace corrects a prefix. Esc closes the overlay. Tab closes it and continues normal focus traversal.

The first scan assigns labels in document order, including open shadow roots, slotted content and visible controls inside same-origin frames. Offscreen, clipped, hidden, disabled, inert and covered controls are checked before labels are shown. When scrolling or a site update changes the candidates, surviving elements keep their labels and newly visible ones receive the next letters. Reopening hints starts the alphabet again in current page order. Selection checks the element's visibility again before clicking it.

Targets include links with destinations, native buttons and form controls, expandable summaries, editable hosts, recognized ARIA controls, inline click handlers and focusable custom elements. A separate-origin frame gets an entry label. Select it to give the frame focus, then press `a` again to label its controls. Tab and Shift+Tab can move focus between the frame and its surroundings.

Hint selection delivers a primary pointer and mouse press, focuses the control when appropriate, releases the pointer and sends a click at its visible position. Normal link navigation, new-tab targets, form submissions, checkboxes and page click handlers use their usual DOM behavior. Selecting a text field puts the caret there for typing.

## Firefox compatibility

- Browser chrome, the address bar, built-in pages such as `about:addons`, the PDF viewer and restricted Mozilla domains use Firefox's own keyboard controls. The extension runs on permitted HTTP, HTTPS and local file pages. [Mozilla's content script restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#restricted_domains)
- A site can require a trusted physical pointer event. Firefox marks script-dispatched pointer and mouse events as untrusted, including those sent while handling a real keypress. Canvas-only controls and closed shadow trees may expose only their host as a target. [DOM event trust](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)
- Firefox can withhold site access. In the extensions menu, grant the extension access to the site. In private windows, Firefox also requires the **Run in Private Windows** setting for the extension.
- Page and frame access lets the extension find controls locally. Session storage holds a disabled flag for each tab where you press `q`. The extension makes no network requests and sends no page content, URLs or keystrokes to a service.
