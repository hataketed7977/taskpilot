import '@testing-library/jest-dom/vitest';

// jsdom omits pointer-capture and scrolling APIs used by Radix primitives.
// Main-process suites share this setup file but run without DOM globals.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}
