const createCanvasStub = ({ width = 800, height = 480 } = {}) => {
  return {
    width,
    height,
    style: {},
    getBoundingClientRect() {
      return { x: 0, y: 0, width, height };
    }
  };
};

export { createCanvasStub };
