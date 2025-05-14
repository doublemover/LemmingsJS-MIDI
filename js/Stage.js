import { Lemmings } from './LemmingsNamespace.js';

class Stage {
        constructor(canvasForOutput) {
            this.controller = null;
            this.fadeTimer = 0;
            this.fadeAlpha = 0;
            this.controller = new Lemmings.UserInputManager(canvasForOutput);
            this.handleOnMouseUp();
            this.handleOnMouseDown();
            this.handleOnMouseMove();
            this.handleOnDoubleClick();
            this.handleOnZoom();
            this.stageCav = canvasForOutput;
            this.gameImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
            this.updateStageSize();
            this.clear();
        }
        calcPosition2D(stageImage, e) {
            let x = (stageImage.viewPoint.getSceneX(e.x - stageImage.x));
            let y = (stageImage.viewPoint.getSceneY(e.y - stageImage.y));
            return new Lemmings.Position2D(x, y);
        }
        handleOnDoubleClick() {
            this.controller.onDoubleClick.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                stageImage.display.onDoubleClick.trigger(this.calcPosition2D(stageImage, e));
            });
        }
        handleOnMouseDown() {
            this.controller.onMouseDown.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                stageImage.display.onMouseDown.trigger(this.calcPosition2D(stageImage, e));
            });
        }
        handleOnMouseUp() {
            this.controller.onMouseUp.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                let pos = this.calcPosition2D(stageImage, e);
                stageImage.display.onMouseUp.trigger(pos);
            });
        }
        handleOnMouseMove() {
            this.controller.onMouseMove.on((e) => {
                if (e.button) {
                    let stageImage = this.getStageImageAt(e.mouseDownX, e.mouseDownY);
                    if (stageImage == null)
                        return;
                    if (stageImage == this.gameImgProps) {
                        this.updateViewPoint(stageImage, e.deltaX, e.deltaY, 0);
                    }
                } else {
                    let stageImage = this.getStageImageAt(e.x, e.y);
                    if (stageImage == null)
                        return;
                    if (stageImage.display == null)
                        return;
                    let x = e.x - stageImage.x;
                    let y = e.y - stageImage.y;
                    stageImage.display.onMouseMove.trigger(new Lemmings.Position2D(stageImage.viewPoint.getSceneX(x), stageImage.viewPoint.getSceneY(y)));
                }
            });
        }
        handleOnZoom() {
            this.controller.onZoom.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if (stageImage == null)
                    return;
                this.updateViewPoint(stageImage, 0, 0, e.deltaZoom);
            });
        }
        updateViewPoint(stageImage, deltaX, deltaY, deletaZoom) {
            if ((stageImage == null) || (stageImage.display == null))
                    return;
            stageImage.viewPoint.scale += deletaZoom;
            stageImage.viewPoint.scale = this.limitValue(0.5, stageImage.viewPoint.scale, 10);
            stageImage.viewPoint.x += deltaX * stageImage.viewPoint.scale;
            stageImage.viewPoint.y += deltaY * stageImage.viewPoint.scale;
            stageImage.viewPoint.x = this.limitValue(0, stageImage.viewPoint.x, stageImage.display.getWidth() - stageImage.width / stageImage.viewPoint.scale);
            stageImage.viewPoint.y = this.limitValue(0, stageImage.viewPoint.y, stageImage.display.getHeight() - stageImage.height / stageImage.viewPoint.scale);
            /// redraw
            if (stageImage.display != null) {
                this.clear(stageImage);
                let gameImg = stageImage.display.getImageData();
                this.draw(stageImage, gameImg);
            };
        }
        limitValue(minLimit, value, maxLimit) {
            let useMax = Math.max(minLimit, maxLimit);
            return Math.min(Math.max(minLimit, value), useMax);
        }
        updateStageSize() {
            let ctx = this.stageCav.getContext("2d");
            let stageHeight = ctx.canvas.height;
            let stageWidth = ctx.canvas.width;
            this.gameImgProps.y = 0;
            this.gameImgProps.height = stageHeight - 100;
            this.gameImgProps.width = stageWidth;
            this.guiImgProps.y = stageHeight - 100;
            this.guiImgProps.height = 100;
            this.guiImgProps.width = stageWidth;
        }
        getStageImageAt(x, y) {
            if (this.isPositionInStageImage(this.gameImgProps, x, y))
                return this.gameImgProps;
            if (this.isPositionInStageImage(this.guiImgProps, x, y))
                return this.guiImgProps;
            return null;
        }
        isPositionInStageImage(stageImage, x, y) {
            return ((stageImage.x <= x) && ((stageImage.x + stageImage.width) >= x) &&
                (stageImage.y <= y) && ((stageImage.y + stageImage.height) >= y));
        }
        getGameDisplay() {
            if (this.gameImgProps.display != null)
                return this.gameImgProps.display;
            this.gameImgProps.display = new Lemmings.DisplayImage(this);
            return this.gameImgProps.display;
        }
        getGuiDisplay() {
            if (this.guiImgProps.display != null)
                return this.guiImgProps.display;
            this.guiImgProps.display = new Lemmings.DisplayImage(this);
            return this.guiImgProps.display;
        }
        /** set the position of the view point for the game display */
        setGameViewPointPosition(x, y) {
            this.gameImgProps.viewPoint.x = x;
            this.gameImgProps.viewPoint.y = y;
        }
        /** redraw everything */
        redraw() {
            if (this.gameImgProps.display != null) {
                let gameImg = this.gameImgProps.display.getImageData();
                this.draw(this.gameImgProps, gameImg);
            };
            if (this.guiImgProps.display != null) {
                let guiImg = this.guiImgProps.display.getImageData();
                this.draw(this.guiImgProps, guiImg);
            };
        }
        createImage(display, width, height) {
            if (display == this.gameImgProps.display) {
                return this.gameImgProps.createImage(width, height);
            } else {
                return this.guiImgProps.createImage(width, height);
            }
        }
        /** clear the stage/display/output */
        clear(stageImage) {
            var ctx = this.stageCav.getContext("2d");
            ctx.fillStyle = "#000000";
            if (stageImage == null) {
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            } else {
                ctx.fillRect(stageImage.x, stageImage.y, stageImage.width, stageImage.height);
            }
        }
        resetFade() {
            this.fadeAlpha = 0;
            if (this.fadeTimer != 0) {
                clearInterval(this.fadeTimer);
                this.fadeTimer = 0;
            }
        }
        startFadeOut() {
            this.resetFade();
            this.fadeTimer = setInterval(() => {
                this.fadeAlpha = Math.min(this.fadeAlpha + 0.02, 1);
                if (this.fadeAlpha <= 0) {
                    clearInterval(this.fadeTimer);
                }
            }, 40);
        }
        /** draw everything to the stage/display */
        draw(display, img) {
            if (display.ctx == null)
                return;
            /// write image to context
            display.ctx.putImageData(img, 0, 0);
            let ctx = this.stageCav.getContext("2d");
            //@ts-ignore
            ctx.mozImageSmoothingEnabled = false;
            //@ts-ignore
            ctx.webkitImageSmoothingEnabled = false;
            ctx.imageSmoothingEnabled = false;
            let outH = display.height;
            let outW = display.width;
            ctx.globalAlpha = 1;
            //- Display Layers
            var dW = img.width - display.viewPoint.x; //- display width
            if ((dW * display.viewPoint.scale) > outW) {
                dW = outW / display.viewPoint.scale;
            }
            var dH = img.height - display.viewPoint.y; //- display height
            if ((dH * display.viewPoint.scale) > outH) {
                dH = outH / display.viewPoint.scale;
            }
            //- drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh)
            ctx.drawImage(display.cav, display.viewPoint.x, display.viewPoint.y, dW, dH, display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
            //- apply fading
            if (this.fadeAlpha != 0) {
                ctx.globalAlpha = this.fadeAlpha;
                ctx.fillStyle = "black";
                ctx.fillRect(display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
            }
        }
    }
    Lemmings.Stage = Stage;

export { Stage };
