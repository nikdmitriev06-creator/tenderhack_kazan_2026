import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom

function install(key, value) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

install('window', window)
install('document', window.document)
try {
  install('navigator', window.navigator)
} catch {
  // В новых Node navigator только для чтения; window.navigator остаётся у jsdom.
}
install('getComputedStyle', window.getComputedStyle.bind(window))
install('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0))
install('cancelAnimationFrame', (id) => clearTimeout(id))
install('IS_REACT_ACT_ENVIRONMENT', true)

for (const name of [
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLFormElement',
  'Element',
  'Node',
  'DocumentFragment',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'FocusEvent',
]) {
  install(name, window[name])
}
