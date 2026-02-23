import { EventHandler } from '../util/EventHandler.js';
import { Position2D } from '../util/Position2D.js';
import { getAppContext } from '../core/dependencies.js';

const PASSIVE_LISTENER = Object.freeze({ passive: true });
const ACTIVE_LISTENER = Object.freeze({ passive: false });

class MouseMoveEventArguements extends Position2D {
  constructor(x = 0, y = 0, deltaX = 0, deltaY = 0, button = false) {
    super(x, y);
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.deltaX = deltaX;
    this.deltaY = deltaY;
    this.button = button;
  }
}

class ZoomEventArgs extends Position2D {
  constructor(x = 0, y = 0, deltaZoom = 0) {
    super(x, y);
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.deltaZoom = deltaZoom;
    this.mda = null;
  }
}

class UserInputManager {
  constructor(listenElement, options = {}) {
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.mouseButton = false;
    this.mouseButtonNumber = 0;
    this.onMouseMove = new EventHandler();
    this.onMouseUp = new EventHandler();
    this.onMouseDown = new EventHandler();
    this.onMouseRightDown = new EventHandler();
    this.onMouseRightUp = new EventHandler();
    this.onDoubleClick = new EventHandler();
    this.onZoom = new EventHandler();
    this.listenElement = listenElement;
    this._listeners = [];
    this._passiveMouseMove = options.passiveMouseMove !== false;
    this.twoTouch = false;
    this.lastTouchDistance = 0;

    this.once = false;
    if (this.listenElement?.style) {
      this.listenElement.style.touchAction = 'none';
    }

    this._addListener('mousemove', (e) => {
      let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
      this.handleMouseMove(relativePos);
    });
    this._addListener('touchmove', (e) => {
      if (e.touches.length > 2) {
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1 && !this.twoTouch) {
        let relativePos = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
        this.handleMouseMove(relativePos);
        e.stopPropagation();
        e.preventDefault();
        return false;
      }

      if (e.touches.length === 2) {
        const p1 = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
        const p2 = this.getRelativePosition(this.listenElement, e.touches[1].clientX, e.touches[1].clientY);
        const mid = new Position2D((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

        if (!this.twoTouch) {
          this.twoTouch = true;
          this.lastTouchDistance = dist;
          this.handleMouseDown(mid);
        } else {
          this.handleMouseMove(mid);
          this.handleWheel(mid, this.lastTouchDistance - dist);
          this.lastTouchDistance = dist;
        }

        e.stopPropagation();
        e.preventDefault();
        return false;
      }

      e.preventDefault();
      return;
    });
    this._addListener('touchstart', (e) => {
      if (e.touches.length > 2) {
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        const relativePos = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
        this.handleMouseDown(relativePos);
        e.stopPropagation();
        e.preventDefault();
        return false;
      }
      if (e.touches.length === 2) {
        const p1 = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
        const p2 = this.getRelativePosition(this.listenElement, e.touches[1].clientX, e.touches[1].clientY);
        const mid = new Position2D((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        this.twoTouch = true;
        this.lastTouchDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.handleMouseDown(mid);
        e.stopPropagation();
        e.preventDefault();
        return false;
      }
      e.preventDefault();
      return;
    });
    this._addListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
      if (e.button === 2) {
        this.handleMouseRightDown(relativePos);
        return false;
      }
      if (e.button === 1) {
        this.handleMouseMiddleDown(relativePos);
        return false;
      }
      this.handleMouseDown(relativePos);

      return false;
    });
    this._addListener('mouseup', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
      if (e.button === 2) {
        this.handleMouseRightUp(relativePos);
        return false;
      }
      if (e.button === 1) {
        this.handleMouseMiddleUp(relativePos);
        return false;
      }
      this.handleMouseUp(relativePos);
      return false;
    });
    this._addListener('mouseleave', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.handleMouseClear();
    });
    this._addListener('touchend', (e) => {
      if (this.twoTouch) {
        if (e.touches.length === 1) {
          const remaining = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
          this.twoTouch = false;
          this.handleMouseDown(remaining);
          e.stopPropagation();
          e.preventDefault();
          return false;
        }
        this.twoTouch = false;
        this.handleMouseUp(new Position2D(this.lastMouseX, this.lastMouseY));
        e.stopPropagation();
        e.preventDefault();
        return false;
      }
      if (e.changedTouches.length !== 1) {
        e.preventDefault();
        return;
      }
      let relativePos = this.getRelativePosition(this.listenElement, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      this.handleMouseUp(relativePos);
      e.stopPropagation();
      e.preventDefault();
      return false;
    });
    this._addListener('touchleave', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.handleMouseClear();
      this.twoTouch = false;
      this.lastTouchDistance = 0;
      return false;
    });
    this._addListener('touchcancel', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.handleMouseClear();
      this.twoTouch = false;
      this.lastTouchDistance = 0;
      return false;
    });
    this._addListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
      this.handleMouseDoubleClick(relativePos);
      return false;
    });
    this._addListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
      this.handleWheel(relativePos, -e.deltaY);
      return false;
    });
  }

  _addListener(type, handler, options = null) {
    let useOptions = options;
    if (useOptions == null) {
      useOptions = this._defaultListenerOptions(type);
    }
    this.listenElement.addEventListener(type, handler, useOptions);
    this._listeners.push([type, handler, useOptions]);
  }

  /**
   * Listener options are explicit so the browser can keep high-frequency move
   * handlers on the fast path while still allowing touch/wheel default-prevent.
   */
  _defaultListenerOptions(type) {
    if (type === 'mousemove' || type === 'mouseleave') {
      return this._passiveMouseMove ? PASSIVE_LISTENER : undefined;
    }
    if (type.startsWith('touch') || type === 'wheel') {
      return ACTIVE_LISTENER;
    }
    return undefined;
  }

  dispose() {
    for (const [type, handler, options] of this._listeners) {
      this.listenElement.removeEventListener(type, handler, options);
    }
    this._listeners.length = 0;
  }

  #setMouseDownState(position, buttonNum) {
    this.mouseButton = true;
    this.mouseButtonNumber = buttonNum;
    this.mouseDownX = position.x;
    this.mouseDownY = position.y;
    this.lastMouseX = position.x;
    this.lastMouseY = position.y;
  }

  getRelativePosition(element, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    const scaleX = element.width / rect.width;
    const scaleY = element.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return new Position2D(x, y);
  }
  handleMouseMove(position) {
    //- Move Point of View
    if (this.mouseButton) {
      let deltaX = (this.lastMouseX - position.x);
      let deltaY = (this.lastMouseY - position.y);
      //- save start of Mousedown
      this.lastMouseX = position.x;
      this.lastMouseY = position.y;
      let mouseDragArguments = new MouseMoveEventArguements(position.x, position.y, deltaX, deltaY, true);
      mouseDragArguments.mouseDownX = this.mouseDownX;
      mouseDragArguments.mouseDownY = this.mouseDownY;
      /// raise event
      this.onMouseMove.trigger(mouseDragArguments);
    } else {
      /// raise event
      this.onMouseMove.trigger(new MouseMoveEventArguements(position.x, position.y, 0, 0, false));
    }
  }
  handleMouseDown(position) {
    this.#setMouseDownState(position, 0);

    this.onMouseDown.trigger(position);
  }
  handleMouseRightDown(position) {
    this.#setMouseDownState(position, 2);

    this.onMouseRightDown.trigger(position);
  }
  handleMouseMiddleDown(position) {
    this.#setMouseDownState(position, 1);
  }
  handleMouseDoubleClick(position) {
    this.onDoubleClick.trigger(position);
  }
  handleMouseClear() {
    this.mouseButton = false;
    this.mouseButtonNumber = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.twoTouch = false;
    this.lastTouchDistance = 0;
  }
  handleMouseUp(position) {
    this.handleMouseClear();
    this.onMouseUp.trigger(new Position2D(position.x, position.y));
  }
  handleMouseRightUp(position) {
    this.handleMouseClear();
    this.onMouseRightUp.trigger(new Position2D(position.x, position.y));
  }
  handleMouseMiddleUp() {
    this.handleMouseClear();
  }
  /** Zoom view around the cursor */

  handleWheel(position, deltaY) {
    this.lastMouseX = position.x;
    this.lastMouseY = position.y;

    const evt = new ZoomEventArgs(position.x, position.y, deltaY);
    this.onZoom.trigger(evt);
  }
}

export { UserInputManager };
