import { Frame } from './Frame.js';

const getSourceImageGeometry = (image, frame = image?.frames?.[0]) => {
  const sourceWidth = (frame instanceof Frame ? frame.width : image?.width) | 0;
  const sourceHeight = (frame instanceof Frame ? frame.height : image?.height) | 0;
  const scaleX = Math.max(1, (image?.sourceScaleX | 0) || 1), scaleY = Math.max(1, (image?.sourceScaleY | 0) || 1);
  return { sourceWidth, sourceHeight, scaleX, scaleY,
    width: sourceWidth > 0 ? Math.max(1, Math.floor(sourceWidth / scaleX)) : 0,
    height: sourceHeight > 0 ? Math.max(1, Math.floor(sourceHeight / scaleY)) : 0 };
};
export { getSourceImageGeometry };