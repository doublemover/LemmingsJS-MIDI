import { requestBrowserDownload } from '../export/BrowserDownload.js';

const readTextFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

const readArrayBufferFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(file);
});

const downloadTextFile = (document, text, filename, mimeType = 'text/plain') => {
  return requestBrowserDownload({ document, bytes: text, filename, mediaType: mimeType });
};

const downloadBinaryFile = (document, bytes, filename, mimeType = 'application/octet-stream') => {
  return requestBrowserDownload({ document, bytes, filename, mediaType: mimeType });
};

export { downloadBinaryFile, downloadTextFile, readArrayBufferFile, readTextFile };
