import { Lemmings } from './LemmingsNamespace.js';

class MouseMoveEventArguements extends Lemmings.Position2D {
    constructor(x = 0, y = 0, deltaX = 0, deltaY = 0, button = false) {
        super(x, y);
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        this.deltaX = deltaX;
        this.deltaY = deltaY;
        this.button = button;
    }
}

class ZoomEventArgs extends Lemmings.Position2D {
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
    constructor(listenElement) {
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.mouseButton = false;
        this.mouseButtonNumber = 0;
        this.onMouseMove = new Lemmings.EventHandler();
        this.onMouseUp = new Lemmings.EventHandler();
        this.onMouseDown = new Lemmings.EventHandler();
        this.onMouseRightDown = new Lemmings.EventHandler();
        this.onMouseRightUp = new Lemmings.EventHandler();
        this.onDoubleClick = new Lemmings.EventHandler();
        this.onZoom = new Lemmings.EventHandler();
        this.listenElement = listenElement;
        this._listeners = [];

        this._addListener("mousemove", (e) => {
            let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
            this.handleMouseMove(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        this._addListener("touchmove", (e) => {
            if (e.touches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
            this.handleMouseMove(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        this._addListener("touchstart", (e) => {
            if (e.touches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(this.listenElement, e.touches[0].clientX, e.touches[0].clientY);
            this.handleMouseDown(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        this._addListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
            if (e.button == 2) {
                this.handleMouseRightDown(relativePos);
                return false;
            }
            this.handleMouseDown(relativePos);

            return false;
        });
        this._addListener("mouseup", (e) => {
            e.stopPropagation();
            e.preventDefault();
            let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
            if (e.button == 2) {
                this.handleMouseRightUp(relativePos);
                return false;
            }
            this.handleMouseUp(relativePos);
            return false;
        });
        this._addListener("mouseleave", (e) => {
            this.handleMouseClear();
        });
        this._addListener("touchend", (e) => {
            if (e.changedTouches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(this.listenElement, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            this.handleMouseUp(relativePos);
            return false;
        });
        this._addListener("touchleave", (e) => {
            this.handleMouseClear();
            return false;
        });
        this._addListener("touchcancel", (e) => {
            this.handleMouseClear();
            return false;
        });
        this._addListener("dblclick", (e) => {
            let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
            this.handleMouseDoubleClick(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        this._addListener("wheel", (e) => {
            let relativePos = this.getRelativePosition(this.listenElement, e.clientX, e.clientY);
            this.handleWheel(relativePos, e.deltaY);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
    }

    _addListener(type, handler) {
        this.listenElement.addEventListener(type, handler);
        this._listeners.push([type, handler]);
    }

    dispose() {
        for (const [type, handler] of this._listeners) {
            this.listenElement.removeEventListener(type, handler);
        }
        this._listeners.length = 0;
    }
    getRelativePosition(element, clientX, clientY) {
        const rect = element.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width * 800;
        const y = (clientY - rect.top) / rect.height * 480;
        return new Lemmings.Position2D(x, y);
    }
    handleMouseMove(position) {
        //- Move Point of View
        if (this.mouseButton) {
            let deltaX = this.lastMouseX - position.x;
            let deltaY = this.lastMouseY - position.y;
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
        //- save start of Mousedown
        this.mouseButton = true;
        this.mouseDownX = position.x;
        this.mouseDownY = position.y;
        this.lastMouseX = position.x;
        this.lastMouseY = position.y;

        this.onMouseDown.trigger(position);
    }
    handleMouseRightDown(position) {
        this.mouseButton = true;
        this.mouseDownX = position.x;
        this.mouseDownY = position.y;
        this.lastMouseX = position.x;
        this.lastMouseY = position.y;

        this.onMouseRightDown.trigger(position);
    }
    handleMouseDoubleClick(position) {
        this.onDoubleClick.trigger(position);
    }
    handleMouseClear() {
        this.mouseButton = false;
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
    }
    handleMouseUp(position) {
        this.handleMouseClear();
        this.onMouseUp.trigger(new Lemmings.Position2D(position.x, position.y));
    }
    handleMouseRightUp(position) {
        this.handleMouseClear();
        this.onMouseUp.trigger(new Lemmings.Position2D(position.x, position.y));
    }
    /** Zoom view
     * todo: zoom to mouse pointer */
    handleWheel(position, deltaY) {
        let dX = this.lastMouseX - position.x;
        let dY = this.lastMouseY - position.y;
        this.lastMouseX = position.x;
        this.lastMouseY = position.y;
        let mouseDragArguments = new MouseMoveEventArguements(position.x, position.y, dX, dY, true);
        mouseDragArguments.mouseDownX = this.mouseDownX;
        mouseDragArguments.mouseDownY = this.mouseDownY;
        let zea = new ZoomEventArgs(position.x, position.y, deltaY);
        zea.deltaX = this.lastMouseX;
        zea.deltaY = this.lastMouseY;
        zea.mda = mouseDragArguments;
        this.onZoom.trigger(zea);
    }
}
Lemmings.UserInputManager = UserInputManager;

export { UserInputManager };
