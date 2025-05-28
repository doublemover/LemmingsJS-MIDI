import { Lemmings } from './LemmingsNamespace.js';

class MouseMoveEventArguements extends Lemmings.Position2D {
    constructor(x = 0, y = 0, deltaX = 0, deltaY = 0, button = false) {
        super(x, y);
        /** delta the mouse move Y */
        this.deltaX = 0;
        this.deltaY = 0;
        this.button = false;
        /** position the user starts pressing the mouse */
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        this.deltaX = deltaX;
        this.deltaY = deltaY;
        this.button = button;
    }
}

class ZoomEventArguements extends Lemmings.Position2D {
    constructor(x = 0, y = 0, deltaZoom = 0) {
        super(x, y);
        this.deltaZoom = deltaZoom;
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
        listenElement.addEventListener("mousemove", (e) => {
            let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
            this.handleMouseMove(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        listenElement.addEventListener("touchmove", (e) => {
            if (e.touches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(listenElement, e.touches[0].clientX, e.touches[0].clientY);
            this.handleMouseMove(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        listenElement.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(listenElement, e.touches[0].clientX, e.touches[0].clientY);
            this.handleMouseDown(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        listenElement.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
            if (e.button == 2) {
                this.handleMouseRightDown(relativePos, e.button);
                return false;
            }
            this.handleMouseDown(relativePos, e.button);

            return false;
        });
        listenElement.addEventListener("mouseup", (e) => {
            e.stopPropagation();
            e.preventDefault();
            let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
            if (e.button == 2) {
                this.handleMouseRightUp(relativePos, e.button);
                return false;
            }
            this.handleMouseUp(relativePos, e.button);
            return false;
        });
        listenElement.addEventListener("mouseleave", (e) => {
            this.handleMouseClear();
        });
        listenElement.addEventListener("touchend", (e) => {
            if (e.changedTouches.length !== 1) {
                e.preventDefault();
                return;
            }
            let relativePos = this.getRelativePosition(listenElement, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            this.handleMouseUp(relativePos);
            return false;
        });
        listenElement.addEventListener("touchleave", (e) => {
            this.handleMouseClear();
            return false;
        });
        listenElement.addEventListener("touchcancel", (e) => {
            this.handleMouseClear();
            return false;
        });
        listenElement.addEventListener("dblclick", (e) => {
            let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
            this.handleMouseDoubleClick(relativePos);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
        listenElement.addEventListener("wheel", (e) => {
            let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
            //this.handleWheel(relativePos, e.deltaY);
            e.stopPropagation();
            e.preventDefault();
            return false;
        });
    }
    getRelativePosition(element, clientX, clientY) {
        var rect = element.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width * 800;
        const y = (clientY - rect.top) / rect.height * 480;
        return new Lemmings.Position2D(x, y);
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
    handleMouseDown(position, button = null) {
        //- save start of Mousedown
        this.mouseButton = true;
        this.mouseDownX = position.x;
        this.mouseDownY = position.y;
        this.lastMouseX = position.x;
        this.lastMouseY = position.y;
        if (button > 0) {
            this.mouseButtonNumber = button;
        }

        this.onMouseDown.trigger(position);
    }
    handleMouseRightDown(position, button = null) {
        this.mouseButton = true;
        this.mouseDownX = position.x;
        this.mouseDownY = position.y;
        this.lastMouseX = position.x;
        this.lastMouseY = position.y;
        if (button) {
            this.mouseButtonNumber = button;
        }

        this.onMouseRightDown.trigger(position);
    }
    handleMouseDoubleClick(position) {
        this.onDoubleClick.trigger(position);
    }
    handleMouseClear() {
        this.mouseButton = false;
        this.mouseButtonNumber = null;
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
        if (deltaY < 0) {
            this.onZoom.trigger(new ZoomEventArguements(position.x, position.y, 0.2));
        }
        if (deltaY > 0) {
            this.onZoom.trigger(new ZoomEventArguements(position.x, position.y, -0.2));
        }
    }
}
Lemmings.UserInputManager = UserInputManager;

export { UserInputManager };
