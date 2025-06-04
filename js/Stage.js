import { Lemmings } from './LemmingsNamespace.js';

class Stage {
        constructor(canvasForOutput) {
            this.controller = null;
            this.fadeTimer = 0;
            this.fadeAlpha = 0;
            this.controller = new Lemmings.UserInputManager(canvasForOutput);
            this.handleOnMouseUp();
            this.handleOnMouseDown();
            this.handleOnMouseRightUp();
            this.handleOnMouseRightDown();
            this.handleOnMouseMove();
            this.handleOnDoubleClick();
            this.handleOnZoom();
            this.stageCav = canvasForOutput;
            this.gameImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
            this._rawScale = this.gameImgProps.viewPoint.scale;
            this._wheelAnim = null;
            this._wheelRaf = null;
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
        handleOnMouseRightDown() {
            this.controller.onMouseRightDown.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                stageImage.display.onMouseRightDown.trigger(this.calcPosition2D(stageImage, e));
            });
        }
        handleOnMouseRightUp() {
            this.controller.onMouseRightUp.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                let pos = this.calcPosition2D(stageImage, e);
                stageImage.display.onMouseRightUp.trigger(pos);
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
                    let pos = this.calcPosition2D(stageImage, e);
                    stageImage.display.onMouseMove.trigger(pos);
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
                const stageImage = this.getStageImageAt(e.x, e.y);
                if (stageImage == null || stageImage.display.getWidth() != 1600)
                    return;
                const pos = this.calcPosition2D(stageImage, e);
                const screenX = e.x - stageImage.x;
                const screenY = e.y - stageImage.y;
                const oldScale = this._rawScale;
                const rawTarget = oldScale * (1 + -e.deltaZoom / 1600);
                this._startWheelZoom(rawTarget, pos.x, pos.y, screenX, screenY);
            });
        }

        _startWheelZoom(scale, worldX, worldY, screenX, screenY) {
            const img = this.gameImgProps;
            const target = this.limitValue(.25, scale, 4);
            if (Math.abs(target - this._rawScale) < 0.001) return;
            const now = performance.now();
            if (this._wheelAnim) {
                const a = this._wheelAnim;
                const p = Math.min(1, (now - a.startTime) / a.duration);
                const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                const raw = a.startScale + (a.targetScale - a.startScale) * ease;
                this._applyZoom(raw, a.worldX, a.worldY, a.screenX, a.screenY);
                this._wheelAnim = {
                    startScale: raw,
                    targetScale: target,
                    worldX,
                    worldY,
                    screenX,
                    screenY,
                    startTime: now,
                    duration: a.duration
                };
            } else {
                this._wheelAnim = {
                    startScale: this._rawScale,
                    targetScale: target,
                    worldX,
                    worldY,
                    screenX,
                    screenY,
                    startTime: now,
                    duration: 100
                };
            }
            if (!this._wheelRaf) {
                this._wheelRaf = requestAnimationFrame(t => this._stepWheelZoom(t));
            }
        }

        _stepWheelZoom(t) {
            if (!this._wheelAnim) {
                this._wheelRaf = null;
                return;
            }
            const a = this._wheelAnim;
            const p = Math.min(1, (t - a.startTime) / a.duration);
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const raw = a.startScale + (a.targetScale - a.startScale) * ease;
            this._applyZoom(raw, a.worldX, a.worldY, a.screenX, a.screenY, p >= 1);
            if (p < 1) {
                this._wheelRaf = requestAnimationFrame(tt => this._stepWheelZoom(tt));
            } else {
                this._wheelAnim = null;
                this._wheelRaf = null;
            }
        }

        _applyZoom(rawScale, worldX, worldY, screenX, screenY, finalize = false) {
            this._rawScale = rawScale;
            const img = this.gameImgProps;
            const vp = img.viewPoint;
            const newScale = finalize ? this.snapScale(rawScale) : rawScale;
            const nx = worldX - screenX / newScale;
            const ny = worldY - screenY / newScale;
            const maxX = img.display.getWidth() - img.width / newScale;
            const maxY = img.display.getHeight() - img.height / newScale;
            if (maxX > 0) {
                vp.x = this.limitValue(0, nx, maxX);
            } else {
                vp.x = this.limitValue(maxX, nx, 0);
            }
            if (maxY > 0) {
                vp.y = maxY; // keep bottom glued
            } else {
                vp.y = this.limitValue(maxY, ny, 0);
            }
            vp.scale = newScale;
            if (img.display != null) {
                this.clear(img);
                const gameImg = img.display.getImageData();
                this.draw(img, gameImg);
            }
            this.redraw();
        }
        updateViewPoint(stageImage, deltaX, deltaY, deltaZoom, zx = 0, zy = 0) {
            if ((stageImage == null) || (stageImage.display == null))
                return;

            // Mousewheel zoom: zx and zy are world coords under mouse
            if (deltaZoom !== 0 && zx !== 0 && zy !== 0) {
                // Calculate the screen (pixel) position relative to the image
                let screenX = deltaX - stageImage.x;
                let screenY = deltaY - stageImage.y;

                // World coords under cursor before zoom
                let sceneX = stageImage.viewPoint.getSceneX(screenX);
                let sceneY = stageImage.viewPoint.getSceneY(screenY);

                // Zoom around that point using the un-snapped scale
                const oldScale = this._rawScale;
                const target = this.limitValue(.25, oldScale * (1 + deltaZoom / 1600), 4);
                this._rawScale += (target - this._rawScale) * 0.8;
                stageImage.viewPoint.scale = this.snapScale(this._rawScale);

                // Re-center so the same world point stays under the cursor
                stageImage.viewPoint.x = sceneX - screenX / stageImage.viewPoint.scale;
                stageImage.viewPoint.y = sceneY - screenY / stageImage.viewPoint.scale;
            } else if (zx == 0 && zy == 0) {
                // Dragging: keep as before
                stageImage.viewPoint.x += Math.fround(deltaX / stageImage.viewPoint.scale);
                stageImage.viewPoint.y += Math.fround(deltaY / stageImage.viewPoint.scale);
            }

            if (stageImage.display != null) {
                this.clear(stageImage);
                const gameImg = stageImage.display.getImageData();
                this.draw(stageImage, gameImg);
            }

            const maxX = stageImage.display.getWidth()  - stageImage.width  / stageImage.viewPoint.scale;
            const maxY = stageImage.display.getHeight() - stageImage.height / stageImage.viewPoint.scale;
            if (maxX > 0) {
                stageImage.viewPoint.x = this.limitValue(0, stageImage.viewPoint.x, maxX);
            } else {
                stageImage.viewPoint.x = this.limitValue(maxX, stageImage.viewPoint.x, 0);
            }
            if (maxY > 0) {
                stageImage.viewPoint.y = maxY;
            } else {
                stageImage.viewPoint.y = this.limitValue(maxY, stageImage.viewPoint.y, 0);
            }

            // stageImage.viewPoint.x = this.limitValue(0, stageImage.viewPoint.x, stageImage.display.getWidth() - stageImage.width / stageImage.viewPoint.scale);
            // stageImage.viewPoint.y = this.limitValue(0, stageImage.display.getHeight() - stageImage.height / stageImage.viewPoint.scale, stageImage.viewPoint.y);

            if (stageImage.display != null) {
                this.clear(stageImage);
                let gameImg = stageImage.display.getImageData();
                this.draw(stageImage, gameImg);
            }
            this.redraw();
        }
        limitValue(minLimit, value, maxLimit) {
            let useMax = Math.max(minLimit, maxLimit);
            return Math.min(Math.max(minLimit, value), useMax);
        }

        snapScale(scale) {
            const disp = this.gameImgProps.display;
            if (!disp) return this.limitValue(0.25, scale, 4);

            const w = disp.getWidth();
            const h = disp.getHeight();
            if (!w || !h) return this.limitValue(0.25, scale, 4);

            const stepX = this.gameImgProps.width  / w;
            const stepY = this.gameImgProps.height / h;
            const step  = Math.min(stepX, stepY);
            if (!isFinite(step) || step <= 0) return this.limitValue(0.25, scale, 4);

            const snapped = Math.round(scale / step) * step;
            return this.limitValue(0.25, snapped, 4);
        }
        updateStageSize() {
            let ctx = this.stageCav.getContext("2d", { alpha: false });
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
            if (this.guiImgProps.display != null) {
                return this.guiImgProps.display;
            }
            this.guiImgProps.display = new Lemmings.DisplayImage(this);
            return this.guiImgProps.display;
        }
        /** set the position of the view point for the game display */
        setGameViewPointPosition(x, y) {
            this.clear(this.gameImgProps);

            if (lemmings.scale > 0) {
                this._rawScale = this.limitValue(.25, lemmings.scale, 4);
                this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
                this.gameImgProps.viewPoint.x = x;
                this.gameImgProps.viewPoint.y = this.gameImgProps.display.getHeight() - this.gameImgProps.height / this.gameImgProps.viewPoint.scale;
                this.redraw();
                return;
            }

            let scale = this.gameImgProps.viewPoint.scale;
            if (scale == 2) {
                this.gameImgProps.viewPoint.x = x;
                this.gameImgProps.viewPoint.y = this.gameImgProps.display.getHeight() - this.gameImgProps.height / this.gameImgProps.viewPoint.scale;
                this._rawScale = scale;
                this.redraw();
                return;
            } else {

                let sceneX = this.gameImgProps.viewPoint.getSceneX(x);
                let sceneY = this.gameImgProps.viewPoint.getSceneY(y);
                this._rawScale = 2;
                this.gameImgProps.viewPoint.scale = 2;
                this.gameImgProps.viewPoint.x = sceneX - x / scale;
                this.gameImgProps.viewPoint.y = sceneY - y / scale;

            }
            // this.redraw();
        }
        /** redraw everything */
        redraw() {
            if (this.gameImgProps.display != null) {
                let gameImg = this.gameImgProps.display.getImageData();
                this.draw(this.gameImgProps, gameImg);
            }
            if (this.guiImgProps.display != null) {
                let guiImg = this.guiImgProps.display.getImageData();
                this.draw(this.guiImgProps, guiImg);
            }
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
            const ctx = this.stageCav.getContext("2d", { alpha: false });
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
                if (this.fadeAlpha >= 1) {
                    clearInterval(this.fadeTimer);
                    this.fadeTimer = 0;
                }
            }, 40);
        }
        dispose() {
            this.resetFade();
            if (this.controller && this.controller.dispose) {
                this.controller.dispose();
            }
            this.controller = null;
        }
        /** draw everything to the stage/display */
        draw(display, img) {
            if (display.ctx == null)
                return;
            /// write image to context
            display.ctx.putImageData(img, 0, 0);
            let ctx = this.stageCav.getContext("2d", { alpha: false });
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
        getGameViewRect() {
            return {
                x: this.gameImgProps.viewPoint.x,
                y: this.gameImgProps.viewPoint.y,
                w: this.gameImgProps.width / this.gameImgProps.viewPoint.scale,
                h: this.gameImgProps.height / this.gameImgProps.viewPoint.scale
            };
        }
    }
    Lemmings.Stage = Stage;

export { Stage };
